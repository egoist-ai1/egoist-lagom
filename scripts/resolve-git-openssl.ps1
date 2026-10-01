function Resolve-GitOpenSsl {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateNotNullOrEmpty()]
        [string[]]$GitApplicationPaths
    )

    $gitPath = [string]($GitApplicationPaths | Select-Object -First 1)
    if (-not [IO.Path]::IsPathRooted($gitPath)) {
        throw 'Git application must have an absolute path.'
    }
    $gitApplication = Get-Item -LiteralPath $gitPath -ErrorAction Stop
    if ($gitApplication.PSIsContainer -or $gitApplication.Name -ne 'git.exe') {
        throw 'Selected Git application must be a git.exe file.'
    }

    $applicationDirectory = $gitApplication.Directory
    if ($applicationDirectory.Name -eq 'cmd') {
        $gitRoot = $applicationDirectory.Parent.FullName
    } elseif ($applicationDirectory.Name -eq 'bin') {
        $gitRoot = $applicationDirectory.Parent.FullName
        if ($applicationDirectory.Parent.Name -in @('mingw64', 'mingw32')) {
            $gitRoot = $applicationDirectory.Parent.Parent.FullName
        }
    } else {
        throw 'Selected Git application uses an unsupported installation layout.'
    }

    $opensslPath = [string](Join-Path $gitRoot 'usr\bin\openssl.exe')
    if (-not (Test-Path -LiteralPath $opensslPath -PathType Leaf)) {
        throw 'Git OpenSSL is missing from the selected Git installation.'
    }
    return [string](Get-Item -LiteralPath $opensslPath -ErrorAction Stop).FullName
}
