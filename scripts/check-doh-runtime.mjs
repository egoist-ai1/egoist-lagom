import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import dgram from 'node:dgram';
import net from 'node:net';
import { loadRecovered } from '../tests/load-recovered.mjs';

const evidence = process.argv[2];
if (!evidence || !path.isAbsolute(evidence)) throw new Error('Supply task-owned absolute evidence directory');
await fs.mkdir(evidence, { recursive: true });
const { isValidIpLiteral } = loadRecovered('shared/system-dns', {}, ['isValidIpLiteral']);
const { parseCustomDnsUrl } = loadRecovered('shared/secure-dns', { isValidIpLiteral }, ['parseCustomDnsUrl']);
const helpers = loadRecovered('shared/system-doh', { parseCustomDnsUrl }, ['buildXrayLocalDohServerUrl','parseSystemDohUrl']);
const { buildSystemDohXrayConfig } = loadRecovered('electron/ipc/system-doh-manager', helpers, ['buildSystemDohXrayConfig']);
const source = await fs.readFile('src/recovered/electron/ipc/state-store.js', 'utf8');
const url = process.env.SHIELD_TEST_DOH_URL || source.match(/https:\/\/de-prem\.aeternia\.space[^"\s]+/)?.[0];
if (!url) throw new Error('No configured endpoint');
const hostname = new URL(url).hostname;
const answer = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(10000)}).then(r=>r.json());
const ips = (answer.Answer || []).filter(r=>r.type===1).map(r=>r.data);
if (!ips.length) throw new Error('Encrypted bootstrap unavailable');
const listener=net.createServer();
await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;
await new Promise(resolve=>listener.close(resolve));
const config=buildSystemDohXrayConfig({url,localAddress:'127.0.0.1',localPort:port,bootstrapHosts:{[hostname]:ips},logPath:path.join(evidence,'xray.log')});
const configPath=path.join(evidence,'doh-config.private.json');
await fs.writeFile(configPath,config);
const binary=path.resolve('recovery/official-app/resources/runtime/xray/xray.exe');
const check=spawnSync(binary,['run','-test','-config',configPath],{windowsHide:true,encoding:'utf8'});
if(check.status!==0)throw new Error('Pinned Xray rejected configuration');
const report={version:spawnSync(binary,['version'],{windowsHide:true,encoding:'utf8'}).stdout.split('\n')[0],configValid:true,checks:[],limitations:['Loopback high port; host adapter DNS unchanged. Non-address DNS types are refused by this pinned Xray version.']};
function query(type){const header=Buffer.alloc(12);header.writeUInt16BE(4660);header.writeUInt16BE(256,2);header.writeUInt16BE(1,4);const parts='example.com'.split('.').flatMap(label=>[Buffer.from([label.length]),Buffer.from(label)]);const end=Buffer.alloc(5);end.writeUInt16BE(type,1);end.writeUInt16BE(1,3);return Buffer.concat([header,...parts,end]);}
function exchange(address,transport,type){return new Promise((resolve,reject)=>{
  const payload=query(type);let socket;let bytes=Buffer.alloc(0);
  const finish=(error,result)=>{clearTimeout(timer);if(transport==='udp')socket.close();else socket.destroy();error?reject(error):resolve(result)};
  const timer=setTimeout(()=>finish(new Error(`${address} ${transport} type ${type} timeout`)),12000);
  const validate=message=>{if(message.readUInt16BE(0)!==4660)return;const rcode=message.readUInt16BE(2)&15;const answers=message.readUInt16BE(6);if(type===16 ? rcode!==5 || answers!==0 : rcode!==0 || (type===1 && answers===0))finish(new Error(`Unexpected DNS response: ${rcode}/${answers}`));else finish(null,{address,transport,type,rcode,answers})};
  if(transport==='udp'){socket=dgram.createSocket(address.includes(':')?'udp6':'udp4');socket.once('error',finish);socket.once('message',validate);socket.send(payload,port,address)}
  else{socket=net.createConnection({host:address,port});socket.once('error',finish);socket.once('connect',()=>{const length=Buffer.alloc(2);length.writeUInt16BE(payload.length);socket.write(Buffer.concat([length,payload]))});socket.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);if(bytes.length>=2&&bytes.length>=2+bytes.readUInt16BE(0))validate(bytes.subarray(2))})}
})}
const child=spawn(binary,['run','-config',configPath],{windowsHide:true,stdio:'ignore'});
try{
  let ready=false;
  for(let attempt=0;attempt<20&&!ready;attempt++){try{await exchange('127.0.0.1','tcp',16);ready=true}catch{if(child.exitCode!==null)throw new Error('Xray exited');await new Promise(r=>setTimeout(r,150))}}
  if(!ready)throw new Error('Xray did not bind');
  for(const address of ['127.0.0.1','::1'])for(const transport of ['udp','tcp'])for(const type of [1,28,16])report.checks.push(await exchange(address,transport,type));
  report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1}
finally{const exited=once(child,'exit');child.kill();await exited;await fs.writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
