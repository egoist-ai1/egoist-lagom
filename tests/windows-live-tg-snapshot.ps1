$ErrorActionPreference = 'Stop'
$serviceBefore = Get-CimInstance Win32_Service -Filter "Name='EgoistShieldTelegramProxy'" -ErrorAction Stop
if (-not $serviceBefore) { throw 'Owned service metadata is unavailable.' }
$all = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath)
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { [int]$_.LocalPort -eq 1445 })
if ($listeners.Count -gt 128) { throw 'Listener snapshot exceeds its bound.' }
$byId = @{}
foreach ($process in $all) { $byId[[int]$process.ProcessId] = $process }
$needed = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$needed.Add([int]$serviceBefore.ProcessId)
foreach ($listener in $listeners) {
  $cursor = [int]$listener.OwningProcess
  for ($depth = 0; $depth -lt 32 -and $cursor -gt 0; $depth++) {
    if (-not $needed.Add($cursor)) { break }
    $process = $byId[$cursor]
    if (-not $process) { break }
    $cursor = [int]$process.ParentProcessId
  }
}
if ($needed.Count -gt 128) { throw 'Listener ancestry exceeds its bound.' }
$rows = @()
foreach ($processId in $needed) {
  $process = $byId[$processId]
  if (-not $process) { continue }
  $created = $null
  if ($process.CreationDate) { $created = ([DateTimeOffset]$process.CreationDate).ToString('o') }
  $rows += [pscustomobject]@{ processId=[int]$process.ProcessId; parentProcessId=[int]$process.ParentProcessId; createdAt=$created; executablePath=[string]$process.ExecutablePath }
}
$serviceAfter = Get-CimInstance Win32_Service -Filter "Name='EgoistShieldTelegramProxy'" -ErrorAction Stop
$stable = $serviceAfter -and [int]$serviceAfter.ProcessId -eq [int]$serviceBefore.ProcessId -and [string]$serviceAfter.State -eq [string]$serviceBefore.State
[pscustomobject]@{
  serviceProcessId=[int]$serviceBefore.ProcessId
  serviceState=[string]$serviceBefore.State
  stable=[bool]$stable
  processes=@($rows)
  listeners=@($listeners | ForEach-Object { [pscustomobject]@{ localAddress=[string]$_.LocalAddress; localPort=[int]$_.LocalPort; owningProcess=[int]$_.OwningProcess } })
} | ConvertTo-Json -Compress -Depth 6