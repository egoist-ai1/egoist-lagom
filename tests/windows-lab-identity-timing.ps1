$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$exe='C:\Program Files\EgoistShield\resources\core-service\win-x64\EgoistShield.Service.exe'
foreach($run in 1..2){
  $timer=[Diagnostics.Stopwatch]::StartNew()
  $text=& $exe --verify-pipe-server --pipe-name EgoistShield.Service.v1 --service-name EgoistShieldCore
  $code=$LASTEXITCODE
  $timer.Stop()
  [pscustomobject]@{run=$run;ms=$timer.ElapsedMilliseconds;exitCode=$code;result=($text -join "`n")} | ConvertTo-Json -Compress
}
