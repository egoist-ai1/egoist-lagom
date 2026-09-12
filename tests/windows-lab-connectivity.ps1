$ErrorActionPreference='Stop'
if($env:COMPUTERNAME -notin @('SHIELD-LAB','SHIELD-UD5I7VUH')){throw 'Disposable guest required'}
$js=@'
const https=require('node:https');const dns=require('node:dns').promises;
async function probe(name,url,options={}){const start=Date.now();let tcp=null,tls=null;return new Promise(resolve=>{const req=https.get(url,options,res=>{res.resume();resolve({name,status:res.statusCode,tcp,tls,ms:Date.now()-start})});req.on('socket',s=>{s.on('connect',()=>tcp=Date.now()-start);s.on('secureConnect',()=>tls=Date.now()-start)});req.on('error',e=>resolve({name,error:e.code,tcp,tls,ms:Date.now()-start}));req.setTimeout(30000,()=>req.destroy(Object.assign(new Error('deadline'),{code:'DEADLINE'})));});}
Promise.all([probe('ip','https://1.1.1.1/cdn-cgi/trace'),probe('hostname-pinned','https://cloudflare-dns.com/dns-query',{lookup:(_h,_o,cb)=>cb(null,[{address:'104.16.249.249',family:4}])}),probe('system-lookup','https://example.com/')]).then(rows=>{console.log(JSON.stringify(rows));process.exit(0)});
'@
[IO.File]::WriteAllText('C:\ShieldLab\connectivity.cjs',$js)
$env:ELECTRON_RUN_AS_NODE='1'
try{
  $p=Start-Process 'C:\Program Files\EgoistShield\EgoistShield.exe' -ArgumentList 'C:\ShieldLab\connectivity.cjs' -PassThru -Wait -RedirectStandardOutput 'C:\ShieldLab\connectivity-out.txt' -RedirectStandardError 'C:\ShieldLab\connectivity-err.txt'
  [IO.File]::ReadAllText('C:\ShieldLab\connectivity-out.txt')
  [IO.File]::ReadAllText('C:\ShieldLab\connectivity-err.txt')
}finally{Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue}
$body=[IO.File]::ReadAllText('C:\ShieldLab\vpn-stderr.txt')
$safe=$body -replace '(?i)https?://\S+','[url]' -replace '(?i)[a-z0-9_-]+(?:\.[a-z0-9_-]+)+','[address]' -replace '[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}','[id]'
$safe -split "`n" | Where-Object {$_ -match 'cause|code:|Error:|unreachable|ECONN|ENET|EHOST|ENOENT'} | Select-Object -First 25
