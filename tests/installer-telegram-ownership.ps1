$ErrorActionPreference='Stop'
$sources=@('..\scripts\invoke-final-silent-reinstall.ps1','..\src\installer\owned-cleanup.ps1')
$wrapper='C:\fixture\TelegramProxy\service-wrapper\egoistshield-telegram-proxy-service.exe'
$origin=[DateTime]::UtcNow.AddMinutes(-10)
$listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
$listener.Start()
$port=$listener.LocalEndpoint.Port
function Require([bool]$Value,[string]$Message) { if(-not $Value){throw $Message} }
function Reset-Fixture {
  $script:fixtureState='Running'
  $script:fixtureWrapper=$wrapper
  $script:fixtureOwner=30
  $script:fixtureAddress='127.0.0.1'
  $script:fixtureFailure=$false
  $script:fixtureChildCreated=$origin.AddSeconds(2)
}
function Get-CimInstance {
  param([Parameter(Position=0)][string]$ClassName,[string]$Filter,[string]$Namespace,[string[]]$Property,[int]$OperationTimeoutSec)
  Require ($OperationTimeoutSec -eq 3) 'CIM ownership query must carry a bounded timeout.'
  if($script:fixtureFailure){throw 'fixture CIM unavailable'}
  switch($ClassName) {
    'Win32_Service' { return [pscustomobject]@{State=$script:fixtureState;ProcessId=10;PathName=$script:fixtureWrapper} }
    'Win32_Process' { return @(
      [pscustomobject]@{ProcessId=10;ParentProcessId=0;ExecutablePath=$wrapper;CreationDate=$origin},
      [pscustomobject]@{ProcessId=20;ParentProcessId=10;ExecutablePath='C:\fixture\TelegramProxy\runtime\proxy.exe';CreationDate=$origin.AddSeconds(1)},
      [pscustomobject]@{ProcessId=30;ParentProcessId=20;ExecutablePath='C:\fixture\TelegramProxy\runtime\proxy.exe';CreationDate=$script:fixtureChildCreated},
      [pscustomobject]@{ProcessId=90;ParentProcessId=0;ExecutablePath='C:\fixture\Relay\proxy.exe';CreationDate=$origin}
    ) }
    'MSFT_NetTCPConnection' {
      Require ($Filter -eq "LocalPort=$port AND State=2") 'Listener query must filter the configured port and Listen state.'
      return [pscustomobject]@{LocalAddress=$script:fixtureAddress;OwningProcess=$script:fixtureOwner}
    }
    default {throw 'Unexpected fixture CIM class.'}
  }
}
try {
  foreach($source in $sources) {
    $tokens=$null; $parseErrors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile([IO.Path]::GetFullPath((Join-Path $PSScriptRoot $source)),[ref]$tokens,[ref]$parseErrors)
    Require ($parseErrors.Count -eq 0) 'Installer source does not parse in Windows PowerShell.'
    foreach($name in @('Test-OwnedTelegramProxyListener','Wait-OwnedTelegramProxyReady')) {
      $fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
      Require ($null -ne $fn) 'Missing owned listener check.'
      . ([scriptblock]::Create($fn.Extent.Text))
    }
    Reset-Fixture
    Require (Test-OwnedTelegramProxyListener -ExpectedWrapper $wrapper -Port $port) 'Owned descendant listener was rejected.'
    Require (Wait-OwnedTelegramProxyReady -ExpectedWrapper $wrapper -Port $port -TimeoutSeconds 2) 'Owned listener did not pass actual local TCP connection.'
    $script:fixtureOwner=90
    Require (-not (Test-OwnedTelegramProxyListener -ExpectedWrapper $wrapper -Port $port)) 'Foreign Relay listener counted as ready.'
    Require (-not (Wait-OwnedTelegramProxyReady -ExpectedWrapper $wrapper -Port $port -TimeoutSeconds 1)) 'Reachable foreign listener counted as upgrade success.'
    Reset-Fixture; $script:fixtureState='Start Pending'
    Require (-not (Test-OwnedTelegramProxyListener -ExpectedWrapper $wrapper -Port $port)) 'SCM pending counted as ready.'
    Reset-Fixture; $script:fixtureWrapper='C:\foreign\wrapper.exe'
    Require (-not (Test-OwnedTelegramProxyListener -ExpectedWrapper $wrapper -Port $port)) 'Foreign wrapper counted as owned.'
    Reset-Fixture; $script:fixtureChildCreated=$origin.AddSeconds(-1)
    Require (-not (Test-OwnedTelegramProxyListener -ExpectedWrapper $wrapper -Port $port)) 'Reused parent PID admitted an older foreign process.'
    Reset-Fixture; $script:fixtureAddress='::1'
    Require (-not (Test-OwnedTelegramProxyListener -ExpectedWrapper $wrapper -Port $port)) 'Opposite address family counted as configured endpoint.'
    Reset-Fixture; $script:fixtureFailure=$true
    Require (-not (Wait-OwnedTelegramProxyReady -ExpectedWrapper $wrapper -Port $port -TimeoutSeconds 1)) 'Unknown ownership counted as upgrade success.'
    Reset-Fixture
    Require (-not (Test-OwnedTelegramProxyListener -ExpectedWrapper $wrapper -Port $port -HostAddress '192.0.2.1')) 'Non-loopback endpoint accepted.'
    Write-Output ('PASS: 10 Telegram ownership checks for ' + [IO.Path]::GetFileName($source))
  }
  Write-Output 'Telegram upgrade ownership: 20 checks passed; actual local TCP, no service or registry mutation.'
} finally {$listener.Stop()}
