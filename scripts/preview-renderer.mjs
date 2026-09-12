import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL('C:/Users/Egoist/Desktop/EgoistCODEX AI/.local/workers/web/node_modules/playwright/index.mjs'));
const root = path.resolve('.vite/renderer/main_window');
const evidence = path.resolve('recovery/evidence/ui');
await fs.mkdir(evidence, { recursive: true });
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(evidence, 'dashboard.png'), fullPage: true });
  await fs.writeFile(path.join(evidence, 'dom.html'), await page.content());
  const screens = [];
  for (const [label, name] of [['Соединение','vpn'], ['DNS','dns'], ['Профили','zapret'], ['Telegram','telegram'], ['Настройки','settings']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.screen-stage').length === 1);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
    screens.push({ name, text: (await page.locator('body').innerText()).slice(0, 1500) });
  }
  await page.getByRole('button', { name: 'Главная', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.screen-stage').length === 1 && document.querySelector('.screen-stage')?.dataset.screen === 'dashboard');
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 1100, height: 740 });
  await page.screenshot({ path: path.join(evidence, 'dashboard-1100.png'), fullPage: true });
  await page.setViewportSize({ width: 700, height: 800 });
  await page.screenshot({ path: path.join(evidence, 'dashboard-700.png'), fullPage: true });
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ errors, screens }, null, 2));
  console.log(JSON.stringify({ errors, screens }));
} finally { await browser.close(); server.close(); }
