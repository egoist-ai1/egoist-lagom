import fs from 'node:fs/promises';
import path from 'node:path';
import { build, transform } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const order = JSON.parse(await fs.readFile('src/recovered/order.json', 'utf8'));
const modules = await Promise.all(order.map(name => fs.readFile(`src/recovered/${name}`, 'utf8')));
const protocol = await fs.readFile('src/component-protocol.js', 'utf8');
const componentResponse = (await fs.readFile('src/component-response.js', 'utf8')).replace('export function compactAutoSelectResult', 'function compactAutoSelectResult');
const facade = await fs.readFile('src/component-facade.js', 'utf8');
const esmRequireBanner = "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);";
await fs.rm('.vite/build', { recursive: true, force: true });
await fs.rm('.vite/renderer', { recursive: true, force: true });
await fs.mkdir('.vite/build', { recursive: true });
const main = "import { ShieldConnectionController } from './src/shield-connection-controller.js';\n" + modules.slice(0, -1).join('\n') + '\n' + protocol + '\n' + facade + '\n' + modules.at(-1);
await build({ stdin: { contents: main, resolveDir: root, sourcefile: 'recovered-main.js' }, outfile: '.vite/build/main.js', platform: 'node', format: 'esm', target: 'node22', bundle: true, external: ['electron', 'electron-log'], banner: { js: esmRequireBanner }, sourcemap: true });
await fs.copyFile('src/recovered/preload.cjs', '.vite/build/preload.js');
const rendererSeed = await fs.access('recovery/official-code/.vite/renderer').then(() => 'recovery/official-code/.vite/renderer').catch(() => 'public-ui');
await fs.cp(rendererSeed, '.vite/renderer', { recursive: true });
await fs.copyFile('src/recovered/renderer.css', '.vite/renderer/main_window/assets/index-Bxx3j0wf.css');
let rendererSource = await fs.readFile('src/recovered/renderer.js', 'utf8');
const glyphs = {};
for (const name of (await fs.readdir('src/brand/icons')).filter(name => name.endsWith('.svg'))) {
  const svg = await fs.readFile(`src/brand/icons/${name}`, 'utf8');
  const body = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  if (!body) throw new Error(`Invalid icon SVG: ${name}`);
  const shapes = [...body.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\s*\/>/g)];
  if (!shapes.length || body.replace(/<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*?\s*\/>/g, '').trim()) throw new Error(`Icon must contain only static shapes: ${name}`);
  glyphs[name.slice(0, -4)] = shapes.map(([, tag, raw]) => {
    const attributes = {};
    for (const [, key, value] of raw.matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (!/^(d|cx|cy|r|rx|ry|x|y|x1|x2|y1|y2|width|height|points|fill|fill-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|clip-rule)$/.test(key)) throw new Error(`Unsupported icon attribute: ${name}/${key}`);
      attributes[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    return [tag, attributes];
  });
}
const compactRuby = (await transform(`const rubyGlyphs=${JSON.stringify(glyphs)};\n` + await fs.readFile('src/brand/ShieldWidget.jsx', 'utf8') + '\n' + await fs.readFile('src/brand/CompactRuby.jsx', 'utf8'), {loader:'jsx', jsxFactory:'O.createElement', jsxFragment:'O.Fragment', charset:'utf8'})).code;
for (const name of ['sp','cp','lp','ap']) {
  const start = rendererSource.indexOf(`function ${name}(`);
  const end = rendererSource.indexOf('\nfunction ',start+1);
  if(start<0||end<0)throw new Error(`Recovered renderer boundary missing: ${name}`);
  rendererSource=rendererSource.slice(0,start)+rendererSource.slice(end+1);
}
rendererSource=rendererSource.replace('function op(',compactRuby+'\nfunction op(');
const legacyIconStart = rendererSource.indexOf('J = (e2, t2) => {');
const legacyIconEnd = rendererSource.indexOf('}, Y = J(', legacyIconStart);
if (legacyIconStart < 0 || legacyIconEnd < 0) throw new Error('Recovered icon factory boundary missing');
rendererSource = rendererSource.slice(0, legacyIconStart) + `J = (name) => { const Icon = O.forwardRef((props, ref) => O.createElement(RubyIcon, {...props, forwardedRef: ref, name: rubyLegacyIconNames[name], className: od('lucide', 'lucide-'+name, props.className)})); Icon.displayName = name; return Icon; ` + rendererSource.slice(legacyIconEnd);
rendererSource = rendererSource.replaceAll('V.jsx)(`button`,', 'V.jsx)(RubyButton,').replaceAll('V.jsxs)(`button`,', 'V.jsxs)(RubyButton,');
const screenMotionStart = rendererSource.indexOf('Ef = { enter:');
const screenMotionEnd = rendererSource.indexOf(', Df = ', screenMotionStart);
if (screenMotionStart < 0 || screenMotionEnd < 0) throw new Error('Recovered screen animation boundary missing');
rendererSource = rendererSource.slice(0, screenMotionStart) + `Ef = {enter:{opacity:0},idle:{opacity:1,transition:{duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:0.12,ease:wf}},leave:{opacity:0,transition:{duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:0.06,ease:Tf}}}` + rendererSource.slice(screenMotionEnd);
const panelMotionStart = rendererSource.indexOf(', Df = ', screenMotionStart);
const panelMotionEnd = rendererSource.indexOf(', Of = ', panelMotionStart);
if (panelMotionStart < 0 || panelMotionEnd < 0) throw new Error('Recovered panel animation boundary missing');
rendererSource = rendererSource.slice(0, panelMotionStart) + ', Df = Ef' + rendererSource.slice(panelMotionEnd);
rendererSource = rendererSource.replace('initial: false, mode: `sync`, children: (0, V.jsx)(td.section', 'initial: false, mode: `wait`, children: (0, V.jsx)(td.section');
const qfRegex = /function qf\(e2\)\s*\{[\s\S]*?\r?\n\}/;
if (!qfRegex.test(rendererSource)) throw new Error('qf function boundary missing');
rendererSource = rendererSource.replace(qfRegex, `function qf(e2) {
  let t2 = Array.isArray(e2?.results) ? e2.results : Array.isArray(e2?.testResults) ? e2.testResults : [];
  return t2.length > 0;
}`);
const packageVersion = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
const rendererVersionPattern = /, Qf = `\d+\.\d+\.\d+`, \$f =/;
if (!rendererVersionPattern.test(rendererSource)) throw new Error('Renderer fallback version boundary missing');
rendererSource = rendererSource.replace(rendererVersionPattern, `, Qf = \`${packageVersion}\`, $f =`);
rendererSource=rendererSource.replaceAll('3.5.4',packageVersion);
rendererSource = rendererSource.replace('Версия приложения ${t3}', 'Версия приложения Lagom');
rendererSource = rendererSource.replace('className: `app-version`, children: [`Версия приложения `, e2]', 'className: `app-version`, children: [`Версия Lagom`]');
await fs.writeFile('.vite/renderer/main_window/assets/index-Eaqlb9_F.js', (await transform(rendererSource, { loader: 'js', minify: true, charset: 'utf8' })).code);
const branding = (await Promise.all(['tokens.css','compact-ruby.css','compact-surfaces.css','shield-widget.css','final-polish.css'].map(name=>fs.readFile(`src/brand/${name}`, 'utf8')))).join('\n');
await fs.writeFile('.vite/renderer/main_window/assets/brand.css', branding);
await fs.cp('src/brand/icons','.vite/renderer/main_window/assets/icons',{recursive:true});
await fs.mkdir('.vite/renderer/main_window/assets/fonts', { recursive: true });
for (const subset of ['latin', 'cyrillic', 'cyrillic-ext']) await fs.copyFile(`node_modules/@fontsource-variable/unbounded/files/unbounded-${subset}-wght-normal.woff2`, `.vite/renderer/main_window/assets/fonts/unbounded-${subset}.woff2`);
await fs.copyFile('node_modules/@fontsource-variable/unbounded/LICENSE', '.vite/renderer/main_window/assets/fonts/Unbounded-OFL.txt');
await fs.mkdir('recovery/official-app/resources/installer', { recursive: true });
await fs.copyFile('scratch/Unbounded.ttf', 'recovery/official-app/resources/installer/Unbounded.ttf');
await build({ stdin: { contents: "export { gsap } from 'gsap';", resolveDir: root }, outfile: '.vite/renderer/main_window/assets/shield-motion.js', platform: 'browser', format: 'iife', globalName: 'ShieldMotion', bundle: true, minify: true });
const rendererHtml = '.vite/renderer/main_window/index.html';
await fs.writeFile(rendererHtml, (await fs.readFile(rendererHtml, 'utf8')).replace(/<title>.*?<\/title>/, '<title>Egoist Lagom</title>').replace(/<link[^>]+href="\.\/assets\/brand\.css"[^>]*>\s*/g, '').replace(/<script[^>]+src="\.\/assets\/shield-motion\.js"[^>]*><\/script>\s*/g, '').replace('</head>', '<link rel="stylesheet" href="./assets/brand.css">\n<script src="./assets/shield-motion.js"></script>\n  </head>'));

const electronStub = `const app = { isPackaged: true, getPath: () => { throw new Error('Desktop path unavailable in Core worker'); } }; const shell = { openExternal: () => { throw new Error('Desktop action unavailable in Core worker'); }, showItemInFolder: () => { throw new Error('Desktop action unavailable in Core worker'); } }; const ipcMain = {};`;
const logStub = `const log = { hooks: [], transports: { file: {}, console: {} } }; for (const level of ['info','warn','error','debug']) log[level] = (...data) => { let message = { data }; for (const hook of log.hooks) message = hook(message); process.stderr.write(JSON.stringify({level,data:message.data})+'\\n'); };`;
const workerModules = modules.slice(0, -1);
workerModules[0] = workerModules[0].replace(/^import .* from "electron";$/m, electronStub).replace(/^import log from "electron-log";$/m, logStub);
for (let i = 0; i < workerModules.length; i++) workerModules[i] = workerModules[i].replaceAll('path.dirname(fileURLToPath(import.meta.url))', '__dirname');
await build({ stdin: { contents: workerModules.join('\n') + '\n' + protocol + '\n' + componentResponse + '\n' + await fs.readFile('src/component-worker-entry.js', 'utf8'), resolveDir: root, sourcefile: 'component-worker.js' }, outfile: '.vite/build/component-worker.cjs', platform: 'node', format: 'cjs', target: 'node22', bundle: true });
console.log('Built desktop main, preload, recovered renderer and component worker.');
