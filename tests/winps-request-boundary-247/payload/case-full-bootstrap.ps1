$ErrorActionPreference='Stop';[Console]::Error.WriteLine('EGOIST_TRUST_PHASE:command-start');try {$taskRequest=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__REQUEST64__')) | ConvertFrom-Json;[Console]::Error.WriteLine('EGOIST_TRUST_PHASE:request-decoded');
  [Console]::Error.WriteLine('EGOIST_TRUST_PHASE:protected-root')
  $taskRoot = [IO.Path]::GetFullPath((Join-Path $taskRequest.resourcesPath '..')).TrimEnd('\')
  $taskProgramRoots = @([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles),[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)) | Where-Object {$_}
  $taskTrustedRoot = $taskProgramRoots | Where-Object {$taskRoot.StartsWith($_.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)} | Select-Object -First 1
  if (-not $taskTrustedRoot) {throw 'Native verifier is outside the Windows Program Files root.'}
  $taskTrustedSids = @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $taskMutableRights = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  function Assert-TaskProtectedPath([string]$taskCandidate) {
    $taskCurrent = [IO.Path]::GetFullPath($taskCandidate)
    if (-not $taskCurrent.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase) -and -not $taskCurrent.Equals($taskRoot,[StringComparison]::OrdinalIgnoreCase)) {throw 'Protected verifier path escaped installation.'}
    while ($true) {
      if (([IO.File]::GetAttributes($taskCurrent) -band [IO.FileAttributes]::ReparsePoint) -ne 0) {throw 'Protected verifier path contains a reparse point.'}
      $taskSecurity = if ([IO.Directory]::Exists($taskCurrent)) {[IO.Directory]::GetAccessControl($taskCurrent)} else {[IO.File]::GetAccessControl($taskCurrent)}
      $taskOwner = $taskSecurity.GetOwner([Security.Principal.SecurityIdentifier]).Value
      if ($taskOwner -notin $taskTrustedSids) {throw 'Protected verifier path has an untrusted owner.'}
      foreach ($taskRule in $taskSecurity.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($taskRule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($taskRule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and ($taskRule.FileSystemRights -band $taskMutableRights) -ne 0 -and $taskRule.IdentityReference.Value -notin $taskTrustedSids) {throw 'A non-administrator can modify the native verifier path.'}
      }
      if ($taskCurrent.Equals($taskTrustedRoot.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)) {break}
      $taskCurrent = [IO.Path]::GetDirectoryName($taskCurrent)
      if (-not $taskCurrent) {throw 'Protected verifier parent chain is incomplete.'}
    }
  }
  $taskHeldFiles = New-Object 'System.Collections.Generic.List[IO.FileStream]'
  try {
    [Console]::Error.WriteLine('EGOIST_TRUST_PHASE:inventory-open')
    $taskInventoryPath = Join-Path $taskRoot 'resources\worker-host-integrity.json'
    Assert-TaskProtectedPath $taskInventoryPath
    $taskInventoryStream = [IO.File]::Open($taskInventoryPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $taskHeldFiles.Add($taskInventoryStream)
    if ($taskInventoryStream.Length -gt 1048576) {throw 'Native verifier inventory exceeds its limit.'}
    $taskInventoryReader = New-Object IO.StreamReader($taskInventoryStream,[Text.Encoding]::UTF8,$true,4096,$true)
    try {$taskInventory = $taskInventoryReader.ReadToEnd() | ConvertFrom-Json} finally {$taskInventoryReader.Dispose()}
    if ($taskInventory.schemaVersion -ne 1 -or $taskInventory.owner -ne 'EgoistShield') {throw 'Native verifier inventory identity is invalid.'}
    [Console]::Error.WriteLine('EGOIST_TRUST_PHASE:inventory-valid')
    $taskHelperRelative = 'resources/core-service/win-x64/EgoistShield.Service.exe'
    $taskHelper = Join-Path $taskRoot $taskHelperRelative
    $taskHelperFolder = [IO.Path]::GetDirectoryName($taskHelper)
    $taskCodeFiles = @($taskHelper) + @([IO.Directory]::GetFiles($taskHelperFolder) | Where-Object {[IO.Path]::GetExtension($_).Equals('.dll',[StringComparison]::OrdinalIgnoreCase)})
    [Console]::Error.WriteLine('EGOIST_TRUST_PHASE:code-validation')
    foreach ($taskCodeFile in $taskCodeFiles) {
      Assert-TaskProtectedPath $taskCodeFile
      $taskRelative = $taskCodeFile.Substring($taskRoot.Length+1).Replace('\','/')
      $taskPins = @($taskInventory.files | Where-Object {$_.path -ceq $taskRelative -and 'cli' -in $_.roles})
      if ($taskPins.Count -ne 1 -or $taskPins[0].sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $taskPins[0].bytes -le 0) {throw 'Native verifier code is absent or ambiguous in its inventory.'}
      $taskCodeStream = [IO.File]::Open($taskCodeFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
      $taskHeldFiles.Add($taskCodeStream)
      $taskHasher = [Security.Cryptography.SHA256]::Create()
      try {$taskHash = -join ($taskHasher.ComputeHash($taskCodeStream) | ForEach-Object {$_.ToString('x2')})} finally {$taskHasher.Dispose()}
      if ($taskCodeStream.Length -ne $taskPins[0].bytes -or $taskHash -cne $taskPins[0].sha256.ToLowerInvariant()) {throw 'Native verifier bytes differ from its authenticated inventory.'}
    }
    [Console]::Error.WriteLine('EGOIST_TRUST_PHASE:code-validated')
    [Console]::Out.WriteLine((@{ok=$true;helperPath=$taskHelper} | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    [Console]::Error.WriteLine('EGOIST_TRUST_PHASE:result-flushed')
    $null = [Console]::In.ReadLine()
  } finally {foreach ($taskFile in $taskHeldFiles) {$taskFile.Dispose()}}
} catch {[Console]::Error.WriteLine('EGOIST_TRUST_PHASE:probe-exception');[Console]::Out.WriteLine((@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress));exit 1}