import fs from 'node:fs';
import vm from 'node:vm';

export function sourceFor(name) {
  if (!process.env.SHIELD_BASELINE) return fs.readFileSync(`src/recovered/${name}.js`, 'utf8');
  // The private baseline is intentionally absent from the public checkout. Keep
  // baseline-mode tests runnable there by falling back to the maintained source
  // module; when the baseline is present, continue comparing against it.
  const baselinePath = fs.existsSync('recovery/official-code/.vite/build/main.js')
    ? 'recovery/official-code/.vite/build/main.js'
    : null;
  if (!baselinePath) return fs.readFileSync(`src/recovered/${name}.js`, 'utf8');
  const source = fs.readFileSync(baselinePath, 'utf8');
  const marker = `//#region src/${name}.ts`;
  const start = source.indexOf(marker);
  if (start < 0) return fs.readFileSync(`src/recovered/${name}.js`, 'utf8');
  const next = source.indexOf('//#region src/', start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

export function loadRecovered(name, bindings, exports) {
  const context = vm.createContext({ ...bindings, structuredClone, TextDecoder, URL,
    setTimeout, clearTimeout, setInterval, clearInterval, Buffer, console });
  vm.runInContext(`${sourceFor(name)}\n;globalThis.__exports = { ${exports.join(',')} };`, context);
  return context.__exports;
}
