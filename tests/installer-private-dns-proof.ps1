param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$project=Split-Path -Parent $PSScriptRoot
$testRoot=[IO.Path]::GetFullPath($TestDirectory)
$temporary=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
if(-not $testRoot.StartsWith($temporary,[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $testRoot -PathType Container)){throw 'Use a task-owned temporary fixture.'}
function Require([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
$tokens=$null;$errors=$null
$source=Join-Path $project 'scripts\invoke-final-silent-reinstall.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
Require ($errors.Count -eq 0) 'Production source failed Windows PowerShell parsing.'
foreach($name in @('Get-FileSha256','Assert-PlainWrapperMigrationPath','Get-SystemDohPrivatePolicyDigest','Get-SystemDohActivationDigest','Test-SystemDohConfigArgument','Get-SystemDohRecoveryFiles','Write-VerifiedSystemDohRecoveryRuntime','Test-OwnedSystemDohRecoveryRuntime','Start-PreservedServices','Get-SystemDohMigrationCandidateDigest','Get-PatchedSystemDohMigrationConfiguration')){
  $fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  Require ($null -ne $fn) ('Missing production function '+$name)
  . ([scriptblock]::Create($fn.Extent.Text))
}
function Assert-PreservedServiceRegistration {param($Record)if($script:registrationForeign){throw 'Fixture foreign registration'};return $true}
function Get-PreservedRegistryBackup {param($Record)return 'verified controlled registry snapshot'}
function Assert-CurrentPreservedServiceOwnership {param($Name,[switch]$RequirePresent)if($script:registrationForeign){throw 'Fixture foreign service'};return $true}
function Assert-InstallerBootRecoveryFileProtection {param($Path,[switch]$Directory)if($script:protectionForeign){throw 'Fixture untrusted file ACL'};return $true}
function Get-InstalledIdentity {return $script:state.installationId}
function Write-JsonAtomic {param($Path,$Value)[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 64),[Text.UTF8Encoding]::new($false))}
function Get-InstallerServiceState {
  param($Name)
  $script:readServices.Add([string]$Name)
  $status=if($script:recording){'Stopped'}else{'Running'}
  return [pscustomobject]@{Status=$status;ServiceName=$Name}
}
function Get-CimInstance {
  param($ClassName,$Filter,$Property,$Namespace,$ErrorAction,$OperationTimeoutSec)
  switch($ClassName){
    'Win32_Service' {
      $script:serviceReads++
      if($script:serviceReads -gt 1 -and $script:changeServicePid){return [pscustomobject]@{State='Running';ProcessId=999;PathName=$script:wrapper;StartName='LocalSystem'}}
      return $script:service
    }
    'Win32_Process' {
      if($script:changePrivateIntent){[IO.File]::AppendAllText($script:state.userState[0].source,' ')}
      if($script:changeOwnedJournal){[IO.File]::AppendAllText((Join-Path $script:OwnedDataRoot 'Service\dns-owned-state.json'),' ')}
      if($script:changeReceiptGeneration){$receipt=Get-Content -LiteralPath $script:receiptPath -Raw|ConvertFrom-Json;$receipt.generation=[Guid]::NewGuid().ToString('N');Write-JsonAtomic $script:receiptPath $receipt}
      return $script:processes
    }
    'MSFT_NetUDPEndpoint' {return $script:udp}
    'MSFT_NetTCPConnection' {return $script:tcp}
    default {throw ('Forbidden native CIM boundary '+$ClassName)}
  }
}
function Get-Process {
  param($Id,$ErrorAction)
  $item=@($script:processes|Where-Object {$_.ProcessId -eq $Id})[0]
  $held=[pscustomobject]@{Handle=1;HasExited=$script:heldExited;StartTime=([DateTime]$item.CreationDate).AddSeconds($script:heldBirthOffset);MainModule=[pscustomobject]@{FileName=if($script:heldWrongImage){'C:\foreign.exe'}else{$item.ExecutablePath}}}
  $held|Add-Member ScriptMethod Dispose {$script:disposed++}
  return $held
}
function Start-Service {param($Name,$ErrorAction)throw 'Unexpected native start; fixtures are already Running.'}
function Test-LoopbackDnsReady {param($State)return $script:upstreamReady}
function Restore-CriticalAdapterDns {param($State)$script:adapterWrites++}
function Add-ReceiptEvent {param($Stage,$Status,$Message)$script:receiptStatuses.Add([string]$Status)}
function Resolve-DnsName {throw 'Private ownership proof must not depend on an upstream DNS query.'}
function Set-DnsClientServerAddress {throw 'Forbidden native DNS write.'}
function Stop-Process {throw 'Forbidden native termination.'}
function sc.exe {throw 'Forbidden native SCM mutation.'}
function reg.exe {throw 'Forbidden native registry mutation.'}
$script:caseCount=0
$key=[string][char]233;$emoji=[string][char]0xD83D+[char]0xDE00
$vector=[pscustomobject]@{z=@($true,$null,[decimal]1.00)};$vector|Add-Member -NotePropertyName $key -NotePropertyValue $emoji
$expectedDigest='e14e265237ccbcdc188e0da7376d902982ad058354398f41b4663d082fc7d364'
Require ((Get-SystemDohMigrationCandidateDigest $vector) -ceq $expectedDigest) 'Private migration leaf-v1 differs from the native Unicode/decimal test vector.'
$reordered=[pscustomobject]@{};$reordered|Add-Member -NotePropertyName $key -NotePropertyValue $emoji;$reordered|Add-Member -NotePropertyName z -NotePropertyValue @($true,$null,[double]1e0)
Require ((Get-SystemDohMigrationCandidateDigest $reordered) -ceq $expectedDigest) 'Private migration digest depends on JSON property order or number spelling.'
$reordered.z=@($null,$true,[decimal]1)
Require ((Get-SystemDohMigrationCandidateDigest $reordered) -cne $expectedDigest) 'Private migration digest lost array order or primitive types.'
$original=[pscustomobject]@{dns=[pscustomobject]@{servers=@('https://private.example.invalid/dns-query');hosts=[pscustomobject]@{pinned='192.0.2.1'}};inbounds=@([pscustomobject]@{listen='127.0.0.1';port=53});log=[pscustomobject]@{loglevel='warning';error='private-log'}}
$before=$original|ConvertTo-Json -Depth 16 -Compress
$patched=Get-PatchedSystemDohMigrationConfiguration $original
Require (($original|ConvertTo-Json -Depth 16 -Compress) -ceq $before) 'Read-only candidate preparation mutated the production object.'
Require ((Get-SystemDohPrivatePolicyDigest $patched) -ceq (Get-SystemDohPrivatePolicyDigest $original)) 'Fixed migration changed the selected private policy.'
Require ($patched.dns.serveStale -eq $true -and $patched.dns.serveExpiredTTL -eq 120 -and $patched.dns.hosts.'health.egoist.invalid' -eq '127.0.0.1' -and $patched.log.error -eq '' -and $patched.log.loglevel -eq 'warning') 'Fixed migration candidate patch differs from native contract.'
$original.dns.hosts | Add-Member -NotePropertyName 'health.egoist.invalid' -NotePropertyValue '192.0.2.1'
$rejected=$false;try{[void](Get-PatchedSystemDohMigrationConfiguration $original)}catch{$rejected=$true}
Require $rejected 'Conflicting health marker was overwritten by candidate preparation.'
$script:caseCount+=4
function New-Fixture {
  $case=Join-Path $testRoot ([Guid]::NewGuid().ToString('N'))
  $script:StageDirectory=Join-Path $case 'stage'
  $script:RuntimeRoot=Join-Path $case 'Runtime'
  $script:OwnedDataRoot=Join-Path $case 'OwnedData'
  $script:component=Join-Path $script:RuntimeRoot 'SystemDoH'
  $script:backup=Join-Path $script:StageDirectory 'runtime-backup\SystemDoH'
  foreach($directory in @($script:component,$script:backup)){
    New-Item -ItemType Directory -Path (Join-Path $directory 'service-wrapper') -Force|Out-Null
    New-Item -ItemType Directory -Path (Join-Path $directory 'runtime') -Force|Out-Null
  }
  New-Item -ItemType Directory -Path (Join-Path $script:StageDirectory 'user-state') -Force|Out-Null
  New-Item -ItemType Directory -Path (Join-Path $script:OwnedDataRoot 'Service') -Force|Out-Null
  $script:config=Join-Path $script:component 'config.json'
  $script:wrapper=Join-Path $script:component 'service-wrapper\egoistshield-system-doh-service.exe'
  $script:engine=Join-Path $script:component 'runtime\xray-system-doh.exe'
  $script:xml=[IO.Path]::ChangeExtension($script:wrapper,'.xml')
  $configuration=@{dns=@{servers=@('https://private.example.invalid:8443/dns-query/fixture-only');queryStrategy='UseIPv4';hosts=@{'selected.example.invalid'='192.0.2.10'}};inbounds=@(@{listen='127.0.0.1';port=53;settings=@{network='tcp,udp'}})}
  [IO.File]::WriteAllText($script:config,($configuration|ConvertTo-Json -Depth 16))
  [IO.File]::WriteAllText($script:wrapper,'controlled wrapper bytes')
  [IO.File]::WriteAllText($script:engine,'controlled engine bytes')
  [IO.File]::WriteAllText($script:xml,('<service><id>EgoistShieldSystemDoH</id><executable>'+[Security.SecurityElement]::Escape($script:engine)+'</executable><arguments>run -c &quot;'+[Security.SecurityElement]::Escape($script:config)+'&quot;</arguments></service>'))
  foreach($relative in @('config.json','service-wrapper\egoistshield-system-doh-service.exe','service-wrapper\egoistshield-system-doh-service.xml','runtime\xray-system-doh.exe')){Copy-Item -LiteralPath (Join-Path $script:component $relative) -Destination (Join-Path $script:backup $relative)}
  $intent=Join-Path $case 'private-intent.json';[IO.File]::WriteAllText($intent,'{"settings":{"systemDohEnabled":true,"systemDohUrl":"https://private.example.invalid:8443/dns-query/fixture-only","zapretProfile":"fixture-old"}}')
  Copy-Item -LiteralPath $intent -Destination (Join-Path $script:StageDirectory 'user-state\state-0.json')
  $ownership='{"schemaVersion":1,"owner":"EgoistShield","servers":["127.0.0.1"]}'
  [IO.File]::WriteAllText((Join-Path $script:StageDirectory 'dns-owned-state.json'),$ownership)
  [IO.File]::WriteAllText((Join-Path $script:OwnedDataRoot 'Service\dns-owned-state.json'),$ownership)
  $script:state=[pscustomobject]@{installationId='00000000-0000-0000-0000-000000000038';services=@([pscustomobject]@{name='EgoistShieldSystemDoH';pathName=$script:wrapper;wrapperSha256=Get-FileSha256 $script:wrapper;wasRunning=$true;startMode='Auto'});userState=@([pscustomobject]@{backupName='state-0.json';source=$intent;sha256=Get-FileSha256 $intent});criticalDns=@([pscustomobject]@{servers=@('127.0.0.1')})}
  $birth=[DateTime]::Now.AddMinutes(-1)
  $script:service=[pscustomobject]@{State='Running';ProcessId=100;PathName=$script:wrapper;StartName='LocalSystem'}
  $script:processes=@([pscustomobject]@{ProcessId=100;ParentProcessId=1;ExecutablePath=$script:wrapper;CreationDate=$birth;CommandLine=$script:wrapper},[pscustomobject]@{ProcessId=101;ParentProcessId=100;ExecutablePath=$script:engine;CreationDate=$birth.AddSeconds(1);CommandLine=('"'+$script:engine+'" run -config "'+$script:config+'"')})
  $script:udp=@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=101});$script:tcp=@([pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=101})
  $script:serviceReads=0;$script:changeServicePid=$false;$script:changeReceiptGeneration=$false;$script:heldExited=$false;$script:heldBirthOffset=0;$script:heldWrongImage=$false;$script:disposed=0
  $script:changePrivateIntent=$false;$script:changeOwnedJournal=$false
  $script:registrationForeign=$false;$script:protectionForeign=$false;$script:recording=$true;$script:upstreamReady=$false;$script:adapterWrites=0
  $script:receiptStatuses=New-Object 'Collections.Generic.List[string]'
  $script:readServices=New-Object 'Collections.Generic.List[string]'
  $script:receiptPath=Join-Path $script:StageDirectory 'system-doh-migrated-runtime.json'
  Write-VerifiedSystemDohRecoveryRuntime $script:state
  $script:recording=$false
}
function Expect-Proof([string]$Name,[scriptblock]$Mutation,[bool]$Expected=$false,[switch]$Migrated){
  New-Fixture
  & $Mutation
  $actual=Test-OwnedSystemDohRecoveryRuntime -State $script:state -PreservedRuntimeRecovery:(-not $Migrated)
  Require ($actual -eq $Expected) ('Local private runtime proof '+$Name+' expected '+$Expected+' observed '+$actual)
  $script:caseCount++
}
Expect-Proof 'exact rollback snapshot' {} $true
Expect-Proof 'verified migrated snapshot' {} $true -Migrated
Expect-Proof 'config generation changed' {[IO.File]::AppendAllText($script:config,' ')}
Expect-Proof 'wrapper XML changed' {[IO.File]::AppendAllText($script:xml,' ')}
Expect-Proof 'wrapper image changed' {[IO.File]::AppendAllText($script:wrapper,' ')}
Expect-Proof 'engine image changed' {[IO.File]::AppendAllText($script:engine,' ')}
Expect-Proof 'private activation changed' {$intent=Get-Content -LiteralPath $script:state.userState[0].source -Raw|ConvertFrom-Json;$intent.settings.systemDohEnabled=$false;[IO.File]::WriteAllText($script:state.userState[0].source,($intent|ConvertTo-Json -Depth 16))}
Expect-Proof 'private activation URL changed' {$intent=Get-Content -LiteralPath $script:state.userState[0].source -Raw|ConvertFrom-Json;$intent.settings.systemDohUrl='https://different.example.invalid/dns-query';[IO.File]::WriteAllText($script:state.userState[0].source,($intent|ConvertTo-Json -Depth 16))}
Expect-Proof 'unrelated Zapret profile serialization is permitted' {$intent=Get-Content -LiteralPath $script:state.userState[0].source -Raw|ConvertFrom-Json;$intent.settings.zapretProfile='fixture-updated';[IO.File]::WriteAllText($script:state.userState[0].source,($intent|ConvertTo-Json -Depth 16))} $true
Expect-Proof 'owned DNS journal changed' {[IO.File]::AppendAllText((Join-Path $script:OwnedDataRoot 'Service\dns-owned-state.json'),' ')}
Expect-Proof 'foreign service registration' {$script:registrationForeign=$true}
Expect-Proof 'unsafe current file ACL' {$script:protectionForeign=$true}
Expect-Proof 'service stopped' {$script:service.State='Stopped'}
Expect-Proof 'foreign service account' {$script:service.StartName='DOMAIN\Other'}
Expect-Proof 'foreign wrapper path' {$script:service.PathName='C:\foreign.exe'}
Expect-Proof 'missing wrapper process' {$script:processes=@($script:processes[1])}
Expect-Proof 'missing engine child' {$script:processes=@($script:processes[0])}
Expect-Proof 'wrong engine parent' {$script:processes[1].ParentProcessId=999}
Expect-Proof 'foreign engine image' {$script:processes[1].ExecutablePath='C:\foreign.exe'}
Expect-Proof 'older child generation' {$script:processes[1].CreationDate=$script:processes[0].CreationDate.AddSeconds(-1)}
Expect-Proof 'different actual engine configuration' {$script:processes[1].CommandLine='xray run -c C:\foreign.json'}
Expect-Proof 'duplicate configuration arguments' {$script:processes[1].CommandLine+=' -c "'+$script:config+'"'}
Expect-Proof 'double dash foreign configuration override' {$script:processes[1].CommandLine+=' --config "C:\foreign.json"'}
Expect-Proof 'quoted double dash foreign configuration override' {$script:processes[1].CommandLine+=' "--config" "C:\foreign.json"'}
Expect-Proof 'quoted single dash foreign configuration override' {$script:processes[1].CommandLine+=' "-config" "C:\foreign.json"'}
Expect-Proof 'double dash config directory override' {$script:processes[1].CommandLine+=' --confdir "C:\foreign"'}
Expect-Proof 'quoted double dash config directory override' {$script:processes[1].CommandLine+=' "--confdir" "C:\foreign"'}
Expect-Proof 'single valid double dash configuration' {$script:processes[1].CommandLine='xray run --config="'+$script:config+'"'} $true
Expect-Proof 'single valid quoted double dash configuration' {$script:processes[1].CommandLine='xray run "--config" "'+$script:config+'"'} $true
Expect-Proof 'unexpected positional parser input' {$script:processes[1].CommandLine+=' foreign.json'}
Expect-Proof 'duplicate configuration flag missing value' {$script:processes[1].CommandLine+=' --config'}
Expect-Proof 'additional configuration directory' {$script:processes[1].CommandLine+=' -confdir C:\foreign'}
Expect-Proof 'held process exited' {$script:heldExited=$true}
Expect-Proof 'held process birth mismatch' {$script:heldBirthOffset=1}
Expect-Proof 'held process actual image mismatch' {$script:heldWrongImage=$true}
Expect-Proof 'UDP missing' {$script:udp=@()}
Expect-Proof 'TCP missing' {$script:tcp=@()}
Expect-Proof 'foreign UDP owner' {$script:udp[0].OwningProcess=999}
Expect-Proof 'foreign TCP owner' {$script:tcp[0].OwningProcess=999}
Expect-Proof 'foreign UDP wildcard collision' {$script:udp+=@([pscustomobject]@{LocalAddress='0.0.0.0';OwningProcess=999})}
Expect-Proof 'foreign TCP wildcard collision' {$script:tcp+=@([pscustomobject]@{LocalAddress='0.0.0.0';OwningProcess=999})}
Expect-Proof 'service PID changes during observation' {$script:changeServicePid=$true}
Expect-Proof 'receipt generation changes during observation' {$script:changeReceiptGeneration=$true} $false -Migrated
Expect-Proof 'private activation file mutation during observation' {$script:changePrivateIntent=$true}
Expect-Proof 'owned DNS journal mutation during observation' {$script:changeOwnedJournal=$true}
foreach($field in @('owner','stage','installationId','generation','privatePolicySha256','originalConfigSha256')){
  Expect-Proof ('receipt '+$field+' changed') { $receipt=Get-Content -LiteralPath $script:receiptPath -Raw|ConvertFrom-Json;$receipt.$field='foreign';Write-JsonAtomic $script:receiptPath $receipt } $false -Migrated
}
Expect-Proof 'receipt duplicate path' {$receipt=Get-Content -LiteralPath $script:receiptPath -Raw|ConvertFrom-Json;$receipt.files[1].path=$receipt.files[0].path;Write-JsonAtomic $script:receiptPath $receipt} $false -Migrated
Expect-Proof 'receipt changed file hash' {$receipt=Get-Content -LiteralPath $script:receiptPath -Raw|ConvertFrom-Json;$receipt.files[0].sha256='0'*64;Write-JsonAtomic $script:receiptPath $receipt} $false -Migrated
Expect-Proof 'receipt missing file' {$receipt=Get-Content -LiteralPath $script:receiptPath -Raw|ConvertFrom-Json;$receipt.files=@($receipt.files[0]);Write-JsonAtomic $script:receiptPath $receipt} $false -Migrated
New-Fixture
$script:recording=$true
$cfg=Get-Content -LiteralPath $script:config -Raw|ConvertFrom-Json
$cfg.dns|Add-Member NoteProperty serveStale $true
$cfg.dns|Add-Member NoteProperty serveExpiredTTL 120
$cfg.dns.hosts|Add-Member NoteProperty 'health.egoist.invalid' '127.0.0.1'
[IO.File]::WriteAllText($script:config,($cfg|ConvertTo-Json -Depth 16))
Write-VerifiedSystemDohRecoveryRuntime $script:state
$script:recording=$false
Require (Test-OwnedSystemDohRecoveryRuntime $script:state) 'A validated cache/health-marker migration was rejected.'
$script:caseCount++
foreach($change in @('provider','queryStrategy')){
  New-Fixture;$script:recording=$true
  $cfg=Get-Content -LiteralPath $script:config -Raw|ConvertFrom-Json
  if($change -eq 'provider'){$cfg.dns.servers=@('https://different.example.invalid/dns-query')}else{$cfg.dns.queryStrategy='UseIPv6'}
  [IO.File]::WriteAllText($script:config,($cfg|ConvertTo-Json -Depth 16))
  $refused=$false;try{Write-VerifiedSystemDohRecoveryRuntime $script:state}catch{$refused=$_.Exception.Message -like '*changed the preserved private DNS policy*'}
  Require $refused ('Migrated receipt accepted a changed private '+$change)
  $script:caseCount++
}
New-Fixture
Start-PreservedServices -State $script:state -PreservedRuntimeRecovery
Require ($script:adapterWrites -eq 0 -and $script:receiptStatuses.Contains('private-dns-degraded')) 'Private endpoint outage blocked local startup or changed adapter DNS.'
Require ($script:readServices.Contains('EgoistShieldCore')) 'Private endpoint outage stopped the service startup sequence before Core.'
$script:caseCount++
New-Fixture
$script:tcp[0].OwningProcess=999;$script:upstreamReady=$true
$refused=$false;try{Start-PreservedServices -State $script:state -PreservedRuntimeRecovery}catch{$refused=$_.Exception.Message -like '*local ownership*'}
Require ($refused -and $script:adapterWrites -eq 0) 'A foreign listener was accepted merely because an upstream readiness probe would succeed.'
$script:caseCount++
New-Fixture
$script:state.criticalDns=@();$script:tcp[0].OwningProcess=999;$script:upstreamReady=$true
$refused=$false;try{Start-PreservedServices -State $script:state -PreservedRuntimeRecovery}catch{$refused=$_.Exception.Message -like '*local ownership*'}
Require ($refused -and $script:adapterWrites -eq 0) 'An active DoH with no adapter snapshots bypassed local ownership proof.'
$script:caseCount++
# Execute the production worker's actual restoration commands in their source
# order. Wrapper/identity migrations are controlled, while receipt generation
# and readback use the real implementation and ordinary isolated files.
$workerAst=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-WorkerMode'},$true)
$migrationNames=@('Restore-PreservedState','Update-PreservedRuntimeReliability','Update-PreservedServiceWrappers','Reconcile-PreservedZapretProfile','Restore-InstalledIdentity','Restore-PreservedServiceStartModes','Write-VerifiedSystemDohRecoveryRuntime')
$migrationCommands=@($workerAst.FindAll({param($n)$n -is [Management.Automation.Language.CommandAst] -and $migrationNames -contains $n.GetCommandName()},$true)|Sort-Object {$_.Extent.StartOffset})
Require ($migrationCommands.Count -eq $migrationNames.Count) 'Production worker restoration commands are missing or ambiguous.'
New-Fixture
$script:recording=$true
function Restore-PreservedState {param($State)}
function Update-PreservedRuntimeReliability {param($State)}
function Update-PreservedServiceWrappers {param($State)[IO.File]::AppendAllText($script:wrapper,' verified migrated wrapper generation')}
function Reconcile-PreservedZapretProfile {param($State)}
function Restore-InstalledIdentity {param($State)}
function Restore-PreservedServiceStartModes {param($State)}
$state=$script:state
$keepDns=$false
foreach($command in $migrationCommands){& ([scriptblock]::Create($command.Extent.Text))}
$script:recording=$false
Require (Test-OwnedSystemDohRecoveryRuntime -State $state) 'Production worker pinned a receipt before its wrapper migration finished.'
$script:caseCount++
Write-Output ('Private DNS local proof checks: '+$script:caseCount+' passed; real config/XML/SHA readback, controlled CIM/held-process/ACL boundaries; native SCM/registry/network/termination mutations0')
