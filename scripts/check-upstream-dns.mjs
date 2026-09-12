import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import { fetch, Agent } from 'undici';
const state = JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'Egoist Shield/egoistshield-state.json'),'utf8'));
const evidenceDir = path.resolve('recovery/evidence');
await fs.mkdir(evidenceDir, { recursive: true });
const nodes = state.nodes.filter(n=>n.protocol==='vless').filter((n,i,all)=>all.findIndex(x=>x.server===n.server)===i).slice(0,3);
const report=[];
for(let i=0;i<nodes.length;i++){
  const name=nodes[i].server;
  const row={index:i,system:await dns.lookup(name,{all:true}).then(a=>({count:a.length}),e=>({error:e.code}))};
  const dispatcher = new Agent({connect:{lookup:(_host,options,cb)=>options.all?cb(null,[{address:'1.1.1.1',family:4}]):cb(null,'1.1.1.1',4)}});
  try{
    const r=await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`,{headers:{accept:'application/dns-json'},dispatcher,signal:AbortSignal.timeout(15000)});
    const data=await r.json();row.doh={http:r.status,rcode:data.Status,count:data.Answer?.length||0};
  }catch(e){row.doh={error:e.cause?.code||e.name};}finally{await dispatcher.close();}
  report.push(row);
}
await fs.writeFile(path.join(evidenceDir, 'upstream-dns.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
