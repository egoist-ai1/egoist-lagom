param([string]$TestsRoot,[string]$NodePath,[string]$WorkRoot,[string]$EvidencePath)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2
. (Join-Path $TestsRoot 'windows-vpn-native-acceptance.ps1') -LibraryOnly
$script:VpnWork=$WorkRoot;$script:VpnNode=$NodePath;$script:VpnWatchdog=$null;$script:VpnAlarmPath='';$script:VpnFixtureChild=$null
$script:VpnReceipt=[ordered]@{checks=[Collections.Generic.List[object]]::new()};$script:VpnReceiptPath=Join-Path $WorkRoot 'own-harness-receipt.json'
$script:VpnFixtureControl=Join-Path $WorkRoot 'control.json';$script:VpnFixtureAck=Join-Path $WorkRoot 'ack.json';$script:VpnFixtureControlId=0
$script:VpnFixtureNonce=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
$stopPath=Join-Path $WorkRoot 'stop.txt';$eventsPath=Join-Path $WorkRoot 'events.ndjson';$readyPath=Join-Path $WorkRoot 'ready.json';$optionsPath=Join-Path $WorkRoot 'options.json'
[IO.File]::WriteAllText($optionsPath,([ordered]@{workRoot=$WorkRoot;receiptPath=$readyPath;eventsPath=$eventsPath;stopPath=$stopPath;controlPath=$script:VpnFixtureControl;ackPath=$script:VpnFixtureAck;stopNonce=$script:VpnFixtureNonce;leaseSeconds=180}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$parentBefore=[Environment]::GetEnvironmentVariables('Process')
$stage='child-start';$primary=$null;$retired=$false;$proof=[ordered]@{kind='actual-owned-loopback-actor-outage-prototype';nativeAcceptancePassed=$false;actualTunRuns=0;nativeActions=0;serviceActions=0;adapterMutations=0;parentEnvironmentChanged=$false;externalDial=$false;stages=@();inertCases=@()};$overall=[Diagnostics.Stopwatch]::StartNew()
function Check([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Probe-OwnSocks([bool]$ExpectRefusal){
  $watch=[Diagnostics.Stopwatch]::StartNew();$nonce=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant();$client=[Net.Sockets.TcpClient]::new()
  try{
    $task=$client.ConnectAsync('127.0.0.1',[int]$script:VpnFixtureProof.port);if(-not $task.Wait(4000)){throw 'Own client connect deadline'};[void]$task.GetAwaiter().GetResult()
    $stream=$client.GetStream();$stream.ReadTimeout=3000;$stream.WriteTimeout=3000
    function Read-OwnExactly([int]$Count){$bytes=[byte[]]::new($Count);$position=0;while($position -lt $Count){$read=$stream.Read($bytes,$position,$Count-$position);if($read -eq 0){throw 'Own SOCKS protocol ended early'};$position+=$read};return ,$bytes}
    $stream.Write([byte[]]@(5,1,0));$greeting=Read-OwnExactly 2;Check ($greeting[0] -eq 5 -and $greeting[1] -eq 0) 'Own SOCKS auth differs'
    $stream.Write([byte[]]@(5,1,0,1,198,18,0,254,74,136));$response=Read-OwnExactly 10;Check ($response[1] -eq 0) 'Own SOCKS target was not accepted'
    $request=[Text.Encoding]::ASCII.GetBytes("GET /nonce/$nonce HTTP/1.1`r`nHost: 198.18.0.254:19080`r`n`r`n");$stream.Write($request)
    $buffer=[byte[]]::new(4096);$bytes=[Collections.Generic.List[byte]]::new()
    while($true){$read=$stream.Read($buffer,0,$buffer.Length);if($read -eq 0){Check $ExpectRefusal 'Own nonce was closed unexpectedly';break};for($i=0;$i -lt $read;$i++){$bytes.Add($buffer[$i])};Check ($bytes.Count -le 8192) 'Own response exceeded bound';$text=[Text.Encoding]::UTF8.GetString($bytes.ToArray());if($text.Contains("`r`n`r`n")){$parts=$text.Split(@("`r`n`r`n"),2,[StringSplitOptions]::None);$length=[int]([regex]::Match($parts[0],'Content-Length: ([0-9]+)').Groups[1].Value);if([Text.Encoding]::UTF8.GetByteCount($parts[1]) -ge $length){Check (-not $ExpectRefusal) 'Paused actor returned nonce success';$body=$parts[1]|ConvertFrom-Json;Check ($body.nonce -ceq $nonce -and $body.fixtureInstance -ceq $script:VpnFixtureProof.instance) 'Own fresh nonce mismatch';break}}
    }
    if($ExpectRefusal){Check ($bytes.Count -eq 0 -and $watch.ElapsedMilliseconds -lt 3000) 'Own refusal was timeout/data, not actual peer close';$event=Wait-VpnCondition -Label 'own prototype refusal event' -TimeoutSeconds 6 -Condition {Get-Content -LiteralPath $eventsPath | ForEach-Object{$_|ConvertFrom-Json} | Where-Object{$_.kind -eq 'nonce-refused' -and $_.nonce -eq $nonce}};Check ($event.epoch -eq $script:VpnFixtureControlId) 'Own refusal epoch mismatch'}
    return [ordered]@{label=if($ExpectRefusal){'peer-refused'}else{'fresh-nonce-pass'};elapsedMs=$watch.ElapsedMilliseconds;socketLoopbackOnly=$true;actualTunClaim=$false}
  }finally{$client.Dispose()}
}
try{
  $script:VpnFixtureChild=Start-VpnOwnedChild -Executable $NodePath -Arguments @((Join-Path $TestsRoot 'windows-vpn-production-acceptance.mjs'),'Fixture',$optionsPath) -Label 'own-controlled-upstream'
  $held=$script:VpnFixtureChild.Process
  $script:VpnFixtureIdentity=[ordered]@{processId=$held.Id;executable=$held.MainModule.FileName;createdUtc=$held.StartTime.ToUniversalTime().ToString('o')}
  $stage='fixture-ready';$script:VpnFixtureProof=Wait-VpnCondition -Label 'own actor readiness' -TimeoutSeconds 30 -Condition {if(Test-Path $readyPath){Get-Content $readyPath -Raw|ConvertFrom-Json}}
  Check ($script:VpnFixtureProof.processId -eq $held.Id -and $script:VpnFixtureProof.externalDial -eq $false) 'Own actor PID/dial mismatch'
  $stage='held-path-birth-listener';$originalIdentity=([hashtable]$script:VpnFixtureIdentity).Clone();[void](Assert-VpnFixtureHeldIdentity)
  foreach($case in @('birth','executable','listener-owner')){
    $stage='inert-'+$case;$refused=$false
    try{
      if($case -eq 'birth'){$script:VpnFixtureIdentity.createdUtc='2000-01-01T00:00:00.0000000Z'}
      if($case -eq 'executable'){$script:VpnFixtureIdentity.executable='C:\own-fictional-refused\different.exe'}
      if($case -eq 'listener-owner'){function Get-NetTCPConnection {param($LocalPort,$State,$ErrorAction);[pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=($script:VpnFixtureIdentity.processId+1)}}}
      try{[void](Assert-VpnFixtureHeldIdentity)}catch{$refused=$true}
      Check $refused 'Inert held/listener mismatch was admitted';$proof.inertCases+=$case
    }finally{$script:VpnFixtureIdentity=$originalIdentity.Clone();if($case -eq 'listener-owner'){Remove-Item Function:\Get-NetTCPConnection}}
  }
  $stage='available-pass';$proof.stages+=Probe-OwnSocks $false
  $stage='pause-ack';$pause=Set-VpnFixtureAvailability pause;Check ($pause.mode -eq 'paused' -and $pause.epoch -eq 1) 'Pause ACK mismatch'
  $stage='paused-fail';$proof.stages+=Probe-OwnSocks $true
  $stage='resume-ack';$resume=Set-VpnFixtureAvailability resume;Check ($resume.mode -eq 'available' -and $resume.epoch -eq 2) 'Resume ACK mismatch'
  $stage='returned-pass';$proof.stages+=Probe-OwnSocks $false
  [void](Assert-VpnFixtureHeldIdentity)
  $proof.heldIdentity=[ordered]@{processId=$held.Id;createdUtc=$originalIdentity.createdUtc;executableSha256=(Get-FileHash $NodePath -Algorithm SHA256).Hash;expectedPathMatches=$true;unchangedPathBirth=$true;port=[int]$script:VpnFixtureProof.port;unchangedPort=$true}
  $stage='own-normal-retirement';[IO.File]::WriteAllText($stopPath,('stop:'+ $script:VpnFixtureNonce),[Text.UTF8Encoding]::new($false));$result=Stop-VpnOwnedChild $script:VpnFixtureChild -TimeoutSeconds 15;$retired=$true;$script:VpnFixtureChild=$null
  Check ($result.exitCode -eq 0 -and -not $result.stdout -and -not $result.stderr) 'Own actor abnormal retirement'
  Check (@(Get-NetTCPConnection -LocalPort $proof.heldIdentity.port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) 'Own listener survived retirement'
  $stage='inert-primary-error-preservation';$savedFunctions=@{};foreach($name in @('Start-VpnOwnedChild','Assert-VpnFixtureHeldIdentity')){$savedFunctions[$name]=(Get-Command $name -CommandType Function).ScriptBlock}
  $consoleBefore=[Console]::Error;$consoleOwn=[IO.StringWriter]::new();$script:fakeDisposed=0;$script:VpnProbe=[ordered]@{executable='C:\own-fictional-probe.exe';dotnetRoot=''}
  try{
    function Assert-VpnFixtureHeldIdentity {return [ordered]@{inert=$true}}
    function Start-VpnOwnedChild {
      param($Executable,$Arguments,$Label,$DotnetRoot)
      $fake=[pscustomobject]@{Id=777;HasExited=$false;StartTime=$null;MainModule=[pscustomobject]@{FileName=$Executable}}
      $fake|Add-Member ScriptMethod Kill {throw 'own-secondary-retirement-error'}
      $fake|Add-Member ScriptMethod Dispose {$script:fakeDisposed++}
      return [pscustomobject]@{Process=$fake}
    }
    [Console]::SetError($consoleOwn);$first=$null;try{Invoke-VpnPausedNonceProbe -Generation $null -Label 'inert-primary-proof' -Epoch 1}catch{$first=$_}
    Check ($first.FullyQualifiedErrorId -like '*InvokeMethodOnNull*' -and $first.Exception.Message -notlike '*own-secondary-retirement-error*') 'Negative helper lost its primary identity error'
    Check ($consoleOwn.ToString() -like '*own-secondary-retirement-error*' -and $script:fakeDisposed -eq 1) 'Secondary held retirement was not diagnosed separately'
    $proof.inertCases+='primary-error-before-retirement'
  }finally{[Console]::SetError($consoleBefore);$consoleOwn.Dispose();foreach($name in $savedFunctions.Keys){Set-Item -Path ('Function:\'+$name) -Value $savedFunctions[$name]}}
  $proof.normalOwnRetirement=$true;$proof.pendingOutputDrained=$true;$proof.listenerAbsent=$true;$proof.passed=$true
}catch{$primary=$_;$proof.passed=$false;$proof.failure=[ordered]@{stage=$stage;message=$_.Exception.Message}}
finally{
  if(-not $retired -and $script:VpnFixtureChild){try{[IO.File]::WriteAllText($stopPath,('stop:'+ $script:VpnFixtureNonce),[Text.UTF8Encoding]::new($false));[void](Stop-VpnOwnedChild $script:VpnFixtureChild -TimeoutSeconds 15)}catch{$proof.retirementError=$_.Exception.Message}}
  $parentAfter=[Environment]::GetEnvironmentVariables('Process');$changed=$parentBefore.Count -ne $parentAfter.Count;foreach($key in $parentBefore.Keys){if($parentAfter[$key] -cne $parentBefore[$key]){$changed=$true}};$proof.parentEnvironmentChanged=$changed;if($changed){$proof.passed=$false;if(-not $primary){$primary='Parent environment changed'}}
  $proof.durationMs=$overall.ElapsedMilliseconds;[IO.File]::WriteAllText($EvidencePath,($proof|ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
}
if($primary){throw $primary}
$proof|ConvertTo-Json -Depth 10 -Compress
