param(
    [Parameter(Mandatory = $true)][string]$TestDirectory,
    [ValidateSet('current', 'baseline')][string]$Mode = 'current',
    [string]$BaselineSnapshot = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSEdition -ne 'Desktop') {
    throw 'This regression requires Windows PowerShell 5.1.'
}
$fixtureRoot = [IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
if ((Split-Path -Leaf $fixtureRoot) -notmatch '^wlr-[a-zA-Z0-9]{6}$') {
    throw 'Use an isolated, short fixture root created by the wrapper.'
}
if ((Get-Item -LiteralPath $fixtureRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The fixture root must be ordinary.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try { $script:fixtureSid = $identity.User.Value } finally { $identity.Dispose() }
$script:checks = 0
$script:results = New-Object 'System.Collections.Generic.List[object]'
$utf8 = New-Object Text.UTF8Encoding($false)
function Check {
    param([bool]$Condition, [string]$Because)
    if (-not $Condition) { throw "Fixture assertion: $Because" }
    $script:checks++
}
function Write-FixtureFile {
    param([string]$Path, [string]$Content)
    $full = [IO.Path]::GetFullPath($Path)
    Check ($full.StartsWith($fixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'file stays in own fixture'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $full))
    [IO.File]::WriteAllText($full, $Content, $utf8)
    # Elevated tokens may default new-file ownership to Administrators.
    # Set only the owner of this newly created fixture file; retain its DACL.
    $acl = [IO.File]::GetAccessControl($full, [Security.AccessControl.AccessControlSections]::Owner)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($script:fixtureSid))
    [IO.File]::SetAccessControl($full, $acl)
}
function New-FixtureCase {
    param([string]$Name, [string]$Component = 'Zapret', [string]$RelativeLog = 'logs\zapret-service\egoistshield-zapret-service.wrapper.log')
    $caseRoot = Join-Path $fixtureRoot $Name
    $script:programDataRoot = Join-Path $caseRoot 'p'
    $script:ownedRoots = @(Join-Path $programDataRoot 'EgoistShield')
    $source = Join-Path $programDataRoot ('EgoistShield\Runtime\' + $Component)
    $destination = $source + '.upgrade-old-' + [Guid]::NewGuid().ToString('N')
    $stage = Join-Path $caseRoot 'protected-stage'
    foreach ($directory in @($source, $destination, $stage)) { [void][IO.Directory]::CreateDirectory($directory) }
    # The actual protected-metadata check also reads this newly created stage
    # directory through a held handle. Select its fixture owner; retain its DACL.
    $stageAcl = [IO.Directory]::GetAccessControl($stage, [Security.AccessControl.AccessControlSections]::Owner)
    $stageAcl.SetOwner([Security.Principal.SecurityIdentifier]::new($script:fixtureSid))
    [IO.Directory]::SetAccessControl($stage, $stageAcl)
    $liveLog = Join-Path $source $RelativeLog
    $oldLog = Join-Path $destination $RelativeLog
    Write-FixtureFile $liveLog "historical line`r`nnew appended line`r`n"
    Write-FixtureFile $oldLog "historical line`r`n"
    Write-FixtureFile (Join-Path $destination 'missing.config') 'quarantined config to restore'
    $wrapperNames = @{Zapret='egoistshield-zapret-service';TelegramProxy='egoistshield-telegram-proxy-service';Vpn='egoistshield-vpn-service'}
    $wrapperName = $wrapperNames[$Component]
    if ($wrapperName) {
        Write-FixtureFile (Join-Path $source ('service-wrapper\' + $wrapperName + '.exe')) 'controlled fixture wrapper bytes; never executed'
        Write-FixtureFile (Join-Path $destination ('service-wrapper\' + $wrapperName + '.exe')) 'controlled fixture wrapper bytes; never executed'
    }
    return [pscustomobject]@{
        name = $Name; root = $caseRoot; source = $source; destination = $destination
        stage = $stage; liveLog = $liveLog; oldLog = $oldLog
        liveHash = Get-FileSha256 $liveLog; oldHash = Get-FileSha256 $oldLog
        record = [pscustomobject]@{ source = $source; destination = $destination }
    }
}
function Check-Preserved {
    param([object]$Case)
    Check ((Get-FileSha256 $Case.liveLog) -ceq $Case.liveHash) 'live log bytes preserved'
    Check ((Get-FileSha256 $Case.oldLog) -ceq $Case.oldHash) 'quarantined log bytes preserved'
    Check ([IO.File]::Exists((Join-Path $Case.destination 'missing.config'))) 'missing config not moved before refusal'
    Check (-not [IO.File]::Exists((Join-Path $Case.source 'missing.config'))) 'live config not created before refusal'
    Check (-not [IO.Directory]::Exists((Join-Path $Case.stage 'recovery-log-history'))) 'no history archive created before refusal'
}

if ($Mode -eq 'baseline') {
    if (-not $BaselineSnapshot) { throw 'Baseline mode requires the captured actual pre-fix AST.' }
    $baseline = Get-Content -LiteralPath $BaselineSnapshot -Raw | ConvertFrom-Json
    Check ($baseline.sourceSha256 -ceq 'cccf847287b454199ceffec3ff57b4de1caa978e9a1453bad528507bce197daf') 'actual pre-fix source pin'
    foreach ($entry in $baseline.functions.PSObject.Properties) { . ([scriptblock]::Create([string]$entry.Value)) }
    $case = New-FixtureCase 'baseline'
    $failure = $null
    try { Merge-StaleOwnedRuntimeDirectory $case.source $case.destination } catch { $failure = $_ }
    Check ([bool]$failure) 'actual old merge rejects append-only wrapper log collision'
    Check ($failure.Exception.Message.Contains('Different runtime files require recovery')) 'failure is the actual collision guard'
    Check-Preserved $case
    [pscustomobject]@{
        mode = 'baseline'; result = 'RED expected'; nativeVersion = [string]$PSVersionTable.PSVersion
        sourceSha256 = $baseline.sourceSha256; cases = 1; checks = $script:checks
        oldMergeRefused = $true; bothLogCopiesPreserved = $true; operationalCalls = 0
    } | ConvertTo-Json -Depth 4
    return
}

$sourcePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\owned-cleanup.ps1'
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$errors)
Check ($errors.Count -eq 0) 'current source parses'
$required = @(
    'Resolve-NormalizedPath', 'Get-ExecutableFromCommandLine', 'Test-OwnedPath', 'Assert-OwnedPath',
    'ConvertFrom-JsonCollectionCompat', 'Get-FileSha256', 'Assert-PlainOwnedDirectoryTree',
    'Read-OwnedRuntimeQuarantine', 'Merge-StaleOwnedRuntimeDirectory', 'Restore-OwnedRuntimeQuarantine',
    'Write-Journal', 'Test-SystemDohContinuitySha256', 'Initialize-ProtectedInstallerHeartbeatNative',
    'Open-OwnedRuntimeLogRecoveryFile', 'Close-OwnedRuntimeLogRecoveryFile', 'Open-OwnedRuntimeLogRecoveryTree',
    'Assert-OwnedRuntimeLogRecoveryIdentity', 'Assert-OwnedWrapperLogRecoveryService', 'Preserve-OwnedRuntimeWrapperLogCollisions'
)
foreach ($name in $required) {
    $nodes = @($ast.FindAll({ param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
    }, $true))
    Check ($nodes.Count -eq 1) ('one actual helper: ' + $name)
    $body = $nodes[0].Extent.Text
    if ($name -eq 'Merge-StaleOwnedRuntimeDirectory' -and $BaselineSnapshot) {
        $baseline = Get-Content -LiteralPath $BaselineSnapshot -Raw | ConvertFrom-Json
        Check ($body.Replace("`r`n", "`n") -ceq ([string]$baseline.functions.'Merge-StaleOwnedRuntimeDirectory').Replace("`r`n", "`n")) 'strict Merge body unchanged from actual baseline'
    }
    if ($name -eq 'Preserve-OwnedRuntimeWrapperLogCollisions') {
        # Only the two ACL-constructor owner/SID boundaries become own-user
        # fixture authority. All handles, hashes, identities, moves and receipt
        # writes remain the actual source statements, including private ACL I/O.
        $ownerExpression = ".SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))"
        Check (($body.Split(@($ownerExpression), [StringSplitOptions]::None).Length - 1) -eq 2) 'exact two history ACL owner boundaries'
        $body = $body.Replace($ownerExpression, ".SetOwner([Security.Principal.SecurityIdentifier]::new('$fixtureSid'))")
        $aceExpression = "foreach (`$sid in @('S-1-5-18','S-1-5-32-544'))"
        Check ($body.Contains($aceExpression)) 'exact history ACL ACE boundary'
        $body = $body.Replace($aceExpression, "foreach (`$sid in @('S-1-5-18','S-1-5-32-544','$fixtureSid'))")
    }
    . ([scriptblock]::Create($body))
}
$bootPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'src\installer\maintenance-boot-recovery.ps1'
$bootHash = (Get-FileHash -LiteralPath $bootPath -Algorithm SHA256).Hash.ToLowerInvariant()
$bootAst = [Management.Automation.Language.Parser]::ParseFile($bootPath, [ref]$tokens, [ref]$errors)
Check ($errors.Count -eq 0) 'boot source parses'
$plain = $bootAst.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-InstallerBootRecoveryPlainPath'
}, $true)
Check ([bool]$plain) 'actual plain-path helper exists'
. ([scriptblock]::Create($plain.Extent.Text))

# Controlled authority boundaries for owned fixture paths. Actual native
# ReadAcl still reads each held handle; this does not test production ACL/admin
# authorization or protected transaction/task verification.
$script:runtimeAclReads = 0
$script:protectedAclReads = 0
$script:scmQueries = 0
function Get-CimInstance {
    param([string]$ClassName, [string]$Filter, [int]$OperationTimeoutSec, [string]$ErrorAction)
    Check ($ClassName -ceq 'Win32_Service' -and $OperationTimeoutSec -eq 3 -and $ErrorAction -ceq 'Stop') 'controlled SCM query contract'
    Check ($Filter -cmatch "\AName='(EgoistShieldZapret|EgoistShieldTelegramProxy|EgoistShieldVpn)'\z") 'controlled SCM exact fixed-name filter'
    $name = $Matches[1]
    $definitions = @{
        EgoistShieldZapret=@('Zapret','egoistshield-zapret-service')
        EgoistShieldTelegramProxy=@('TelegramProxy','egoistshield-telegram-proxy-service')
        EgoistShieldVpn=@('Vpn','egoistshield-vpn-service')
    }
    $definition = $definitions[$name]
    $source = Join-Path $programDataRoot ('EgoistShield\Runtime\' + $definition[0])
    $wrapper = Join-Path $source ('service-wrapper\' + $definition[1] + '.exe')
    $script:scmQueries++
    if ($script:scmMode -ceq 'missing') { return }
    $state = if ($script:scmMode -ceq 'running') { 'Running' } else { 'Stopped' }
    if ($script:scmMode -ceq 'foreign-path') { $wrapper = Join-Path $script:activeCase.root 'foreign-wrapper.exe' }
    return [pscustomobject]@{Name=$name;State=$state;StartName='LocalSystem';PathName='"' + $wrapper + '"'}
}
function Assert-OwnedRuntimeLogRecoverySecurity {
    param([Security.AccessControl.FileSecurity]$Acl)
    Check ($Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $fixtureSid) 'held runtime ACL belongs to fixture user'
    $script:runtimeAclReads++
}
function Assert-ProtectedInstallerHeartbeatSecurity {
    param([Security.AccessControl.FileSecurity]$Acl, [switch]$Directory)
    Check ($Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ceq $fixtureSid) 'held private metadata ACL belongs to fixture user'
    $script:protectedAclReads++
}
function Assert-InstallerBootRecoveryFileProtection {
    param([string]$Path, [switch]$Directory)
    Check ([IO.Path]::GetFullPath($Path).StartsWith($fixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'ACL boundary only inside own fixture'
    $handle = $null
    try {
        if ($Directory) { $handle = [LagomInstallerHeartbeatSnapshotNative]::PinDirectory($Path) }
        else { $handle = [LagomInstallerHeartbeatSnapshotNative]::OpenHandle($Path) }
        $acl = [LagomInstallerHeartbeatSnapshotNative]::ReadAcl($handle)
        Assert-ProtectedInstallerHeartbeatSecurity -Acl $acl -Directory:$Directory
    } finally { if ($handle) { $handle.Dispose() } }
}
function Test-VerifiedProtectedReinstall {
    Check ($env:EGOIST_PROTECTED_REINSTALL_STAGE -ceq $script:activeCase.stage) 'authentication boundary uses exact own stage'
    Check ((Get-FileSha256 (Join-Path $script:activeCase.stage 'state.json')) -ceq $script:activeStateHash) 'authentication boundary uses unchanged own state'
    return $true
}
function Activate-FixtureCase {
    param([object]$Case, [object[]]$Records = @())
    $script:activeCase = $Case
    $script:scmMode = 'stopped'
    $script:programDataRoot = Join-Path $Case.root 'p'
    $script:ownedRoots = @(Join-Path $programDataRoot 'EgoistShield')
    $script:upgradeStateDirectory = Join-Path $Case.root 'u'
    $script:runtimeQuarantineManifestPath = Join-Path $upgradeStateDirectory 'runtime-quarantine.json'
    $script:upgradeJournalPath = Join-Path $upgradeStateDirectory 'journal.jsonl'
    $script:Phase = 'Recover'
    $script:installRoot = Join-Path $Case.root 'installation'
    $env:EGOIST_PROTECTED_REINSTALL_STAGE = $Case.stage
    if ($Records.Count -eq 0) { $Records = @($Case.record) }
    Write-FixtureFile $runtimeQuarantineManifestPath (ConvertTo-Json -InputObject @($Records) -Depth 4)
    $wrapper = Join-Path $Case.source 'service-wrapper\egoistshield-zapret-service.exe'
    $oldWrapper = Join-Path $Case.destination 'service-wrapper\egoistshield-zapret-service.exe'
    $services = @()
    if ([IO.File]::Exists($oldWrapper)) {
        $services = @([ordered]@{name='EgoistShieldZapret';pathName='"' + $wrapper + '"';registration=@{account='LocalSystem'};wrapperSha256=Get-FileSha256 $oldWrapper})
    }
    Write-FixtureFile (Join-Path $Case.stage 'state.json') (ConvertTo-Json -InputObject @{services=$services} -Depth 5)
    $script:activeStateHash = Get-FileSha256 (Join-Path $Case.stage 'state.json')
}
function Invoke-Refusal {
    param([object]$Case, [string]$Reason, [switch]$WritableLiveLog)
    $failure = $null
    $writer = $null
    try {
        if ($WritableLiveLog) { $writer = [IO.File]::Open($Case.liveLog,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete) }
        try { Restore-OwnedRuntimeQuarantine } catch { $failure = $_ }
    } finally { if ($writer) { $writer.Dispose() } }
    Check ([bool]$failure) ($Reason + ' refuses actual Restore')
    Check-Preserved $Case
    Check ([IO.File]::Exists($runtimeQuarantineManifestPath)) ($Reason + ' quarantine manifest retained')
    $script:results.Add([pscustomobject]@{case=$Reason;refused=$true;archiveCreated=$false;copiesPreserved=$true})
    return $failure
}

$positive = New-FixtureCase 'good'
Activate-FixtureCase $positive
$oldIdentityLease = Open-OwnedRuntimeLogRecoveryFile -Path $positive.oldLog
$oldIdentity = $oldIdentityLease.fileInfo
Close-OwnedRuntimeLogRecoveryFile $oldIdentityLease
$liveIdentityLease = Open-OwnedRuntimeLogRecoveryFile -Path $positive.liveLog
$liveIdentity = $liveIdentityLease.fileInfo
Close-OwnedRuntimeLogRecoveryFile $liveIdentityLease
$output = @(Restore-OwnedRuntimeQuarantine)
Check ($output.Count -eq 0) 'Restore and archive helpers emit no output'
Check (-not [IO.Directory]::Exists($positive.destination)) 'actual strict Merge removes emptied quarantine'
Check (-not [IO.File]::Exists($runtimeQuarantineManifestPath)) 'actual Restore clears manifest after success'
Check ([IO.File]::ReadAllText((Join-Path $positive.source 'missing.config')) -ceq 'quarantined config to restore') 'real missing config moved back'
Check ((Get-FileSha256 $positive.liveLog) -ceq $positive.liveHash) 'live append log retained byte-for-byte'
$history = Join-Path $positive.stage 'recovery-log-history'
$archives = @(Get-ChildItem -LiteralPath $history -Directory -Force)
Check ($archives.Count -eq 1) 'one new archive directory'
$archive = $archives[0].FullName
$archiveLog = Join-Path $archive 'Zapret.wrapper.log'
$manifestPath = Join-Path $archive 'manifest.json'
Check ((Get-FileSha256 $archiveLog) -ceq $positive.oldHash) 'archived old log bytes exact'
$manifest = [IO.File]::ReadAllText($manifestPath, $utf8) | ConvertFrom-Json
Check ($manifest.schemaVersion -eq 1 -and $manifest.owner -ceq 'EgoistShield' -and $manifest.purpose -ceq 'owned-wrapper-log-recovery') 'actual receipt identity'
Check ($manifest.stageId -ceq (Split-Path -Leaf $positive.stage) -and $manifest.stateSha256 -ceq $activeStateHash) 'actual receipt stage and state generation'
Check (@($manifest.files).Count -eq 1) 'receipt only archives known log'
$entry = $manifest.files[0]
Check ($entry.component -ceq 'Zapret' -and $entry.oldPath -ceq $positive.oldLog -and $entry.livePath -ceq $positive.liveLog -and $entry.archivePath -ceq $archiveLog) 'actual receipt exact paths'
Check ($entry.oldSha256 -ceq $positive.oldHash -and $entry.liveSha256 -ceq $positive.liveHash) 'actual receipt both hashes'
Check ($entry.oldBytes -eq ([IO.FileInfo]$archiveLog).Length -and $entry.liveBytes -eq ([IO.FileInfo]$positive.liveLog).Length) 'actual receipt both byte counts'
foreach ($pair in @(@($archiveLog,$oldIdentity),@($positive.liveLog,$liveIdentity))) {
    $lease = Open-OwnedRuntimeLogRecoveryFile -Path $pair[0]
    try {
        Check ($lease.fileInfo.Links -eq 1 -and $lease.fileInfo.VolumeSerial -eq $pair[1].VolumeSerial -and $lease.fileInfo.IndexHigh -eq $pair[1].IndexHigh -and $lease.fileInfo.IndexLow -eq $pair[1].IndexLow) 'real file identity retained through move or live preservation'
    } finally { Close-OwnedRuntimeLogRecoveryFile $lease }
}
$rows = @(Get-Content -LiteralPath $upgradeJournalPath | ForEach-Object { $_ | ConvertFrom-Json })
Check ($rows.Count -eq 2 -and $rows[0].stage -ceq 'owned-wrapper-logs-preserved' -and $rows[1].stage -ceq 'optional-runtime-restored') 'actual archive and Restore journal rows appended'
$script:results.Add([pscustomobject]@{case='known authenticated append log';restored=$true;archivedOldOnly=$true;liveIdentityPreserved=$true;receiptVerified=$true})

# A valid known-log plan in the FIRST record must remain untouched when a
# configuration collision appears in the SECOND record's inventory.
$config = New-FixtureCase 'config'
$second = New-FixtureCase 'config' 'Vpn' 'logs\egoistshield-vpn-service.wrapper.log'
Write-FixtureFile (Join-Path $second.source 'different.config') 'live config generation'
Write-FixtureFile (Join-Path $second.destination 'different.config') 'old config generation'
Activate-FixtureCase $config @($config.record,$second.record)
$readsBefore = $runtimeAclReads
$failure = Invoke-Refusal $config 'configuration collision in second record'
Check ($failure.Exception.Message.Contains('Different runtime files require recovery')) 'configuration retains strict collision guard'
Check ($runtimeAclReads -gt $readsBefore) 'first known log was actually leased before later inventory refusal'
Check-Preserved $second
Check ([IO.File]::ReadAllText((Join-Path $second.source 'different.config')) -ceq 'live config generation') 'live colliding config preserved'
Check ([IO.File]::ReadAllText((Join-Path $second.destination 'different.config')) -ceq 'old config generation') 'old colliding config preserved'

$writerCase = New-FixtureCase 'writer'
Activate-FixtureCase $writerCase
$writer = [IO.File]::Open($writerCase.liveLog,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
try {
    $failure = $null
    try { $lease = Open-OwnedRuntimeLogRecoveryFile -Path $writerCase.liveLog; Close-OwnedRuntimeLogRecoveryFile $lease } catch { $failure = $_ }
    Check ([bool]$failure) 'actual native no-write-share open rejects active writer'
    $inner = $failure.Exception
    while ($inner.InnerException) { $inner = $inner.InnerException }
    Check (($inner.HResult -band 0xffff) -eq 32) 'native writer refusal is ERROR_SHARING_VIOLATION'
    $restoreFailure = $null
    try { Restore-OwnedRuntimeQuarantine } catch { $restoreFailure = $_ }
    Check ([bool]$restoreFailure) 'actual Restore rejects active writer before archive'
} finally { $writer.Dispose() }
Check-Preserved $writerCase
Check ([IO.File]::Exists($runtimeQuarantineManifestPath)) 'writer refusal retains quarantine manifest'
$script:results.Add([pscustomobject]@{case='active writer';refused=$true;nativeError=32;archiveCreated=$false;copiesPreserved=$true})

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LagomWrapperLogFixtureLinks {
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  public static extern bool CreateHardLinkW(string newName,string existingName,IntPtr security);
}
'@ -ReferencedAssemblies @([object].Assembly.Location,[System.Uri].Assembly.Location,[System.Linq.Enumerable].Assembly.Location) -ErrorAction Stop
$linked = New-FixtureCase 'links'
Activate-FixtureCase $linked
$alias = Join-Path $linked.root 'old-log-link'
Check ([LagomWrapperLogFixtureLinks]::CreateHardLinkW($alias,$linked.oldLog,[IntPtr]::Zero)) 'actual own hardlink created'
$failure = Invoke-Refusal $linked 'hardlinked old log'
Check ($failure.Exception.ToString().Contains('more than one link')) 'actual native single-link guard rejects hardlink'
Check ((Get-FileSha256 $alias) -ceq $linked.oldHash) 'hardlink alias bytes preserved'

$reparse = New-FixtureCase 'reparse'
Activate-FixtureCase $reparse
$oldLogs = Join-Path $reparse.destination 'logs'
$target = Join-Path $reparse.root 'junction-target'
[IO.Directory]::Move($oldLogs,$target)
[void](New-Item -ItemType Junction -Path $oldLogs -Value $target -ErrorAction Stop)
Check ([bool]((Get-Item -LiteralPath $oldLogs -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) 'actual own junction exists'
$failure = Invoke-Refusal $reparse 'reparse parent'
Check ($failure.Exception.Message.Contains('reparse point')) 'actual tree guard refuses junction'

$foreign = New-FixtureCase 'foreign' 'Other'
Activate-FixtureCase $foreign
$failure = Invoke-Refusal $foreign 'foreign component'
Check ($failure.Exception.Message.Contains('Different runtime files require recovery')) 'foreign component retains strict collision guard'
$unknown = New-FixtureCase 'unknown' 'Zapret' 'logs\unknown.log'
Activate-FixtureCase $unknown
$failure = Invoke-Refusal $unknown 'unknown log name'
Check ($failure.Exception.Message.Contains('Different runtime files require recovery')) 'unknown log retains strict collision guard'

# A writable handle would make even a short no-write-sharing hash read fail.
# These exact SCM refusals must occur first, before either log is leased/read.
foreach ($scmVariant in @('running','missing','foreign-path')) {
    $leaf = @{running='scmrun';missing='scmmiss';'foreign-path'='scmfore'}[$scmVariant]
    $case = New-FixtureCase $leaf
    Activate-FixtureCase $case
    $script:scmMode = $scmVariant
    $aclReadsBefore = $runtimeAclReads
    $failure = Invoke-Refusal $case ('SCM ' + $scmVariant) -WritableLiveLog
    Check ($failure.Exception.Message.Contains('stopped canonical owned LocalSystem service')) ($scmVariant + ' refuses at actual SCM gate before log hashing')
    Check ($runtimeAclReads -eq $aclReadsBefore) ($scmVariant + ' opens no runtime file leases')
}

Check ($runtimeAclReads -gt 0 -and $protectedAclReads -gt 0) 'actual held runtime and metadata ACL reads reached controlled authority'
Check ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $sourceHash) 'source unchanged throughout fixture'
Check ((Get-FileHash -LiteralPath $bootPath -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $bootHash) 'boot helper unchanged throughout fixture'
[pscustomobject]@{
    mode='current';result='GREEN';nativeVersion=[string]$PSVersionTable.PSVersion
    sourceSha256=$sourceHash;bootSourceSha256=$bootHash;positives=1;negatives=9;checks=$script:checks
    runtimeHeldAclReads=$runtimeAclReads;protectedHeldAclReads=$protectedAclReads
    controlledScmQueries=$scmQueries
    results=@($script:results.ToArray());operationalCalls=0
    controlledBoundaries=@('protected transaction authentication','Get-CimInstance exact fixed-name SCM rows','runtime/private ACL authorization for fixture user','history ACL constructor owner and additional fixture-user ACE')
    actualOperations=@('source AST Restore and unchanged strict Merge','source stopped canonical LocalSystem SCM predicate','native nofollow file handles and recursive tree pins','native held ACL reads','single-link metadata','SHA-256 and file identity','same-volume File.Move','create-only receipt and real journal')
} | ConvertTo-Json -Depth 6
