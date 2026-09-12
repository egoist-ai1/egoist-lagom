import fs from 'node:fs/promises';
const file = 'src/recovered/renderer.js';
let source = await fs.readFile(file, 'utf8');
const original = 'className: `power-zone dashboard-connect`, children: [';
const replacement = original + '(0, V.jsxs)(`h2`, {className: `connection-heading`, children: [`Ваша сеть.`, (0, V.jsx)(`br`, {}), (0, V.jsx)(`span`, {children: `Под вашим контролем.`})]}), ';
if (!source.includes('connection-heading')) {
  if (source.split(original).length !== 2) throw new Error('Expected one connection panel');
  source = source.replace(original, replacement);
}
source = source.replaceAll('3.5.4', '3.7.0');
await fs.writeFile(file, source);
