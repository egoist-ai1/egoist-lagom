import fs from 'node:fs/promises';
import path from 'node:path';
import { fetch } from 'undici';
const errorCode = error => String(error?.cause?.code || error?.code || error?.name || 'subscription_probe_failed');
const safeErrorMessage = (error, secret) => String(error?.message || 'Subscription request failed').replaceAll(secret, '[redacted]');
const state=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'Egoist Shield/egoistshield-state.json'),'utf8'));
const selected=state.nodes.find(n=>n.id===state.activeNodeId);
const subscription=state.subscriptions.find(s=>s.id===selected?.subscriptionId);
if(!subscription)throw new Error('No selected subscription');
const evidenceDir = path.resolve('recovery/evidence');
await fs.mkdir(evidenceDir, { recursive: true });
const labDir = path.resolve('recovery/vpn-lab');
await fs.mkdir(labDir, { recursive: true });
let report;
try{
  const response=await fetch(subscription.url,{headers:{'user-agent':'v2rayN/6.0','accept':'text/plain,*/*;q=0.8'},signal:AbortSignal.timeout(20000)});
  const reader=response.body.getReader();const parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5*1024*1024){await reader.cancel();throw new Error('Response exceeds bound')};parts.push(value)}
  const bytes=Buffer.concat(parts);let content=bytes.toString('utf8');
  if(/^[A-Za-z0-9+/=_\s-]+$/.test(content))content=Buffer.from(content.replace(/\s/g,''),'base64').toString('utf8');
  const uris=content.match(/vless:\/\/[^\s<>"']+/g)||[];
  const servers=uris.map(uri=>{try{return new URL(uri).hostname}catch{return null}}).filter(Boolean);
  report={http:response.status,bytes:size,vlessNodes:uris.length,serverAddressesChanged:servers.length?servers.some(s=>!state.nodes.some(n=>n.server===s)):null};
  if(response.ok&&uris.length)await fs.writeFile(path.join(labDir, 'refreshed-subscription.txt'),content);
}catch(error){report={error:errorCode(error),message:safeErrorMessage(error,subscription.url)}}
await fs.writeFile(path.join(evidenceDir, 'subscription-refresh.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
