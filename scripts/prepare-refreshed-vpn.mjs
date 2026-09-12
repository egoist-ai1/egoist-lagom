import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {loadRecovered} from '../tests/load-recovered.mjs';
const {parseVless}=loadRecovered('electron/ipc/parsers/uri-parsers',{buildNode:(protocol,name,server,port,uri,metadata)=>({id:randomUUID(),protocol,name,server,port,uri,metadata})},['parseVless']);
const text=await fs.readFile('recovery/vpn-lab/refreshed-subscription.txt','utf8');
const nodes=(text.match(/vless:\/\/[^\s<>"']+/g)||[]).map(uri=>parseVless(uri)).filter(Boolean);
if(!nodes.length)throw new Error('No refreshed VLESS nodes');
await fs.writeFile('recovery/vpn-lab/refreshed-state.json',JSON.stringify({nodes,activeNodeId:nodes[0].id}));
console.log(JSON.stringify({nodes:nodes.length,transports:[...new Set(nodes.map(n=>n.metadata.type))]}));
