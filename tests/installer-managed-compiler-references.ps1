param(
    [Parameter(Mandatory = $true)][string]$TestDirectory,
    [Parameter(Mandatory = $true)][string]$NativeSystemDll,
    [Parameter(Mandatory = $true)]
    [ValidateSet('heartbeat', 'proxy', 'restart-manager', 'worker-input', 'gui-identity', 'file-locks')][string]$Site
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSEdition -ne 'Desktop') {
    throw 'This regression requires a fresh Windows PowerShell 5.1 process.'
}

# Compile only the actual Add-Type statement. The containing functions also have
# operational P/Invoke calls, which this fixture must never invoke.
$sites = @{
    'heartbeat' = @('src/installer/owned-cleanup.ps1', 'Initialize-ProtectedInstallerHeartbeatNative', 'LagomInstallerHeartbeatSnapshotNative')
    'proxy' = @('src/installer/owned-cleanup.ps1', 'Notify-SystemProxyChanged', 'EgoistShield.Native.WinInet')
    'restart-manager' = @('src/installer/owned-cleanup.ps1', 'Initialize-RestartManagerApi', 'EgoistShieldRestartManager')
    'worker-input' = @('scripts/invoke-final-silent-reinstall.ps1', 'Assert-OwnedSystemDohInputSingleLink', 'LagomOwnedDnsInputIdentity.Native')
    'gui-identity' = @('src/installer/gui-login-startup.ps1', 'Get-GuiStartupInteractiveIdentity', 'EgoistGuiStartupNative')
    'file-locks' = @('src/installer/installer-file-locks.ps1', 'Initialize-InstallerFileLockApi', 'LagomInstallerFileLocks.Native')
}
$definition = $sites[$Site]
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot $definition[0]
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Installer source has parser errors.' }
$functions = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $definition[1]
}, $true))
if ($functions.Count -ne 1) { throw 'Expected exactly one actual initializer function.' }
$commands = @($functions[0].Body.FindAll({ param($node)
    $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Add-Type'
}, $true))
if ($commands.Count -ne 1) { throw 'Expected exactly one actual C# compilation statement.' }
$command = $commands[0]
$referenceParameters = @($command.CommandElements | Where-Object {
    $_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -ceq 'ReferencedAssemblies'
})
if ($referenceParameters.Count -ne 1) { throw 'Actual compilation must supply explicit managed references.' }
$referenceIndex = [Array]::IndexOf([object[]]$command.CommandElements, $referenceParameters[0])
$expectedExpression = '@([object].Assembly.Location,[System.Uri].Assembly.Location,[System.Linq.Enumerable].Assembly.Location)'
if (($command.CommandElements[$referenceIndex + 1].Extent.Text -replace '\s', '') -cne $expectedExpression) {
    throw 'References must come from the three already loaded CLR assemblies.'
}

$directory = [IO.Path]::GetFullPath($TestDirectory).TrimEnd('\')
$caseParent = Split-Path -Parent $directory
if ((Split-Path -Leaf $directory) -cne $Site -or (Split-Path -Leaf $caseParent) -notmatch '^lagom-managed-compiler-references-[a-f0-9-]{36}$') {
    throw 'Use an isolated fixture directory for this site.'
}
foreach ($path in @($directory, $caseParent)) {
    $item = Get-Item -LiteralPath $path
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Fixture directories must be ordinary directories.'
    }
}
$compilerDirectory = Join-Path $directory 'compiler'
[void][IO.Directory]::CreateDirectory($compilerDirectory)
$env:TEMP = $compilerDirectory
$env:TMP = $compilerDirectory
Set-Location -LiteralPath $directory
[Environment]::CurrentDirectory = $directory
$locationBefore = (Get-Location).Path
$cwdBefore = [Environment]::CurrentDirectory

$originalHash = (Get-FileHash -LiteralPath $NativeSystemDll -Algorithm SHA256).Hash
$pluginPath = Join-Path $directory 'System.dll'
[IO.File]::Copy([IO.Path]::GetFullPath($NativeSystemDll), $pluginPath, $false)
$pluginHash = (Get-FileHash -LiteralPath $pluginPath -Algorithm SHA256).Hash
if ($pluginHash -cne $originalHash) { throw 'Copied NSIS plugin hash differs.' }
$held = [IO.File]::Open($pluginPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    $nativeMetadataRejected = $false
    try { [void][Reflection.AssemblyName]::GetAssemblyName($pluginPath) }
    catch [BadImageFormatException] { $nativeMetadataRejected = $true }
    if (-not $nativeMetadataRejected) { throw 'The cwd System.dll must be an actual native plugin.' }
    if ($definition[2] -as [type]) { throw 'Compiled type already exists; each site requires a fresh process.' }
    $references = @([object].Assembly.Location, [System.Uri].Assembly.Location, [System.Linq.Enumerable].Assembly.Location)
    foreach ($reference in $references) {
        if (-not [IO.Path]::IsPathRooted($reference) -or -not [IO.File]::Exists($reference) -or $reference.StartsWith($caseParent, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Managed references must be absolute loaded framework assemblies outside the fixture.'
        }
    }
    $output = @(& ([scriptblock]::Create($command.Extent.Text)))
    $compiled = [bool]($definition[2] -as [type])
    if (-not $compiled -or $output.Count -ne 0) { throw 'Actual C# compilation must load its type and emit no output.' }
    $samePlugin = (Get-FileHash -LiteralPath $pluginPath -Algorithm SHA256).Hash -ceq $pluginHash
    $sameOriginal = (Get-FileHash -LiteralPath $NativeSystemDll -Algorithm SHA256).Hash -ceq $originalHash
    $sameCwd = (Get-Location).Path -ceq $locationBefore -and [Environment]::CurrentDirectory -ceq $cwdBefore
    $sameSource = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ceq $sourceHash
    if (-not $samePlugin -or -not $sameOriginal -or -not $sameCwd -or -not $sameSource) {
        throw 'Source, held plugin, original plugin or either working directory changed.'
    }
    [pscustomobject]@{
        site = $Site
        nativeVersion = [string]$PSVersionTable.PSVersion
        source = $definition[0]
        sourceSha256 = $sourceHash.ToLowerInvariant()
        function = $definition[1]
        compiledType = $definition[2]
        compiled = $compiled
        compilationOutputCount = $output.Count
        nsisSha256 = $pluginHash.ToLowerInvariant()
        nativePluginMetadataRejected = $nativeMetadataRejected
        heldPluginUnchanged = $samePlugin
        originalPluginUnchanged = $sameOriginal
        cwdUnchanged = $sameCwd
        sourceUnchanged = $sameSource
        references = $references
        executionScope = 'actual Add-Type AST statement only'
        operationalCalls = 0
    } | ConvertTo-Json -Depth 4
}
finally { $held.Dispose() }
