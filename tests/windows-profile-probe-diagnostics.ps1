param([Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($EvidenceDirectory)) { throw 'Supply an absolute evidence directory.' }
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
$version = (& $curl --version 2>&1 | Out-String).Trim()
$targets = @('https://discord.com','https://discord.com/api/v10/gateway','https://www.youtube.com','https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg')
$variants = @(
  @{name='HTTP'; flags=@('--http1.1')},
  @{name='TLS1.2'; flags=@('--tlsv1.2','--tls-max','1.2')},
  @{name='TLS1.3'; flags=@('--tlsv1.3','--tls-max','1.3')}
)
$rows = @()
foreach ($url in $targets) {
  foreach ($variant in $variants) {
    $argsForCurl = @('-q','--noproxy','*','--head','--location','--max-redirs','3','--connect-timeout','4','--max-time','4','--silent','--show-error','--output','NUL','--write-out','%{http_code}') + $variant.flags + @($url)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    # Windows PowerShell treats native stderr as an error record; retain it for the report.
    $ErrorActionPreference = 'Continue'
    $output = (& $curl @argsForCurl 2>&1 | Out-String).Trim()
    $exit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $rows += [pscustomobject]@{url=$url; variant=$variant.name; exitCode=$exit; elapsedMs=$timer.ElapsedMilliseconds; output=$output}
  }
}
$os = Get-CimInstance Win32_OperatingSystem
$report = [pscustomobject]@{createdAt=[DateTime]::UtcNow.ToString('o'); operatingSystem=$os.Caption; build=$os.BuildNumber; curl=$version; probes=$rows; scope='Read-only HTTPS header probes. No services or network settings changed.'}
$file = Join-Path $EvidenceDirectory 'profile-probe-diagnostics.json'
[IO.File]::WriteAllText($file, ($report | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
Write-Output $file
