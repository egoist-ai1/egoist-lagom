# Imported by the protected installer worker; importing performs no OS actions.

function Get-InstallerBootRecoveryCommonDataRoot {
  return [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
}

function ConvertTo-InstallerBootRecoveryArgument {
  param([AllowEmptyString()][string]$Value)
  $quoted = [Text.StringBuilder]::new()
  [void]$quoted.Append('"')
  $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') { $slashes++; continue }
    if ($character -eq '"') { [void]$quoted.Append(('\' * (2 * $slashes + 1))) }
    else { [void]$quoted.Append(('\' * $slashes)) }
    [void]$quoted.Append($character)
    $slashes = 0
  }
  [void]$quoted.Append(('\' * (2 * $slashes)))
  [void]$quoted.Append('"')
  return $quoted.ToString()
}

function Get-InstallerBootRecoveryContext {
  param([Parameter(Mandatory=$true)][string]$StageDirectory,[switch]$AllowLegacyInventory)
  $common = [IO.Path]::GetFullPath((Get-InstallerBootRecoveryCommonDataRoot)).TrimEnd('\')
  $installer = Join-Path $common 'EgoistShieldInstaller'
  $deferred = Join-Path $installer 'DeferredRuns'
  $stage = [IO.Path]::GetFullPath($StageDirectory).TrimEnd('\')
  $id = [IO.Path]::GetFileName($stage)
  if ($id -cnotmatch '^[a-f0-9]{32}$' -or
      -not [IO.Path]::GetDirectoryName($stage).Equals($deferred, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Boot recovery requires a direct canonical protected DeferredRuns stage.'
  }
  $worker = Join-Path $stage 'invoke-final-silent-reinstall.ps1'
  $powerShell = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)) 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $argv = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$worker,'-Recover','-StageDirectory',$stage)
  $context=[pscustomobject]@{
    commonRoot=$common; installerRoot=$installer; deferredRoot=$deferred; stage=$stage; stageId=$id
    taskName=('EgoistShield-InstallerBootRecovery-' + $id); taskPath=('\EgoistShield-InstallerBootRecovery-' + $id)
    powerShell=$powerShell; arguments=(($argv | ForEach-Object { ConvertTo-InstallerBootRecoveryArgument $_ }) -join ' ')
    worker=$worker; inventoryPath=(Join-Path $stage 'boot-recovery.json'); statePath=(Join-Path $stage 'state.json')
    immutableNames=@('invoke-final-silent-reinstall.ps1','service-maintenance.ps1','maintenance-boot-recovery.ps1','gui-login-startup.ps1')
    maintenanceMarker=(Join-Path $common 'EgoistShield\installer\service-maintenance.json')
    securityDescriptor='O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)'
  }
  # Existing authenticated three-file stages keep their original capability.
  # New registration never takes this route, even after a failed registration.
  if($AllowLegacyInventory -and (Test-Path -LiteralPath $context.inventoryPath -PathType Leaf) -and -not (Test-Path -LiteralPath (Join-Path $stage 'gui-login-startup.ps1'))) {
    foreach($directory in @($installer,$deferred,$stage)){Assert-InstallerBootRecoveryPlainPath $directory;Assert-InstallerBootRecoveryFileProtection -Path $directory -Directory}
    Assert-InstallerBootRecoveryPlainPath -Path $context.inventoryPath -Leaf
    Assert-InstallerBootRecoveryFileProtection -Path $context.inventoryPath
    if((Get-Item -LiteralPath $context.inventoryPath -ErrorAction Stop).Length -gt 32768){throw 'Legacy boot inventory exceeds its limit.'}
    $record=[IO.File]::ReadAllText($context.inventoryPath,[Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
    $legacy=@('invoke-final-silent-reinstall.ps1','service-maintenance.ps1','maintenance-boot-recovery.ps1')
    if(@($record.files).Count -eq 3 -and @($record.files | Where-Object {[string]$_.name -notin $legacy}).Count -eq 0) {
      $module=Join-Path $stage 'maintenance-boot-recovery.ps1'
      Assert-InstallerBootRecoveryPlainPath -Path $module -Leaf;Assert-InstallerBootRecoveryFileProtection -Path $module
      if((Get-Item -LiteralPath $module -ErrorAction Stop).Length -gt 262144){throw 'Legacy boot module exceeds its limit.'}
      $source=[IO.File]::ReadAllText($module,[Text.Encoding]::UTF8)
      $legacyContract="immutableNames=@('invoke-final-silent-reinstall.ps1','service-maintenance.ps1','maintenance-boot-recovery.ps1')"
      if($source.Contains($legacyContract) -and -not $source.Contains('gui-login-startup.ps1')){$context.immutableNames=$legacy}
    }
  }
  return $context
}

function Assert-InstallerBootRecoveryPlainPath {
  param([Parameter(Mandatory=$true)][string]$Path, [switch]$Leaf)
  $current = [IO.Path]::GetFullPath($Path)
  $first = $true
  while ($current) {
    $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Boot recovery path contains a reparse point.' }
    if ($first -and $Leaf -and $item.PSIsContainer) { throw 'Boot recovery requires a regular file.' }
    if ($first -and -not $Leaf -and -not $item.PSIsContainer) { throw 'Boot recovery requires a directory.' }
    $first = $false
    $parent = [IO.Path]::GetDirectoryName($current.TrimEnd('\'))
    if (-not $parent -or $parent -eq $current) { break }
    $current = $parent
  }
}

function Assert-InstallerBootRecoveryFileProtection {
  param([Parameter(Mandatory=$true)][string]$Path, [switch]$Directory)
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $trusted = @('S-1-5-18','S-1-5-32-544')
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'Boot recovery file owner is not SYSTEM or Administrators.' }
  if ($Directory -and -not $acl.AreAccessRulesProtected) { throw 'Boot recovery directory DACL is not protected.' }
  $write = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor
    [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [Security.AccessControl.FileSystemRights]::TakeOwnership
  $full = @{}
  foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    $sid = $rule.IdentityReference.Value
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny) { throw 'Boot recovery file has an unsupported deny ACE.' }
    if ($sid -notin $trusted -and ($rule.FileSystemRights -band $write) -ne 0) { throw 'Boot recovery file permits untrusted writes or deletion.' }
    if ($sid -in $trusted -and ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
        ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl) {
      $full[$sid] = $true
    }
  }
  if (-not $full.ContainsKey('S-1-5-18') -or -not $full.ContainsKey('S-1-5-32-544')) { throw 'Boot recovery file lacks SYSTEM/Administrators full control.' }
}

function Assert-InstallerBootRecoveryStage {
  param([Parameter(Mandatory=$true)][object]$Context)
  foreach ($directory in @($Context.installerRoot,$Context.deferredRoot,$Context.stage)) {
    Assert-InstallerBootRecoveryPlainPath -Path $directory
    Assert-InstallerBootRecoveryFileProtection -Path $directory -Directory
  }
  foreach ($name in @($Context.immutableNames) + @('state.json')) {
    $file = Join-Path $Context.stage $name
    Assert-InstallerBootRecoveryPlainPath -Path $file -Leaf
    Assert-InstallerBootRecoveryFileProtection -Path $file
  }
  Assert-InstallerBootRecoveryPlainPath -Path $Context.powerShell -Leaf
  $item = Get-Item -LiteralPath $Context.statePath -Force -ErrorAction Stop
  if ($item.Length -gt 4194304) { throw 'Boot recovery state exceeds its limit.' }
  $state = [IO.File]::ReadAllText($Context.statePath,[Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
  if ($state.schemaVersion -ne 1 -or $state.owner -ne 'EgoistShield') { throw 'Boot recovery state identity is invalid.' }
}

function Get-InstallerBootRecoveryFileHash {
  param([Parameter(Mandatory=$true)][string]$Path)
  $stream = [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
  } finally { $stream.Dispose() }
}

function New-InstallerBootRecoveryInventoryStream {
  param([Parameter(Mandatory=$true)][string]$Path)
  $security = [Security.AccessControl.FileSecurity]::new()
  $security.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
  $security.SetAccessRuleProtection($true,$false)
  foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
    $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))
  }
  return [IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,$security)
}

function Get-InstallerBootRecoveryInventory {
  param([Parameter(Mandatory=$true)][object]$Context, [switch]$Create)
  if (-not (Test-Path -LiteralPath $Context.inventoryPath -PathType Leaf)) {
    if (-not $Create) { throw 'Boot recovery inventory is missing.' }
    $files = @($Context.immutableNames | ForEach-Object { [ordered]@{name=$_;sha256=(Get-InstallerBootRecoveryFileHash (Join-Path $Context.stage $_))} })
    $record = [ordered]@{schemaVersion=1;owner='EgoistShield';purpose='installer-boot-recovery';stage=$Context.stage;taskName=$Context.taskName;registrationId=[Guid]::NewGuid().ToString('N');statePath=$Context.statePath;files=$files}
    $temporary = Join-Path $Context.stage ('boot-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $stream = $null
    try {
      $stream = New-InstallerBootRecoveryInventoryStream -Path $temporary
      $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($record | ConvertTo-Json -Depth 6))
      $stream.Write($bytes,0,$bytes.Length)
      $stream.Flush($true)
      $stream.Dispose(); $stream=$null
      [IO.File]::Move($temporary,$Context.inventoryPath)
    } finally {
      if ($stream) { $stream.Dispose() }
      if (Test-Path -LiteralPath $temporary -PathType Leaf) { [IO.File]::Delete($temporary) }
    }
  }
  Assert-InstallerBootRecoveryPlainPath -Path $Context.inventoryPath -Leaf
  Assert-InstallerBootRecoveryFileProtection -Path $Context.inventoryPath
  if ((Get-Item -LiteralPath $Context.inventoryPath -Force -ErrorAction Stop).Length -gt 32768) { throw 'Boot recovery inventory exceeds its limit.' }
  $record = [IO.File]::ReadAllText($Context.inventoryPath,[Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
  if ($record.schemaVersion -ne 1 -or $record.owner -ne 'EgoistShield' -or $record.purpose -ne 'installer-boot-recovery' -or
      [string]$record.stage -ne $Context.stage -or [string]$record.taskName -ne $Context.taskName -or [string]$record.statePath -ne $Context.statePath -or
      [string]$record.registrationId -cnotmatch '^[a-f0-9]{32}$' -or @($record.files).Count -ne $Context.immutableNames.Count) { throw 'Boot recovery inventory identity is invalid.' }
  foreach ($name in $Context.immutableNames) {
    $entries = @($record.files | Where-Object { [string]$_.name -ceq $name })
    if ($entries.Count -ne 1 -or [string]$entries[0].sha256 -cnotmatch '^[a-f0-9]{64}$' -or
        [string]$entries[0].sha256 -cne (Get-InstallerBootRecoveryFileHash (Join-Path $Context.stage $name))) { throw 'Boot recovery immutable script inventory does not match.' }
  }
  return $record
}

function Add-InstallerBootRecoveryXmlElement {
  param([Xml.XmlDocument]$Document,[Xml.XmlNode]$Parent,[string]$Name,[AllowEmptyString()][string]$Value)
  $node = $Document.CreateElement($Name,'http://schemas.microsoft.com/windows/2004/02/mit/task')
  if ($null -ne $Value) { $node.InnerText = $Value }
  [void]$Parent.AppendChild($node)
  return $node
}

function New-InstallerBootRecoveryTaskXml {
  param([Parameter(Mandatory=$true)][object]$Context,[Parameter(Mandatory=$true)][object]$Inventory)
  $document = [Xml.XmlDocument]::new()
  $task = $document.CreateElement('Task','http://schemas.microsoft.com/windows/2004/02/mit/task')
  $task.SetAttribute('version','1.2')
  [void]$document.AppendChild($task)
  $registration = Add-InstallerBootRecoveryXmlElement $document $task 'RegistrationInfo' $null
  [void](Add-InstallerBootRecoveryXmlElement $document $registration 'Author' 'EgoistShield')
  [void](Add-InstallerBootRecoveryXmlElement $document $registration 'URI' ('egoistshield:installer-boot-recovery:v1:' + $Context.stageId + ':' + $Inventory.registrationId))
  [void](Add-InstallerBootRecoveryXmlElement $document $registration 'Description' ('Protected installer recovery; inventory-sha256=' + (Get-InstallerBootRecoveryFileHash $Context.inventoryPath)))
  $triggers = Add-InstallerBootRecoveryXmlElement $document $task 'Triggers' $null
  $boot = Add-InstallerBootRecoveryXmlElement $document $triggers 'BootTrigger' $null
  [void](Add-InstallerBootRecoveryXmlElement $document $boot 'Enabled' 'true')
  [void](Add-InstallerBootRecoveryXmlElement $document $boot 'Delay' 'PT30S')
  $principals = Add-InstallerBootRecoveryXmlElement $document $task 'Principals' $null
  $principal = Add-InstallerBootRecoveryXmlElement $document $principals 'Principal' $null
  $principal.SetAttribute('id','Recovery')
  [void](Add-InstallerBootRecoveryXmlElement $document $principal 'UserId' 'S-1-5-18')
  [void](Add-InstallerBootRecoveryXmlElement $document $principal 'RunLevel' 'HighestAvailable')
  $settings = Add-InstallerBootRecoveryXmlElement $document $task 'Settings' $null
  foreach ($entry in ([ordered]@{MultipleInstancesPolicy='IgnoreNew';DisallowStartIfOnBatteries='false';StopIfGoingOnBatteries='false';AllowHardTerminate='true';StartWhenAvailable='true';RunOnlyIfNetworkAvailable='false';AllowStartOnDemand='true';Enabled='true';Hidden='true';RunOnlyIfIdle='false';WakeToRun='false';ExecutionTimeLimit='PT20M';Priority='7'}).GetEnumerator()) {
    [void](Add-InstallerBootRecoveryXmlElement $document $settings $entry.Key $entry.Value)
  }
  $restart = Add-InstallerBootRecoveryXmlElement $document $settings 'RestartOnFailure' $null
  [void](Add-InstallerBootRecoveryXmlElement $document $restart 'Interval' 'PT2M')
  [void](Add-InstallerBootRecoveryXmlElement $document $restart 'Count' '3')
  $actions = Add-InstallerBootRecoveryXmlElement $document $task 'Actions' $null
  $actions.SetAttribute('Context','Recovery')
  $exec = Add-InstallerBootRecoveryXmlElement $document $actions 'Exec' $null
  [void](Add-InstallerBootRecoveryXmlElement $document $exec 'Command' $Context.powerShell)
  [void](Add-InstallerBootRecoveryXmlElement $document $exec 'Arguments' $Context.arguments)
  [void](Add-InstallerBootRecoveryXmlElement $document $exec 'WorkingDirectory' $Context.stage)
  return $document.OuterXml
}

function Assert-InstallerBootRecoveryTaskProtection {
  param([Parameter(Mandatory=$true)][string]$SecurityDescriptor)
  $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($SecurityDescriptor)
  $trusted = @('S-1-5-18','S-1-5-32-544')
  if ($descriptor.Owner.Value -notin $trusted -or -not $descriptor.DiscretionaryAcl -or
      ($descriptor.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -eq 0) { throw 'Boot recovery task security descriptor is unprotected.' }
  $full = @{}
  foreach ($ace in $descriptor.DiscretionaryAcl) {
    if ($ace -isnot [Security.AccessControl.CommonAce] -or $ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed -or
        $ace.SecurityIdentifier.Value -notin $trusted) { throw 'Boot recovery task permits a foreign principal.' }
    if (([int]$ace.AceFlags -band [int][Security.AccessControl.AceFlags]::InheritOnly) -eq 0 -and
        (($ace.AccessMask -band 0x1f01ff) -eq 0x1f01ff -or ($ace.AccessMask -band 0x10000000) -ne 0)) { $full[$ace.SecurityIdentifier.Value] = $true }
  }
  if (-not $full.ContainsKey('S-1-5-18') -or -not $full.ContainsKey('S-1-5-32-544')) { throw 'Boot recovery task lacks SYSTEM/Administrators control.' }
}

function ConvertFrom-InstallerBootRecoveryXml {
  param([Parameter(Mandatory=$true)][string]$Text)
  $settings = [Xml.XmlReaderSettings]::new()
  $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $settings.MaxCharactersInDocument = 131072
  $reader = [Xml.XmlReader]::Create([IO.StringReader]::new($Text),$settings)
  try { $document = [Xml.XmlDocument]::new(); $document.XmlResolver=$null; $document.Load($reader); return ,$document }
  finally { $reader.Dispose() }
}

function Get-InstallerBootRecoveryPrincipalSid {
  param([Parameter(Mandatory=$true)][string]$Identity)
  try {
    if ($Identity -match '^S-[0-9]+-[0-9]+(?:-[0-9]+)+$') { return [Security.Principal.SecurityIdentifier]::new($Identity).Value }
    return [Security.Principal.NTAccount]::new($Identity).Translate([Security.Principal.SecurityIdentifier]).Value
  } catch { throw 'Boot recovery principal cannot be resolved to a Windows SID.' }
}

function Get-InstallerBootRecoveryXmlValue {
  param([Xml.XmlDocument]$Document,[Xml.XmlNamespaceManager]$Namespace,[string]$XPath,[AllowNull()][string]$DefaultValue=$null)
  $nodes=$Document.SelectNodes($XPath,$Namespace)
  if ($nodes.Count -gt 1) { throw 'Boot recovery XML contains duplicate identity or settings fields.' }
  if ($nodes.Count -eq 1) { return $nodes[0].InnerText }
  return $DefaultValue
}

function Assert-InstallerBootRecoveryTaskIdentity {
  param([Parameter(Mandatory=$true)][object]$Context,[Parameter(Mandatory=$true)][object]$Inventory,[Parameter(Mandatory=$true)][object]$Task)
  if ([string]$Task.Name -ne $Context.taskName -or [string]$Task.Path -ne $Context.taskPath -or -not $Task.Enabled -or
      [int]$Task.PrincipalLogonType -ne 5 -or (Get-InstallerBootRecoveryPrincipalSid ([string]$Task.PrincipalUserId)) -cne 'S-1-5-18') { throw 'Boot recovery task principal or name is foreign.' }
  Assert-InstallerBootRecoveryTaskProtection -SecurityDescriptor ([string]$Task.SecurityDescriptor)
  $actual = ConvertFrom-InstallerBootRecoveryXml ([string]$Task.Xml)
  $expected = ConvertFrom-InstallerBootRecoveryXml (New-InstallerBootRecoveryTaskXml $Context $Inventory)
  $ns = [Xml.XmlNamespaceManager]::new($actual.NameTable)
  $ns.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
  $expectedNs = [Xml.XmlNamespaceManager]::new($expected.NameTable)
  $expectedNs.AddNamespace('t','http://schemas.microsoft.com/windows/2004/02/mit/task')
  foreach ($xpath in @('/t:Task/t:Principals/t:Principal','/t:Task/t:Triggers/t:BootTrigger','/t:Task/t:Actions/t:Exec')) {
    if ($actual.SelectNodes($xpath,$ns).Count -ne 1 -or $actual.SelectSingleNode($xpath,$ns).ParentNode.ChildNodes.Count -ne 1) { throw 'Boot recovery task has extra principals, triggers or actions.' }
  }
  foreach ($xpath in @('/t:Task/t:Principals/t:Principal/@id','/t:Task/t:Actions/@Context','/t:Task/t:RegistrationInfo/t:Author','/t:Task/t:RegistrationInfo/t:Description','/t:Task/t:Principals/t:Principal/t:RunLevel','/t:Task/t:Actions/t:Exec/t:Arguments','/t:Task/t:Actions/t:Exec/t:Command','/t:Task/t:Actions/t:Exec/t:WorkingDirectory')) {
    $left=$actual.SelectSingleNode($xpath,$ns); $right=$expected.SelectSingleNode($xpath,$expectedNs)
    if (-not $left -or -not $right -or $left.InnerText -cne $right.InnerText) { throw 'Boot recovery task identity/action differs from its protected inventory.' }
  }
  $uri=Get-InstallerBootRecoveryXmlValue $actual $ns '/t:Task/t:RegistrationInfo/t:URI'
  if ($uri -cne $Context.taskPath -and $uri -cne $expected.SelectSingleNode('/t:Task/t:RegistrationInfo/t:URI',$expectedNs).InnerText) { throw 'Boot recovery task URI differs from its protected identity.' }
  if ((Get-InstallerBootRecoveryPrincipalSid (Get-InstallerBootRecoveryXmlValue $actual $ns '/t:Task/t:Principals/t:Principal/t:UserId')) -cne 'S-1-5-18') { throw 'Boot recovery XML principal is not SYSTEM.' }
  if ((Get-InstallerBootRecoveryXmlValue $actual $ns '/t:Task/t:Triggers/t:BootTrigger/t:Enabled' 'true') -cne 'true') { throw 'Boot recovery trigger is disabled.' }
  foreach ($element in $actual.SelectSingleNode('/t:Task/t:Triggers/t:BootTrigger',$ns).ChildNodes) {
    if ($element.LocalName -notin @('Enabled','Delay')) { throw 'Boot recovery trigger has unexpected boundaries or repetition.' }
  }
  # Registered XML omits defaults from the Task Scheduler schema:
  # https://learn.microsoft.com/windows/win32/taskschd/task-scheduler-schema
  $defaults=@{MultipleInstancesPolicy='IgnoreNew';DisallowStartIfOnBatteries='true';StopIfGoingOnBatteries='true';AllowHardTerminate='true';StartWhenAvailable='false';RunOnlyIfNetworkAvailable='false';AllowStartOnDemand='true';Enabled='true';Hidden='false';RunOnlyIfIdle='false';WakeToRun='false';Priority='7'}
  foreach ($element in $expected.SelectSingleNode('/t:Task/t:Settings',$expectedNs).ChildNodes) {
    if ($element.LocalName -in @('RestartOnFailure','ExecutionTimeLimit')) { continue }
    $xpath='/t:Task/t:Settings/t:'+$element.LocalName
    $value=Get-InstallerBootRecoveryXmlValue $actual $ns $xpath $defaults[$element.LocalName]
    if ($value -cne $element.InnerText) { throw 'Boot recovery task execution settings differ.' }
  }
  foreach ($duration in @(@('/t:Task/t:Triggers/t:BootTrigger/t:Delay',30),@('/t:Task/t:Settings/t:ExecutionTimeLimit',1200),@('/t:Task/t:Settings/t:RestartOnFailure/t:Interval',120))) {
    $node=$actual.SelectSingleNode($duration[0],$ns)
    if (-not $node -or [Xml.XmlConvert]::ToTimeSpan($node.InnerText).TotalSeconds -ne $duration[1]) { throw 'Boot recovery task time bounds differ.' }
  }
  if ($actual.SelectSingleNode('/t:Task/t:Settings/t:RestartOnFailure/t:Count',$ns).InnerText -ne '3') { throw 'Boot recovery task restart count differs.' }
  $volatile=$actual.SelectSingleNode('/t:Task/t:Settings/t:Volatile',$ns)
  if ($volatile -and $volatile.InnerText -ne 'false') { throw 'Boot recovery task is not durable.' }
}

function Invoke-InstallerBootRecoveryScheduler {
  param([ValidateSet('Read','Create','Remove')][string]$Operation,[Parameter(Mandatory=$true)][string]$TaskName,[string]$Xml,[string]$SecurityDescriptor,[string]$ExpectedXml,[string]$ExpectedSecurityDescriptor)
  $service=$null; $folder=$null; $task=$null; $definition=$null; $principal=$null
  try {
    $service=New-Object -ComObject 'Schedule.Service'
    $service.Connect()
    $folder=$service.GetFolder('\')
    if ($Operation -eq 'Create') { [void]$folder.RegisterTask($TaskName,$Xml,18,'SYSTEM',$null,5,$SecurityDescriptor); return }
    try { $task=$folder.GetTask($TaskName) }
    catch {
      $errorObject=$_.Exception
      while ($errorObject.InnerException) { $errorObject=$errorObject.InnerException }
      if ($errorObject.HResult -eq -2147024894) { return $null }
      throw
    }
    if ($Operation -eq 'Remove') {
      if ([string]$task.Xml -cne $ExpectedXml -or [string]$task.GetSecurityDescriptor(7) -cne $ExpectedSecurityDescriptor) { throw 'Boot recovery task changed before retirement.' }
      $folder.DeleteTask($TaskName,0); return
    }
    $definition=$task.Definition; $principal=$definition.Principal
    return [pscustomobject]@{Name=[string]$task.Name;Path=[string]$task.Path;Enabled=[bool]$task.Enabled;Xml=[string]$task.Xml;SecurityDescriptor=[string]$task.GetSecurityDescriptor(7);PrincipalUserId=[string]$principal.UserId;PrincipalLogonType=[int]$principal.LogonType}
  } finally {
    foreach ($instance in @($principal,$definition,$task,$folder,$service)) { if ($null -ne $instance -and [Runtime.InteropServices.Marshal]::IsComObject($instance)) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($instance) } }
  }
}

function Register-InstallerMaintenanceBootRecovery {
  param([Parameter(Mandatory=$true)][string]$StageDirectory)
  $context=Get-InstallerBootRecoveryContext $StageDirectory
  Assert-InstallerBootRecoveryStage $context
  $existing=Invoke-InstallerBootRecoveryScheduler -Operation Read -TaskName $context.taskName
  if ($existing -and -not (Test-Path -LiteralPath $context.inventoryPath -PathType Leaf)) { throw 'Boot recovery task collision has no protected ownership inventory.' }
  $inventory=Get-InstallerBootRecoveryInventory $context -Create
  if ($existing) { Assert-InstallerBootRecoveryTaskIdentity $context $inventory $existing }
  else {
    Invoke-InstallerBootRecoveryScheduler -Operation Create -TaskName $context.taskName -Xml (New-InstallerBootRecoveryTaskXml $context $inventory) -SecurityDescriptor $context.securityDescriptor
  }
  return Assert-InstallerMaintenanceBootRecovery -StageDirectory $context.stage
}

function Assert-InstallerMaintenanceBootRecovery {
  param([Parameter(Mandatory=$true)][string]$StageDirectory)
  $context=Get-InstallerBootRecoveryContext $StageDirectory -AllowLegacyInventory
  Assert-InstallerBootRecoveryStage $context
  $inventory=Get-InstallerBootRecoveryInventory $context
  $task=Invoke-InstallerBootRecoveryScheduler -Operation Read -TaskName $context.taskName
  if (-not $task) { throw 'Required boot recovery task is missing.' }
  Assert-InstallerBootRecoveryTaskIdentity $context $inventory $task
  return [pscustomobject]@{owner='EgoistShield';schemaVersion=1;stage=$context.stage;taskName=$context.taskName;registrationId=$inventory.registrationId;inventorySha256=(Get-InstallerBootRecoveryFileHash $context.inventoryPath);verified=$true}
}

function Unregister-InstallerMaintenanceBootRecovery {
  param([Parameter(Mandatory=$true)][string]$StageDirectory,[bool]$RestorationVerified=$false)
  if (-not $RestorationVerified) { throw 'Boot recovery retirement requires verified service restoration.' }
  $context=Get-InstallerBootRecoveryContext $StageDirectory -AllowLegacyInventory
  $task=Invoke-InstallerBootRecoveryScheduler -Operation Read -TaskName $context.taskName
  if (-not $task) { return [pscustomobject]@{taskName=$context.taskName;removed=$false;absent=$true} }
  Assert-InstallerBootRecoveryStage $context
  $inventory=Get-InstallerBootRecoveryInventory $context
  Assert-InstallerBootRecoveryTaskIdentity $context $inventory $task
  if (Test-Path -LiteralPath $context.maintenanceMarker -PathType Leaf) {
    Assert-InstallerBootRecoveryPlainPath -Path $context.maintenanceMarker -Leaf
    if ((Get-Item -LiteralPath $context.maintenanceMarker -Force -ErrorAction Stop).Length -gt 16384) { throw 'Maintenance marker exceeds its limit.' }
    $marker=[IO.File]::ReadAllText($context.maintenanceMarker,[Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
    if ($marker.schemaVersion -ne 1 -or $marker.owner -ne 'EgoistShield') { throw 'Maintenance marker ownership is unknown.' }
    if ([string]$marker.stage -eq $context.stage) { throw 'Own maintenance marker still requires recovery.' }
  }
  # The caller holds the product recovery mutex. Re-read immediately before
  # retirement; Task Scheduler exposes no compare-and-delete operation.
  $latest=Invoke-InstallerBootRecoveryScheduler -Operation Read -TaskName $context.taskName
  if (-not $latest) { return [pscustomobject]@{taskName=$context.taskName;removed=$false;absent=$true} }
  Assert-InstallerBootRecoveryTaskIdentity $context $inventory $latest
  Invoke-InstallerBootRecoveryScheduler -Operation Remove -TaskName $context.taskName -ExpectedXml ([string]$latest.Xml) -ExpectedSecurityDescriptor ([string]$latest.SecurityDescriptor)
  if (Invoke-InstallerBootRecoveryScheduler -Operation Read -TaskName $context.taskName) { throw 'Boot recovery task retirement readback failed.' }
  return [pscustomobject]@{taskName=$context.taskName;removed=$true;absent=$false}
}
