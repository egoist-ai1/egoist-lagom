param([string]$WorkRoot = $env:LAGOM_TEST_TEMP)

$ErrorActionPreference = 'Stop'
if (-not $WorkRoot -or -not [IO.Path]::IsPathRooted($WorkRoot)) {
    throw 'Set LAGOM_TEST_TEMP to an absolute task-owned fixture directory.'
}
$workPath = [IO.Path]::GetFullPath($WorkRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$fixtureRoot = Join-Path $workPath ('git-openssl-' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($fixtureRoot)
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\resolve-git-openssl.ps1')
$checks = 0

function Assert-Resolution([string[]]$Paths, [string]$Expected) {
    $resolved = Resolve-GitOpenSsl -GitApplicationPaths $Paths
    if ($resolved -isnot [string] -or $resolved -ne $Expected) {
        throw 'Expected one OpenSSL path from the first selected Git installation.'
    }
    $script:checks += 1
}

function Assert-Rejected([string[]]$Paths) {
    $rejected = $false
    try { $null = Resolve-GitOpenSsl -GitApplicationPaths $Paths } catch { $rejected = $true }
    if (-not $rejected) { throw 'Invalid Git/OpenSSL input must fail closed.' }
    $script:checks += 1
}

function Write-FixtureFile([string]$File) {
    $null = [IO.Directory]::CreateDirectory((Split-Path $File -Parent))
    [IO.File]::WriteAllBytes($File, [byte[]]@())
}

try {
    $gitRoot = Join-Path $fixtureRoot 'Program Files\Git [fixture]'
    $openssl = Join-Path $gitRoot 'usr\bin\openssl.exe'
    Write-FixtureFile $openssl
    $applicationPaths = foreach ($layout in @('cmd', 'bin', 'mingw64\bin', 'mingw32\bin')) {
        $application = Join-Path $gitRoot ($layout + '\git.exe')
        Write-FixtureFile $application
        Assert-Resolution @($application) $openssl
        $application
    }

    $duplicateCommands = @(
        [pscustomobject]@{ Source = $applicationPaths[0] },
        [pscustomobject]@{ Source = $applicationPaths[1] },
        [pscustomobject]@{ Source = $applicationPaths[2] },
        [pscustomobject]@{ Source = $applicationPaths[0] }
    )
    Assert-Resolution @($duplicateCommands.Source) $openssl
    $legacyRoots = Split-Path (Split-Path @($duplicateCommands.Source) -Parent) -Parent
    $legacyOpenSsl = @(Join-Path $legacyRoots 'usr\bin\openssl.exe')
    $legacyReadback = @(Test-Path -LiteralPath $legacyOpenSsl -PathType Leaf)
    if ($legacyOpenSsl.Count -le 1 -or -not ($legacyReadback -contains $false) -or -not [bool]$legacyReadback) {
        throw 'Fixture must reproduce the previous array/truthiness failure.'
    }
    $checks += 1

    $missingGit = Join-Path $fixtureRoot 'Missing Git\cmd\git.exe'
    Write-FixtureFile $missingGit
    Assert-Rejected @($missingGit, $applicationPaths[0])
    $unsupportedGit = Join-Path $gitRoot 'sbin\git.exe'
    Write-FixtureFile $unsupportedGit
    Assert-Rejected @($unsupportedGit)
    Assert-Rejected @('git.exe')
    $directoryGit = Join-Path $fixtureRoot 'Directory Git\cmd\git.exe'
    $null = [IO.Directory]::CreateDirectory($directoryGit)
    Assert-Rejected @($directoryGit)
    Write-Output ('Git OpenSSL resolution checks: ' + $checks + ' passed')
} finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    if ((Split-Path $resolvedFixture -Parent) -ne $workPath -or -not $resolvedFixture.StartsWith($workPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing cleanup outside the task-owned fixture directory.'
    }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
