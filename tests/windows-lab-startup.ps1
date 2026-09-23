$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable Shield guest required'}
$root='C:\Program Files\EgoistShield'
$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$beforeProxy=Get-ItemProperty $key | Select-Object ProxyEnable,ProxyServer,ProxyOverride,AutoConfigURL
$beforeDns=@(Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses)
# Electron 41.10.4 loads package.json productName before user main.js runs.
# The verified productName is `Egoist Shield`; package name remains diagnostic-only.
$statePath=Join-Path $env:APPDATA 'Egoist Shield\egoistshield-state.json'
# configureLoggerPaths() routes the packaged main process to this exact file.
$bootLogPath=Join-Path $env:APPDATA 'Egoist Shield\logs\main.log'
$packageNameStatePath=Join-Path $env:APPDATA 'egoistshield-1-desktop\egoistshield-state.json'
$packageNameBootLogPath=Join-Path $env:APPDATA 'egoistshield-1-desktop\logs\main.log'
$script:launchStartedLocal=$null

function Read-SharedLines {
  param([string]$Path)
  $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::UTF8,$true)
  try {while($null -ne ($line=$reader.ReadLine())){$line}} finally {$reader.Dispose()}
}

function Convert-BootLogTimestamp($line) {
  $match=[regex]::Match($line,'^\[(?<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\]')
  if(-not $match.Success){return $null}
  try {
    return [DateTime]::ParseExact($match.Groups['timestamp'].Value,'yyyy-MM-dd HH:mm:ss.fff',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeLocal)
  } catch {
    return $null
  }
}

function Get-BootReadiness {
  param([DateTime]$LaunchedAfter)
  if(-not (Test-Path -LiteralPath $bootLogPath -PathType Leaf)){
    return [pscustomobject]@{Ready=$false;Reason='Boot log is absent';LastStartIndex=$null;LastStartLine=$null;ReadinessLine=$null}
  }
  try {$lines=@(Read-SharedLines $bootLogPath)} catch {
    return [pscustomobject]@{Ready=$false;Reason=('Boot log is unreadable: '+$_.Exception.Message);LastStartIndex=$null;LastStartLine=$null;ReadinessLine=$null}
  }
  $startIndices=@(for($index=0;$index -lt $lines.Count;$index++){if($lines[$index] -match '\[boot\] createMainWindow:start'){$index}})
  if($startIndices.Count -eq 0){
    return [pscustomobject]@{Ready=$false;Reason='createMainWindow:start is absent';LastStartIndex=$null;LastStartLine=$null;ReadinessLine=$null}
  }
  $lastStartIndex=$startIndices[-1]
  $lastStartLine=$lines[$lastStartIndex]
  $lastStartTime=Convert-BootLogTimestamp $lastStartLine
  if($null -eq $lastStartTime -or $lastStartTime -lt $LaunchedAfter){
    return [pscustomobject]@{Ready=$false;Reason='Last createMainWindow:start predates this launch';LastStartIndex=$lastStartIndex;LastStartLine=$lastStartLine;ReadinessLine=$null}
  }
  for($index=$lastStartIndex+1;$index -lt $lines.Count;$index++){
    if($lines[$index] -match '\[window\] loadFile resolved successfully|\[boot\] createMainWindow:complete'){
      return [pscustomobject]@{Ready=$true;Reason='Fresh renderer readiness marker found';LastStartIndex=$lastStartIndex;LastStartLine=$lastStartLine;ReadinessLine=$lines[$index]}
    }
  }
  return [pscustomobject]@{Ready=$false;Reason='No renderer readiness marker after the fresh createMainWindow:start';LastStartIndex=$lastStartIndex;LastStartLine=$lastStartLine;ReadinessLine=$null}
}

function Get-InstalledUiProcesses {
  @(Get-Process -Name 'EgoistShield' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq (Join-Path $root 'EgoistShield.exe')})
}

function Initialize-WindowCapture {
  Add-Type -AssemblyName System.Drawing
  if(-not ('ShieldLab.WindowCapture' -as [type])){
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace ShieldLab {
  public static class WindowCapture {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr handle, out RECT rect);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool PrintWindow(IntPtr handle, IntPtr deviceContext, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern uint GetProcessId(IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  }
}
'@
  }
}

function Get-NativeCloseSnapshot {
  param([IntPtr]$Handle)
  $utc=[DateTime]::UtcNow.ToString('o')
  $ticks=[Diagnostics.Stopwatch]::GetTimestamp()
  $nativePid=[ShieldLab.WindowCapture]::GetProcessId($Handle)
  $pidError=if($nativePid -eq 0){[Runtime.InteropServices.Marshal]::GetLastWin32Error()}else{0}
  $waitCode=[ShieldLab.WindowCapture]::WaitForSingleObject($Handle,0)
  $waitError=if($waitCode -eq [uint32]::MaxValue){[Runtime.InteropServices.Marshal]::GetLastWin32Error()}else{0}
  [uint32]$exitCode=0
  $exitQueryOk=[ShieldLab.WindowCapture]::GetExitCodeProcess($Handle,[ref]$exitCode)
  $exitError=if(-not $exitQueryOk){[Runtime.InteropServices.Marshal]::GetLastWin32Error()}else{0}
  [pscustomobject]@{utc=$utc;stopwatchTicks=$ticks;nativePid=$nativePid;pidError=$pidError;waitCode=$waitCode;waitError=$waitError;exitQueryOk=$exitQueryOk;exitCode=$exitCode;exitError=$exitError}
}

function Save-InstalledWindowCapture {
  param([IntPtr]$WindowHandle,[string]$OutputPath)
  Initialize-WindowCapture
  $rect=New-Object ShieldLab.WindowCapture+RECT
  if(-not [ShieldLab.WindowCapture]::GetWindowRect($WindowHandle,[ref]$rect)){throw 'PrintWindow capture could not read the main-window bounds'}
  $width=$rect.Right-$rect.Left
  $height=$rect.Bottom-$rect.Top
  if($width -le 0 -or $height -le 0){throw "PrintWindow capture received invalid bounds ${width}x${height}"}
  $bitmap=New-Object Drawing.Bitmap $width,$height
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  try {
    $deviceContext=$graphics.GetHdc()
    try {$printed=[ShieldLab.WindowCapture]::PrintWindow($WindowHandle,$deviceContext,2)} finally {$graphics.ReleaseHdc($deviceContext)}
    if(-not $printed){throw 'PrintWindow did not render the installed main window'}
    $nonBlackSamples=0
    # Ignore the native border: an empty black client area has a white frame.
    for($y=32;$y -lt $height-32;$y+=16){
      for($x=32;$x -lt $width-32;$x+=16){
        $pixel=$bitmap.GetPixel($x,$y)
        if($pixel.R -gt 16 -or $pixel.G -gt 16 -or $pixel.B -gt 16){$nonBlackSamples++}
      }
    }
    if($nonBlackSamples -lt 50){throw 'PrintWindow captured an empty or incomplete client area after renderer readiness'}
    $bitmap.Save($OutputPath,[Drawing.Imaging.ImageFormat]::Png)
    return [pscustomobject]@{Width=$width;Height=$height;NonBlackSamples=$nonBlackSamples;Path=$OutputPath}
  } finally {$graphics.Dispose();$bitmap.Dispose()}
}

function Get-StartupDiagnostics {
  $launched=Get-Process -Id $process.Id -ErrorAction SilentlyContinue
  $launchedView=if($launched){[pscustomobject]@{
    Id=$launched.Id
    StartTime=$launched.StartTime.ToUniversalTime().ToString('o')
    MainWindowHandle=[Int64]$launched.MainWindowHandle
    MainWindowTitle=$launched.MainWindowTitle
    Path=$launched.Path
  }}else{$null}
  $matching=@(Get-InstalledUiProcesses | ForEach-Object {
    [pscustomobject]@{
      Id=$_.Id
      StartTime=$_.StartTime.ToUniversalTime().ToString('o')
      MainWindowHandle=[Int64]$_.MainWindowHandle
      MainWindowTitle=$_.MainWindowTitle
      Path=$_.Path
    }
  })
  $bootLogTail=if(Test-Path -LiteralPath $bootLogPath -PathType Leaf){
    try {@(Read-SharedLines $bootLogPath | Select-Object -Last 80)} catch {@("Boot log is unreadable: "+$_.Exception.Message)}
  }else{@("Boot log is absent: $bootLogPath")}
  [pscustomobject]@{
    statePath=$statePath
    stateExists=(Test-Path -LiteralPath $statePath -PathType Leaf)
    bootLogPath=$bootLogPath
    bootLogTail=$bootLogTail
    launchStartedLocal=if($script:launchStartedLocal){$script:launchStartedLocal.ToString('o')}else{$null}
    readiness=if($script:launchStartedLocal){Get-BootReadiness $script:launchStartedLocal}else{$null}
    packageNameCandidate=@{
      statePath=$packageNameStatePath
      stateExists=(Test-Path -LiteralPath $packageNameStatePath -PathType Leaf)
      bootLogPath=$packageNameBootLogPath
      bootLogExists=(Test-Path -LiteralPath $packageNameBootLogPath -PathType Leaf)
    }
    launchedProcess=$launchedView
    matchingEgoistShieldProcesses=$matching
  }
}

$existingUi=@(Get-InstalledUiProcesses | Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -in @('Egoist Shield','Error')})
if($existingUi.Count -gt 0){throw 'Installed UI is already running; refusing a stale-log startup result'}
# Compile the harness helper before launch so it does not compete with cold app startup.
Initialize-WindowCapture
$awakeState=[ShieldLab.WindowCapture]::SetThreadExecutionState([uint32]2147483651)
if($awakeState -eq 0){throw 'Disposable guest display keep-awake request failed'}
$script:launchStartedLocal=Get-Date
$captureId=[Guid]::NewGuid().ToString('N')
$stdoutPath=Join-Path 'C:\ShieldLab' ("ui-$captureId.stdout.log")
$stderrPath=Join-Path 'C:\ShieldLab' ("ui-$captureId.stderr.log")
$probePath='C:\ShieldLab\windows-lab-ui-probe.cjs'
if(-not (Test-Path -LiteralPath $probePath -PathType Leaf)){throw 'Guest UI acceptance probe is missing'}
$probeOutputPath=Join-Path 'C:\ShieldLab' ("ui-$captureId.probe.json")
$probeStdoutPath=Join-Path 'C:\ShieldLab' ("ui-$captureId.probe.stdout.log")
$probeStderrPath=Join-Path 'C:\ShieldLab' ("ui-$captureId.probe.stderr.log")
$probe=$null
$process=Start-Process (Join-Path $root 'EgoistShield.exe') -ArgumentList '--disable-gpu','--inspect=127.0.0.1:9229' -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
$processHandle=$process.Handle
$started=$process.StartTime
try {
  $oldRunAsNode=$env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE='1'
    $probe=Start-Process (Join-Path $root 'EgoistShield.exe') -ArgumentList $probePath,$process.Id,$probeOutputPath -WindowStyle Hidden -RedirectStandardOutput $probeStdoutPath -RedirectStandardError $probeStderrPath -PassThru
    # Retain the native handle so PowerShell can read ExitCode after a quick exit.
    $probeHandle=$probe.Handle
    $probeStarted=$probe.StartTime
  } finally {$env:ELECTRON_RUN_AS_NODE=$oldRunAsNode}
  # The harness deliberately supplies neither --minimized nor WindowStyle Hidden.
  # State and a native handle occur before loadFile() resolves, so require the
  # fresh renderer readiness log emitted after this launch's last window start.
  $readinessTimer=[Diagnostics.Stopwatch]::StartNew()
  $ready=$false
  $guestForeground=$false
  while($readinessTimer.Elapsed.TotalSeconds -lt 300){
    $current=Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if(-not $current -or $current.HasExited){
      $diagnostics=Get-StartupDiagnostics
      Write-Output ('STARTUP_DIAGNOSTICS='+($diagnostics|ConvertTo-Json -Depth 6 -Compress))
      throw 'Installed UI exited before renderer readiness'
    }
    if($current.MainWindowTitle -eq 'Error'){
      $diagnostics=Get-StartupDiagnostics
      Write-Output ('STARTUP_DIAGNOSTICS='+($diagnostics|ConvertTo-Json -Depth 6 -Compress))
      throw 'Installed UI displayed an Error window before renderer readiness'
    }
    $logReady=Get-BootReadiness $script:launchStartedLocal
    $stateReady=Test-Path -LiteralPath $statePath -PathType Leaf
    $current=Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    $windowReady=($current -and [Int64]$current.MainWindowHandle -ne 0 -and $current.MainWindowTitle -eq 'Egoist Shield')
    if($windowReady -and -not $guestForeground){
      # Target only the installed app inside this disposable guest, never the host desktop.
      [void][ShieldLab.WindowCapture]::ShowWindowAsync($current.MainWindowHandle,9)
      [void][ShieldLab.WindowCapture]::SetForegroundWindow($current.MainWindowHandle)
      $guestForeground=([ShieldLab.WindowCapture]::GetForegroundWindow() -eq $current.MainWindowHandle)
      if($guestForeground){Write-Output ('GUEST_APP_FOREGROUND='+$current.Id)}
    }
    if($stateReady -and $windowReady -and $logReady.Ready -and $guestForeground){$ready=$true;break}
    Start-Sleep -Seconds 2
  }
  if(-not $ready){
    $diagnostics=Get-StartupDiagnostics
    Write-Output ('STARTUP_DIAGNOSTICS='+($diagnostics|ConvertTo-Json -Depth 6 -Compress))
    throw 'Installed UI did not reach fresh renderer readiness within 300 seconds'
  }
  Write-Output ('STARTUP_READY='+(@{pid=$current.Id;windowTitle=$current.MainWindowTitle;stateExists=$stateReady;readinessLine=$logReady.ReadinessLine;elapsedMs=$readinessTimer.ElapsedMilliseconds}|ConvertTo-Json -Compress))
  $probeWaitMs=[Math]::Max(1,470000-$readinessTimer.ElapsedMilliseconds)
  if(-not $probe.WaitForExit([int]$probeWaitMs)){throw 'Guest UI acceptance probe exceeded its deadline'}
  $probe.WaitForExit()
  if(-not (Test-Path -LiteralPath $probeOutputPath -PathType Leaf)){throw 'Guest UI acceptance probe returned no receipt'}
  $probeResult=Get-Content -LiteralPath $probeOutputPath -Raw | ConvertFrom-Json
  Write-Output ('UI_COMPONENT_PROBE='+($probeResult|ConvertTo-Json -Depth 8 -Compress))
  if($probe.ExitCode -ne 0 -or $probeResult.ok -ne $true -or $probeResult.pidVerified -ne $true -or $probeResult.actualMainPid -ne $process.Id){throw 'Installed UI did not return accepted component statuses'}
  Write-Output 'PASS: actual installed renderer returned accepted System DoH, Zapret and Telegram Proxy status responses'
  $paintTimer=[Diagnostics.Stopwatch]::StartNew()
  while($true){
    try {$capture=Save-InstalledWindowCapture ([IntPtr]$current.MainWindowHandle) 'C:\ShieldLab\app-startup.png';break}
    catch {if($paintTimer.Elapsed.TotalSeconds -ge 90){throw};Start-Sleep -Seconds 5}
  }
  $uiReadyAt=Get-Date
  Write-Output ('WINDOW_CAPTURE='+($capture|ConvertTo-Json -Compress))
  $bootstrap=[IO.File]::ReadAllText('C:\Windows\Temp\lab-bootstrap.ps1')
  $base=[regex]::Match($bootstrap,'http://10\.0\.2\.2:[0-9]+').Value
  $token=[regex]::Match($bootstrap,"X-Lab-Token' = '([a-f0-9]+)'").Groups[1].Value
  $image=@{id='07-ui-image';imageBase64=[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\ShieldLab\app-startup.png'))}|ConvertTo-Json -Compress
  Invoke-RestMethod "$base/result" -Method Post -Headers @{'X-Lab-Token'=$token} -Body ([Text.Encoding]::UTF8.GetBytes($image)) -ContentType 'application/json' | Out-Null
  if($process.HasExited){throw 'Installed UI exited during startup'}
  # Keep the session open through identity, connection and component-response deadlines.
  $settleSeconds=[Math]::Max(0,160-((Get-Date)-$uiReadyAt).TotalSeconds)
  if($settleSeconds -gt 0){Start-Sleep -Seconds ([Math]::Ceiling($settleSeconds))}
  $state=Get-Content $statePath -Raw | ConvertFrom-Json
  foreach($flag in 'autoStart','autoConnect','systemDohEnabled','useTunMode','killSwitch'){if($state.settings.$flag){throw "Unexpected activation on first UI load: $flag"}}
  foreach($name in 'EgoistShieldSystemDoH','EgoistShieldTelegramProxy','EgoistShieldZapret'){
    $service=Get-Service $name -ErrorAction SilentlyContinue
    if($service -and $service.Status -eq 'Running'){throw "UI started stopped component: $name"}
  }
  $afterProxy=Get-ItemProperty $key | Select-Object ProxyEnable,ProxyServer,ProxyOverride,AutoConfigURL
  $afterDns=@(Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses)
  if(($beforeProxy|ConvertTo-Json -Compress) -ne ($afterProxy|ConvertTo-Json -Compress)){throw 'UI startup changed system proxy'}
  if(($beforeDns|ConvertTo-Json -Depth 4 -Compress) -ne ($afterDns|ConvertTo-Json -Depth 4 -Compress)){throw 'UI startup changed DNS'}
  Write-Output 'PASS: real installed UI starts with all activation flags off and preserves stopped services, DNS and proxy'
  $nativeBefore=Get-NativeCloseSnapshot -Handle $processHandle
  if($nativeBefore.nativePid -ne $process.Id){throw 'Retained native handle does not identify the verified main process'}
  $closeTimer=[Diagnostics.Stopwatch]::StartNew()
  $closeRequested=$process.CloseMainWindow()
  $managedExited=$process.WaitForExit(60000)
  $nativeAfter=Get-NativeCloseSnapshot -Handle $processHandle
  $closeTimer.Stop()
  Write-Output ('CLOSE_NATIVE_PROBE='+([pscustomobject]@{expectedMainPid=$process.Id;closeAccepted=$closeRequested;managedExited=$managedExited;elapsedMs=$closeTimer.ElapsedMilliseconds;before=$nativeBefore;after=$nativeAfter}|ConvertTo-Json -Depth 5 -Compress))
  $lifecyclePath="$probeOutputPath.lifecycle.jsonl"
  if(Test-Path -LiteralPath $lifecyclePath){Write-Output ('CLOSE_LIFECYCLE='+(@(Read-SharedLines $lifecyclePath)|ConvertTo-Json -Compress))}
  if(-not $closeRequested -or -not $managedExited){
    Write-Output ('CLOSE_DIAGNOSTICS='+([pscustomobject]@{minimizeToTray=$state.settings.minimizeToTray;logTail=@(Read-SharedLines $bootLogPath|Select-Object -Last 20)}|ConvertTo-Json -Depth 4 -Compress))
    $closeProcess=Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    Write-Output ('CLOSE_PROCESS='+(@{pid=$process.Id;exists=($null -ne $closeProcess);path=$closeProcess.Path;start=$closeProcess.StartTime;windowHandle=[Int64]$closeProcess.MainWindowHandle;windowTitle=$closeProcess.MainWindowTitle;cpu=$closeProcess.CPU}|ConvertTo-Json -Compress))
    foreach($streamPath in @($stdoutPath,$stderrPath)){
      Write-Output ('CLOSE_STREAM='+[IO.Path]::GetFileName($streamPath))
      if(Test-Path -LiteralPath $streamPath){Read-SharedLines $streamPath|Select-Object -Last 60}
    }
    throw 'UI did not close gracefully'
  }
  Write-Output 'PASS: installed UI closed gracefully'
  $freshStart=(Get-BootReadiness $script:launchStartedLocal).LastStartIndex
  $freshLog=@(Read-SharedLines $bootLogPath | Select-Object -Skip $freshStart)
  $freshLog+=@(Read-SharedLines $stdoutPath)
  $freshLog+=@(Read-SharedLines $stderrPath)
  if($freshLog -match 'Core service named-pipe identity verification failed|Core service did not accept a connection|Core service did not answer within'){
    $freshLog | Where-Object {$_ -match 'Core service named-pipe identity verification failed|Core service did not accept a connection|Core service did not answer within|PIPE_IDENTITY_|start:0'} | Select-Object -First 20
    throw 'Installed UI could not authenticate or communicate with Core during the fresh session'
  }
  Write-Output 'PASS: no Core authentication or communication failures during the fresh UI session'
} finally {
  foreach($streamPath in @($stdoutPath,$stderrPath)){
    if(Test-Path -LiteralPath $streamPath){
      Write-Output ('CORE_DIAGNOSTIC_STREAM='+[IO.Path]::GetFileName($streamPath))
      Read-SharedLines $streamPath | Select-String -Pattern 'Core service|PIPE_IDENTITY_|identity verification|stdout:' -Context 0,8 | ForEach-Object {$_.Line;$_.Context.PostContext}
    }
  }
  [void][ShieldLab.WindowCapture]::SetThreadExecutionState([uint32]2147483648)
  if($probe){
    $liveProbe=Get-Process -Id $probe.Id -ErrorAction SilentlyContinue
    if($liveProbe -and $liveProbe.StartTime -eq $probeStarted -and $liveProbe.Path -eq (Join-Path $root 'EgoistShield.exe')){Stop-Process -Id $liveProbe.Id -Force}
  }
  $live=Get-Process -Id $process.Id -ErrorAction SilentlyContinue
  if($live -and $live.StartTime -eq $started -and $live.Path -eq (Join-Path $root 'EgoistShield.exe')){Stop-Process -Id $live.Id -Force}
}
