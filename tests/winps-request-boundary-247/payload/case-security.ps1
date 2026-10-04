$ErrorActionPreference='Stop'
[Console]::Error.WriteLine('EGOIST_BOUNDARY_PHASE:command-start')
try {
  [Console]::Error.WriteLine('EGOIST_BOUNDARY_PHASE:before-base64')
  $taskBytes=[Convert]::FromBase64String('__REQUEST64__')
  [Console]::Error.WriteLine('EGOIST_BOUNDARY_PHASE:base64-decoded')
  $taskJson=[Text.Encoding]::UTF8.GetString($taskBytes)
  [Console]::Error.WriteLine('EGOIST_BOUNDARY_PHASE:utf8-decoded')
  [Console]::Error.WriteLine('EGOIST_BOUNDARY_META:{"schemaVersion":1,"byteCount":'+$taskBytes.Length+',"charCount":'+$taskJson.Length+'}')
  [Console]::Error.WriteLine('EGOIST_BOUNDARY_PHASE:before-security-import')
  Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
  [Console]::Error.WriteLine('EGOIST_BOUNDARY_PHASE:security-imported')
  if(-not [String]::Equals($taskJson,'{"resourcesPath":"C:\\Program Files\\EgoistShield\\resources"}',[StringComparison]::Ordinal)){throw [FormatException]::new('Fixed request mismatch')}
  [Console]::Error.WriteLine('EGOIST_BOUNDARY_PHASE:request-decoded')
  [Console]::Out.WriteLine('{"ok":true,"requestMatched":true}')
  [Console]::Out.Flush()
  [Console]::Error.WriteLine('EGOIST_BOUNDARY_PHASE:result-flushed')
  $null=[Console]::In.ReadLine()
} catch {
  [Console]::Error.WriteLine('EGOIST_BOUNDARY_PHASE:probe-exception')
  $taskCategory=[int]$_.CategoryInfo.Category
  $taskHresult=$_.Exception.HResult
  $taskInnerHresult=if($null -ne $_.Exception.InnerException){[string]$_.Exception.InnerException.HResult}else{'null'}
  [Console]::Error.WriteLine('EGOIST_BOUNDARY_META:{"schemaVersion":1,"errorCategory":'+$taskCategory+',"hresult":'+$taskHresult+',"innerHresult":'+$taskInnerHresult+'}')
  [Console]::Out.WriteLine('{"ok":false,"requestMatched":false}')
  [Console]::Out.Flush()
  exit 1
}
