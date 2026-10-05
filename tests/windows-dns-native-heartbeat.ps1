param(
 [ValidateSet('Driver','Writer','Reader','Hold','Abandon')][string]$Mode='Driver',
 [Parameter(Mandatory=$true)][string]$Source,
 [Parameter(Mandatory=$true)][string]$WorkRoot,
 [Parameter(Mandatory=$true)][string]$WinPS5,
 [Parameter(Mandatory=$true)][string]$Pwsh,
 [string]$Output=''
)
if($PSVersionTable.PSEdition -eq 'Desktop'){$env:PSModulePath=Join-Path $PSHOME 'Modules'}
Set-StrictMode -Version 2
$ErrorActionPreference='Stop'
$own=[string]$env:LAGOM_TEST_TEMP
if(-not $own -or -not [IO.Path]::IsPathRooted($own) -or -not [IO.Directory]::Exists($own)){throw 'Private absolute LAGOM_TEST_TEMP is required.'}
$own=[IO.Path]::GetFullPath($own).TrimEnd('\')
$root=[IO.Path]::GetFullPath($WorkRoot)
if(-not $root.StartsWith(($own+'\'),[StringComparison]::OrdinalIgnoreCase) -or -not [IO.Directory]::Exists($root)){throw 'Exact own fixture root required.'}
foreach($p in @($root,$Source)){if((Get-Item -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse fixture input.'}}
$tokens=$null;$errors=$null;$tree=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($Source),[ref]$tokens,[ref]$errors)
if(@($errors).Count){throw 'Source AST failed.'}
foreach($name in @('Get-DnsGuardianHeartbeatMutex','Invoke-DnsGuardianHeartbeat','Read-DnsGuardianHeartbeatObservation')){
 $nodes=@($tree.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true))
 if($nodes.Count -ne 1){throw 'Actual helper not unique.'}
 . ([ScriptBlock]::Create($nodes[0].Extent.Text))
}
$script:DnsHeartbeat=Join-Path $root 'heartbeat.txt'
function Observe([Nullable[DateTimeOffset]]$Now){Read-DnsGuardianHeartbeatObservation $script:DnsHeartbeat $Now 180}
function Expect([bool]$Value,[string]$Why){if(-not $Value){throw $Why}}
function WaitOwn([string]$Name,[int]$Ms=5000){$t=[Diagnostics.Stopwatch]::StartNew();while(-not [IO.File]::Exists((Join-Path $root $Name))){if($t.ElapsedMilliseconds -gt $Ms){throw 'Own marker deadline.'};Start-Sleep -Milliseconds 2}}
if($Mode -in @('Hold','Abandon')){
 $m=Get-DnsGuardianHeartbeatMutex $script:DnsHeartbeat
 Expect ($m.WaitOne(500)) 'Own lock failed.'
 [IO.File]::WriteAllText((Join-Path $root 'lock-ready.txt'),'ready')
 if($Mode -eq 'Abandon'){WaitOwn 'abandon-release.txt';exit 0}
 try{WaitOwn 'release.txt'}finally{$m.ReleaseMutex();$m.Dispose()}
 [Console]::Out.WriteLine('{"heldComplete":true}')
 exit 0
}
if($Mode -eq 'Writer'){
 WaitOwn 'go.txt'
 for($i=0;$i -lt 2000;$i++){Invoke-DnsGuardianHeartbeat;if($i % 10 -eq 0){Start-Sleep -Milliseconds 1}}
 $hash=(Get-FileHash -LiteralPath $script:DnsHeartbeat -Algorithm SHA256).Hash
 [IO.File]::WriteAllText((Join-Path $root 'writer-done.txt'),'done')
 [Console]::Out.WriteLine((@{writerComplete=$true;writes=2000;heartbeatSHA256=$hash}|ConvertTo-Json -Compress))
 exit 0
}
if($Mode -eq 'Reader'){
 [IO.File]::WriteAllText((Join-Path $root 'reader-ready.txt'),'ready');WaitOwn 'go.txt'
 $r=0;$bad=@{};$t=[Diagnostics.Stopwatch]::StartNew()
 do{
  $o=Observe $null;$r++
  if($o.status -cne 'fresh'){$key=$o.status+'|'+$o.failureClass+'|'+$o.failureHResult;if($bad.ContainsKey($key)){$bad[$key]++}else{$bad[$key]=1}}
  if($t.ElapsedMilliseconds -gt 25000){throw 'Own reader deadline.'}
  Start-Sleep -Milliseconds 1
 }while(-not [IO.File]::Exists((Join-Path $root 'writer-done.txt')) -or $r -lt 200)
 [Console]::Out.WriteLine((@{readerComplete=$true;edition=$PSVersionTable.PSEdition;version=$PSVersionTable.PSVersion.ToString();reads=$r;bad=$bad}|ConvertTo-Json -Compress))
 if($bad.Count){exit 1}
 exit 0
}
$children=New-Object 'System.Collections.Generic.List[object]'
$cases=New-Object 'System.Collections.Generic.List[object]'
$report=[ordered]@{schemaVersion=1;success=$false;version=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition;sourceSHA256=(Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash;nativeActions=0;cases=@();children=@();errorClass=$null}
$elapsed=[Diagnostics.Stopwatch]::StartNew()
function Check([string]$Name,[scriptblock]$Body){& $Body;$cases.Add([pscustomobject]@{name=$Name;passed=$true})}
function Child([string]$Shell,[string]$Case){
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$Shell;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $info.Arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Mode '+$Case+' -Source "'+$Source+'" -WorkRoot "'+$root+'" -WinPS5 "'+$WinPS5+'" -Pwsh "'+$Pwsh+'"'
 $p=[Diagnostics.Process]::new();$p.StartInfo=$info;Expect ($p.Start()) 'Own child launch failed.'
 $c=[pscustomobject]@{process=$p;handle=$p.Handle;birth=$p.StartTime.ToUniversalTime();image=$Shell;stdout=$p.StandardOutput.ReadToEndAsync();stderr=$p.StandardError.ReadToEndAsync();mode=$Case;retired=$false;proof=$null}
 $children.Add($c)
 $identityWatch=[Diagnostics.Stopwatch]::StartNew();$actualImage=$null
 while(-not $actualImage -and $identityWatch.ElapsedMilliseconds -lt 2000 -and -not $p.HasExited){try{$module=$p.MainModule;if($module){$actualImage=$module.FileName}}catch{};if(-not $actualImage){Start-Sleep -Milliseconds 2}}
 Expect ($c.handle -ne [IntPtr]::Zero -and $actualImage -ieq $Shell) 'Own child identity failed.'
 return $c
}
function Finish($C,[int]$Ms=5000){
 Expect ($C.process.WaitForExit($Ms)) 'Own child deadline.'
 Expect ($C.stdout.Wait(2000) -and $C.stderr.Wait(2000)) 'Own streams drain.'
 Expect ($C.stdout.Result.Length -le 4096 -and $C.stderr.Result.Length -le 4096) 'Own stream cap.'
 $C.proof=[ordered]@{mode=$C.mode;pid=$C.process.Id;birthUtc=$C.birth.ToString('o');exit=$C.process.ExitCode;stderrLength=$C.stderr.Result.Length;stdoutLength=$C.stdout.Result.Length}
 Expect ($C.process.ExitCode -eq 0 -and $C.stderr.Result.Length -eq 0) 'Own child failed.'
 if($C.stdout.Result.Trim()){return ($C.stdout.Result.Trim()|ConvertFrom-Json)}
 return $null
}
try{
 Check 'Fresh serialized writer and bounded reader' {Invoke-DnsGuardianHeartbeat;Expect ((Observe $null).status -ceq 'fresh') 'Fresh refused.'}
 Check 'Legacy truncate sharing race is false stale and new unavailable is honest' {
  $previous=[IO.File]::ReadAllText($script:DnsHeartbeat);$held=[IO.File]::Open($script:DnsHeartbeat,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try{$stale=$false;$hr=$null;try{[void][DateTimeOffset]::Parse([IO.File]::ReadAllText($script:DnsHeartbeat))}catch{$stale=$true;$hr=$_.Exception.GetBaseException().HResult};Expect ($stale -and $hr -eq -2147024864) 'Legacy control differed.';Expect ((Observe $null).status -ceq 'unavailable') 'Sharing accepted.'}finally{$held.Dispose()}
  $report.legacySharingHResult=$hr;Expect (([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($previous)).TotalSeconds -lt 180) 'Actual old expiry.';Invoke-DnsGuardianHeartbeat
 }
 Check 'Contended lock bounded read unavailable and writer failure preserve bytes' {
  $old=[IO.File]::ReadAllBytes($script:DnsHeartbeat);$c=Child $WinPS5 'Hold';WaitOwn 'lock-ready.txt'
  $watch=[Diagnostics.Stopwatch]::StartNew();$o=Observe $null;$readMs=$watch.ElapsedMilliseconds
  Expect ($o.status -ceq 'unavailable' -and $o.failureClass -ceq 'lock-timeout' -and $readMs -lt 1000) 'Read contention guard changed.'
  $failed=$false;$watch.Restart();try{Invoke-DnsGuardianHeartbeat}catch{$failed=$true};$writeMs=$watch.ElapsedMilliseconds
  Expect ($failed -and $writeMs -lt 1000) 'Writer contention not surfaced.'
  [IO.File]::WriteAllText((Join-Path $root 'release.txt'),'release');[void](Finish $c)
  Expect ([Convert]::ToBase64String($old) -ceq [Convert]::ToBase64String([IO.File]::ReadAllBytes($script:DnsHeartbeat))) 'Contended writer changed old bytes.'
  $report.lockTimeoutReadMs=$readMs;$report.lockTimeoutWriteMs=$writeMs
  [IO.File]::Delete((Join-Path $root 'lock-ready.txt'));[IO.File]::Delete((Join-Path $root 'release.txt'))
 }
 Check 'Abandoned ownership released and unavailable without grace' {
  $m=Get-DnsGuardianHeartbeatMutex $script:DnsHeartbeat
  try{$c=Child $WinPS5 'Abandon';WaitOwn 'lock-ready.txt';[IO.File]::WriteAllText((Join-Path $root 'abandon-release.txt'),'release');[void](Finish $c);$o=Observe $null;Expect ($o.status -ceq 'unavailable' -and $o.failureClass -ceq 'lock-abandoned') 'Abandonment accepted.';Expect ((Observe $null).status -ceq 'fresh') 'Abandoned reader leaked ownership.'}finally{$m.Dispose()}
  [IO.File]::Delete((Join-Path $root 'lock-ready.txt'));[IO.File]::Delete((Join-Path $root 'abandon-release.txt'))
 }
 Check 'Writer abandonment surfaced and ownership released' {
  $m=Get-DnsGuardianHeartbeatMutex $script:DnsHeartbeat
  try{$c=Child $WinPS5 'Abandon';WaitOwn 'lock-ready.txt';[IO.File]::WriteAllText((Join-Path $root 'abandon-release.txt'),'release');[void](Finish $c);$failed=$false;try{Invoke-DnsGuardianHeartbeat}catch{$failed=$_.Exception.GetBaseException() -is [Threading.AbandonedMutexException]};Expect $failed 'Writer abandonment hidden.';Invoke-DnsGuardianHeartbeat;Expect ((Observe $null).status -ceq 'fresh') 'Writer leaked lock.'}finally{$m.Dispose()}
  [IO.File]::Delete((Join-Path $root 'lock-ready.txt'));[IO.File]::Delete((Join-Path $root 'abandon-release.txt'))
 }
 Check 'Failed replacement preserves committed bytes and cleans own temp' {
  $old=[IO.File]::ReadAllBytes($script:DnsHeartbeat);$held=[IO.File]::Open($script:DnsHeartbeat,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try{$failed=$false;try{Invoke-DnsGuardianHeartbeat}catch{$failed=$true};Expect $failed 'Replace unexpectedly succeeded.'}finally{$held.Dispose()}
  Expect ([Convert]::ToBase64String($old) -ceq [Convert]::ToBase64String([IO.File]::ReadAllBytes($script:DnsHeartbeat))) 'Failed write altered committed bytes.'
  Expect (@([IO.Directory]::GetFiles($root,'heartbeat.txt.*.tmp')).Count -eq 0) 'Owned temp leaked.'
 }
 Check 'Original exact180 and genuine180.001-second expiry' {
  $now=[DateTimeOffset]::Parse('2026-10-05T00:00:00.0000000+00:00')
  [IO.File]::WriteAllText($script:DnsHeartbeat,$now.AddSeconds(-180).ToString('o'));Expect ((Observe $now).status -ceq 'fresh') '180 boundary changed.'
  [IO.File]::WriteAllText($script:DnsHeartbeat,$now.AddMilliseconds(-180001).ToString('o'));Expect ((Observe $now).status -ceq 'expired') 'Expiry not found.'
 }
 Check 'Missing malformed empty oversized immediate unavailable' {
  [IO.File]::Delete($script:DnsHeartbeat);Expect ((Observe $null).status -ceq 'unavailable') 'Missing accepted.'
  foreach($b in @([byte[]]@(),[byte[]]@(255),[byte[]]::new(129))){[IO.File]::WriteAllBytes($script:DnsHeartbeat,$b);Expect ((Observe $null).failureClass -ceq 'invalid') 'Invalid accepted.'}
  Invoke-DnsGuardianHeartbeat
 }
 $sourceText=[IO.File]::ReadAllText($Source)
 $match=[Text.RegularExpressions.Regex]::Match($sourceText,'(?m)^\s+if\((?<condition>-not \$alive -or \$stale -or \$watch\.Elapsed\.TotalSeconds -gt \$plan\.maximumSeconds -or \(Test-Path -LiteralPath \(\[string\]\$plan\.force\)\))\)\{\r?\n\s+\$record\.stage=[^\r\n]*;\$record\.reason=(?<reason>[^\r\n]+)')
 Expect $match.Success 'Actual guardian expressions missing.'
 $condition=[ScriptBlock]::Create($match.Groups['condition'].Value);$reason=[ScriptBlock]::Create($match.Groups['reason'].Value)
 foreach($case in @(
  @{name='Fresh lease';alive=$true;status='fresh';elapsed=10;force=$false;trigger=$false;reason=$null},
  @{name='Expired fail closed';alive=$true;status='expired';elapsed=10;force=$false;trigger=$true;reason='heartbeat expired'},
  @{name='Unavailable fail closed';alive=$true;status='unavailable';elapsed=10;force=$false;trigger=$true;reason='heartbeat unavailable'},
  @{name='Parent identity precedence';alive=$false;status='unavailable';elapsed=1201;force=$true;trigger=$true;reason='parent exited/identity changed'},
  @{name='Exact1200 retained';alive=$true;status='fresh';elapsed=1200;force=$false;trigger=$false;reason=$null},
  @{name='Hard1200.001 deadline';alive=$true;status='fresh';elapsed=1200.001;force=$false;trigger=$true;reason='maximum lease expired'},
  @{name='Caller force';alive=$true;status='fresh';elapsed=10;force=$true;trigger=$true;reason='caller failure'}
  )){
  $alive=$case.alive;$heartbeatObservation=[pscustomobject]@{status=$case.status};$stale=$case.status -cne 'fresh';$watch=[pscustomobject]@{Elapsed=[pscustomobject]@{TotalSeconds=$case.elapsed}};$plan=[pscustomobject]@{maximumSeconds=1200;force=(Join-Path $root 'force.txt')}
  if($case.force){[IO.File]::WriteAllText($plan.force,'force')}elseif([IO.File]::Exists($plan.force)){[IO.File]::Delete($plan.force)}
  $actual=[bool](& $condition);Expect ($actual -eq $case.trigger) 'Trigger changed.'
  if($actual){Expect ((& $reason) -ceq $case.reason) 'Reason changed.'}
  $cases.Add([pscustomobject]@{name=$case.name;passed=$true})
 }
 if([IO.File]::Exists((Join-Path $root 'force.txt'))){[IO.File]::Delete((Join-Path $root 'force.txt'))}
 Invoke-DnsGuardianHeartbeat
 $reader=Child $WinPS5 'Reader';WaitOwn 'reader-ready.txt';$writer=Child $Pwsh 'Writer'
 [IO.File]::WriteAllText((Join-Path $root 'go.txt'),'go')
 $r=0;$bad=@{};$ioWatch=[Diagnostics.Stopwatch]::StartNew()
 do{
  $o=Observe $null;$r++
  if($o.status -cne 'fresh'){$key=$o.status+'|'+$o.failureClass+'|'+$o.failureHResult;if($bad.ContainsKey($key)){$bad[$key]++}else{$bad[$key]=1}}
  $report.readerDriver=[ordered]@{reads=$r;bad=$bad;edition=$PSVersionTable.PSEdition}
  if($ioWatch.ElapsedMilliseconds -gt 25000){throw 'Own stress deadline.'}
  Start-Sleep -Milliseconds 1
 }while(-not [IO.File]::Exists((Join-Path $root 'writer-done.txt')) -or $r -lt 200)
 $writerProof=Finish $writer;$readerProof=Finish $reader
 $report.writer=$writerProof;$report.reader5=$readerProof;$report.readerDriver=[ordered]@{reads=$r;bad=$bad;edition=$PSVersionTable.PSEdition}
 Expect ($writerProof.writerComplete -and $writerProof.writes -eq 2000 -and $readerProof.readerComplete -and $readerProof.reads -ge 200 -and @($readerProof.bad.psobject.Properties).Count -eq 0 -and $bad.Count -eq 0) 'Serialized stress failed.'
 Expect ($writerProof.heartbeatSHA256 -ceq (Get-FileHash -LiteralPath $script:DnsHeartbeat -Algorithm SHA256).Hash) 'Final committed hash mismatch.'
 Expect (@([IO.Directory]::GetFiles($root,'heartbeat.txt.*.tmp')).Count -eq 0) 'Writer temp leak.'
 $cases.Add([pscustomobject]@{name='2000 writes with simultaneous actual PS5 and driver readers';passed=$true})
 $report.success=$true
}catch{$report.errorClass=$_.Exception.GetBaseException().GetType().FullName;throw
}finally{
 foreach($c in $children){
  if(-not $c.process.HasExited){
   if($c.handle -eq [IntPtr]::Zero -or $c.process.StartTime.ToUniversalTime() -ne $c.birth -or $c.process.MainModule.FileName -ine $c.image){throw 'Uncertain own child retirement.'}
   $c.process.Kill();$c.retired=$true;Expect ($c.process.WaitForExit(5000)) 'Own child retirement failed.'
  }
  if(-not $c.proof){$c.proof=[ordered]@{mode=$c.mode;pid=$c.process.Id;birthUtc=$c.birth.ToString('o');exit=$c.process.ExitCode}}
  $c.proof.forcedRetired=$c.retired;$c.proof.exited=$c.process.HasExited;$report.children+=@($c.proof);$c.process.Dispose()
 }
 $report.cases=@($cases.ToArray());$report.caseCount=$cases.Count;$report.elapsedMs=$elapsed.ElapsedMilliseconds
 if($Output){
  $out=[IO.Path]::GetFullPath($Output);Expect ($out.StartsWith(($root+'\'),[StringComparison]::OrdinalIgnoreCase)) 'Own output escaped.'
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($report|ConvertTo-Json -Depth 10));$f=[IO.File]::Open($out,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read);try{$f.Write($bytes,0,$bytes.Length)}finally{$f.Dispose()}
 }
}
$report|ConvertTo-Json -Depth 10 -Compress
if(-not $report.success){exit 1}

