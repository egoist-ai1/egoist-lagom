param([Parameter(Mandatory=$true)][string]$XrayTestBinary)
$ErrorActionPreference = 'Stop'
if (-not $env:LAGOM_TEST_TEMP -or -not [IO.Path]::IsPathRooted($env:LAGOM_TEST_TEMP)) { throw 'Set task-scoped LAGOM_TEST_TEMP.' }
$fixtureRoot = Join-Path $env:LAGOM_TEST_TEMP ('m [x]-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$script:RuntimeRoot = Join-Path $fixtureRoot 'Runtime'
$null = New-Item -ItemType Directory -Path $script:RuntimeRoot -Force
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\scripts\invoke-final-silent-reinstall.ps1'))
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @('Assert-OwnedRuntimeMigrationPath','Write-OwnedRuntimeMigrationFile','Update-PreservedRuntimeReliability','Get-PatchedSystemDohMigrationConfiguration')) {
  $fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
  if (-not $fn) { throw "Missing function $name" }
  . ([scriptblock]::Create($fn.Extent.Text))
}
$script:serviceStatus='Stopped'
function Get-Service { param($Name,$ErrorAction) return [pscustomobject]@{Status=$script:serviceStatus} }
function Require { param([bool]$Value,[string]$Message) if (-not $Value) { throw $Message } }
$root=Join-Path $script:RuntimeRoot 'SystemDoH'
$wrapper=Join-Path $root 'service-wrapper\egoistshield-system-doh-service.exe'
$engine=Join-Path $root 'runtime\xray-system-doh.exe'
$xmlPath=[IO.Path]::ChangeExtension($wrapper,'.xml')
$configPath=Join-Path $root 'config.json'
$null=New-Item -ItemType Directory -Path (Split-Path -Parent $wrapper) -Force
$null=New-Item -ItemType Directory -Path (Split-Path -Parent $engine) -Force
Copy-Item -LiteralPath $XrayTestBinary -Destination $engine
[IO.File]::WriteAllText($wrapper,'fixture')
$originalXml="<service><id>EgoistShieldSystemDoH</id><executable>$engine</executable><arguments>--preserved-argument</arguments><log mode='roll-by-size'><sizeThreshold>10485760</sizeThreshold><keepFiles>5</keepFiles></log><onfailure action='restart' delay='5 sec'/><resetfailure>1 day</resetfailure></service>"
[IO.File]::WriteAllText($xmlPath,$originalXml)
$config=@{log=@{loglevel='warning';error=(Join-Path $root 'runtime.log')};dns=@{hosts=@{'preserved.example'='192.0.2.9'};servers=@('https+local://cloudflare-dns.com/dns-query')};inbounds=@(@{listen='127.0.0.1';port=53001;protocol='dokodemo-door';settings=@{address='1.1.1.1';port=53;network='tcp,udp'}});outbounds=@(@{protocol='freedom'})}
$config | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $configPath -Encoding utf8
$state=[pscustomobject]@{services=@([pscustomobject]@{name='EgoistShieldSystemDoH';pathName=$wrapper;wasRunning=$true})}
Update-PreservedRuntimeReliability $state
$after=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
Require ($after.dns.hosts.'health.egoist.invalid' -eq '127.0.0.1') 'Static health marker missing.'
Require ($after.dns.hosts.'preserved.example' -eq '192.0.2.9') 'Preserved host was modified.'
Require ($after.dns.servers[0] -eq 'https+local://cloudflare-dns.com/dns-query') 'Preserved upstream was modified.'
Require ($after.dns.serveStale -eq $true -and $after.dns.serveExpiredTTL -eq 120) 'Retained DNS did not receive the bounded cache policy.'
Require ($after.log.error -eq '') 'DNS logging did not move to wrapper stderr.'
[xml]$afterXml=Get-Content -LiteralPath $xmlPath -Raw
Require ($afterXml.service.arguments -eq '--preserved-argument') 'Wrapper arguments were modified.'
Require ($afterXml.service.log.sizeThreshold -eq '10240') 'Wrapper log threshold not corrected.'
Require ((@($afterXml.service.onfailure | ForEach-Object { $_.delay }) -join ',') -ceq '0 sec,1 sec,60 sec') 'Private DNS wrapper retry schedule not corrected.'
Require ($afterXml.service.resetfailure -eq '1 hour') 'Wrapper failure reset not corrected.'
Write-Output 'PASS: stopped-runtime migration preserves upstream/hosts/arguments and real Xray accepts result'
foreach ($component in @(@('EgoistShieldTelegramProxy','TelegramProxy','egoistshield-telegram-proxy-service'),@('EgoistShieldZapret','Zapret','egoistshield-zapret-service'))) {
  $componentRoot=Join-Path $script:RuntimeRoot $component[1]
  $addonWrapper=Join-Path $componentRoot ('service-wrapper\'+$component[2]+'.exe')
  $addonEngine=Join-Path $componentRoot 'runtime\fixture.exe'
  New-Item -ItemType Directory -Path (Split-Path -Parent $addonWrapper),(Split-Path -Parent $addonEngine) -Force | Out-Null
  [IO.File]::WriteAllText($addonWrapper,'Own addon wrapper sentinel; not executed.')
  [IO.File]::WriteAllText($addonEngine,'Own addon engine sentinel; not executed.')
  $addonXml=[IO.Path]::ChangeExtension($addonWrapper,'.xml')
  [IO.File]::WriteAllText($addonXml,('<service><id>'+ $component[0]+'</id><executable>'+[Security.SecurityElement]::Escape($addonEngine)+'</executable><arguments>--fixture</arguments><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log></service>'))
  Update-PreservedRuntimeReliability ([pscustomobject]@{services=@([pscustomobject]@{name=$component[0];pathName=$addonWrapper})})
  [xml]$addon=Get-Content -LiteralPath $addonXml -Raw
  Require ((@($addon.service.onfailure | ForEach-Object {$_.delay}) -join ',') -ceq '5 sec,10 sec,60 sec') 'DNS-specific fast retry changed an addon policy.'
}
$migratedHash=(Get-FileHash -LiteralPath $configPath).Hash
Update-PreservedRuntimeReliability $state
Require ((Get-FileHash -LiteralPath $configPath).Hash -eq $migratedHash) 'Idempotent cache migration changed config bytes.'
Write-Output 'PASS: migration is idempotent with an existing health marker'
foreach ($oldCache in @(@{enabled=$false;ttl=0},@{enabled=$true;ttl=900})) {
  $beforePolicy=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $beforePolicy.dns.serveStale=$oldCache.enabled
  $beforePolicy.dns.serveExpiredTTL=$oldCache.ttl
  $beforePolicy | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $configPath -Encoding utf8
  Update-PreservedRuntimeReliability $state
  $afterPolicy=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  Require ($afterPolicy.dns.serveStale -eq $true -and $afterPolicy.dns.serveExpiredTTL -eq 120) 'Older cache policy was not bounded to120seconds.'
  Require ($afterPolicy.dns.servers[0] -eq $beforePolicy.dns.servers[0] -and $afterPolicy.dns.hosts.'preserved.example' -eq '192.0.2.9') 'Cache migration changed provider or preserved host.'
  Write-Output ('PASS: older cache policy '+$oldCache.enabled+'/'+$oldCache.ttl+' receives bounded120seconds and real Xray validation')
}
$script:serviceStatus='Running'
$hash=(Get-FileHash -LiteralPath $xmlPath).Hash
$refused=$false
try { Update-PreservedRuntimeReliability $state } catch { $refused=$_.Exception.Message -like '*stopped service*' }
Require $refused 'Running service migration was not refused.'
Require ((Get-FileHash -LiteralPath $xmlPath).Hash -eq $hash) 'Running service refusal modified configuration.'
Write-Output 'PASS: running service is rejected before writing'
$script:serviceStatus='Stopped'
$outside=[pscustomobject]@{services=@([pscustomobject]@{name='EgoistShieldSystemDoH';pathName='C:\external\foreign.exe'})}
$refused=$false
try { Update-PreservedRuntimeReliability $outside } catch { $refused=$_.Exception.Message -like '*ownership mismatch*' }
Require $refused 'Foreign service path was not refused.'
Write-Output 'PASS: foreign service ownership is rejected'
$after.dns.hosts.'health.egoist.invalid'='192.0.2.10'
$after | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $configPath -Encoding utf8
$refused=$false
try { Update-PreservedRuntimeReliability $state } catch { $refused=$_.Exception.Message -like '*marker conflicts*' }
Require $refused 'Conflicting health marker was not refused.'
Write-Output 'PASS: conflicting health marker is preserved and migration fails for recovery'
Write-Output 'Runtime migration checks: 7 passed; no service, registry or adapter mutations'
