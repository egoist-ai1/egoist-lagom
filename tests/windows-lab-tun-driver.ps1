$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$exe='C:\Program Files\EgoistShield\resources\runtime\xray\xray.exe'
foreach($name in @('egoist-tun','EgoistShield TUN Lab')){
  $config=@{log=@{loglevel='warning'};inbounds=@(@{listen='127.0.0.1';port=15353;protocol='http'},@{protocol='tun';settings=@{name=$name;MTU=1500;gateway=@('172.19.0.1/30');autoOutboundsInterface='auto'}});outbounds=@(@{protocol='freedom'})}
  [IO.File]::WriteAllText('C:\ShieldLab\tun-driver.json',($config|ConvertTo-Json -Depth 8))
  $timer=[Diagnostics.Stopwatch]::StartNew()
  $child=Start-Process $exe -ArgumentList 'run -c C:\ShieldLab\tun-driver.json' -WindowStyle Hidden -PassThru -RedirectStandardOutput 'C:\ShieldLab\tun-driver-stdout.txt' -RedirectStandardError 'C:\ShieldLab\tun-driver-stderr.txt'
  $started=$child.StartTime
  $ready=$false
  try {
    while($timer.Elapsed.TotalSeconds -lt 60){
      $child.Refresh();if($child.HasExited){break}
      $socket=[Net.Sockets.TcpClient]::new()
      try{$task=$socket.ConnectAsync('127.0.0.1',15353);if($task.Wait(500) -and $socket.Connected){$ready=$true;break}}catch{}finally{$socket.Dispose()}
      Start-Sleep -Milliseconds 250
    }
    [pscustomobject]@{adapter=$name;portReady=$ready;ms=$timer.ElapsedMilliseconds;hasExited=$child.HasExited} | ConvertTo-Json -Compress
  } finally {
    $live=Get-Process -Id $child.Id -ErrorAction SilentlyContinue
    if($live -and $live.StartTime -eq $started -and $live.Path -eq $exe){Stop-Process -Id $live.Id -Force;Wait-Process -Id $live.Id -Timeout 20 -ErrorAction SilentlyContinue}
  }
  foreach($file in 'C:\ShieldLab\tun-driver-stdout.txt','C:\ShieldLab\tun-driver-stderr.txt'){
    if(Test-Path -LiteralPath $file){
      $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
      $reader=[IO.StreamReader]::new($stream)
      try{Write-Output ($reader.ReadToEnd())}finally{$reader.Dispose()}
    }
  }
  Start-Sleep -Seconds 3
}
