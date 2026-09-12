import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const input = path.resolve(process.argv[2] || 'recovery/official-code');
const source = fs.readFileSync(path.join(input, '.vite/build/main.js'), 'utf8');
const regions = [...source.matchAll(/^\/\/#region (src\/[^\r\n]+)\r?$/gm)];
const index = [];
fs.mkdirSync('src/recovered', { recursive: true });
fs.writeFileSync('src/recovered/imports.js', source.slice(0, regions[0].index));
index.push('imports.js');
for (let i = 0; i < regions.length; i++) {
  const original = regions[i][1];
  const name = original.replace(/^src\//, '').replace(/\.ts$/, '.js');
  const output = path.join('src/recovered', name);
  const chunk = source.slice(regions[i].index, regions[i + 1]?.index ?? source.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, chunk);
  index.push(name);
}
fs.writeFileSync('src/recovered/order.json', JSON.stringify(index, null, 2) + '\n');
fs.copyFileSync(path.join(input, '.vite/build/preload.js'), 'src/recovered/preload.cjs');
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/recovery-provenance.json', JSON.stringify({
  recoveredFromVersion: '3.5.4',
  mainSha256: crypto.createHash('sha256').update(source).digest('hex'),
  modules: index.length - 1,
  limitation: 'Recovered emitted JavaScript shares one lexical scope; original TypeScript, types, comments removed by bundling and tests were not present.'
}, null, 2) + '\n');
console.log(JSON.stringify({ modules: index.length - 1 }));
