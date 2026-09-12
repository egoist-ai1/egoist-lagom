import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/recovered/renderer.js','utf8');
const functions=['Mm','Nm'].map(name=>{const start=source.indexOf('function '+name+'(');const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end)}).join('\n');
const context=vm.createContext({URL});
vm.runInContext('const zf={provider:"Gravityless DNS"};\n'+functions+'\nglobalThis.parse=Mm;',context);
test('DNS UI accepts provider paths outside dns-query',()=>{
 assert.equal(context.parse('https://dns.nextdns.io/example')?.dohUrl,'https://dns.nextdns.io/example');
});
test('DNS UI preserves required query parameters',()=>{
 assert.equal(context.parse('https://resolver.example/dns-query?profile=example')?.dohUrl,'https://resolver.example/dns-query?profile=example');
});
test('DNS UI rejects cleartext and embedded credentials',()=>{
 assert.equal(context.parse('http://resolver.example/dns-query'),null);
 assert.equal(context.parse('https://name:password@resolver.example/dns-query'),null);
});
