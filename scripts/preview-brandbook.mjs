import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { chromium } = await import(pathToFileURL('C:/Users/Egoist/Desktop/EgoistCODEX AI/.local/workers/web/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(path.resolve('docs/brandbook.html')).href);
  await page.locator('#power').click();
  if (await page.locator('#power').getAttribute('aria-pressed') !== 'true') throw new Error('Brand sample did not change state');
  await page.locator('#power').click();
  await page.screenshot({ path: 'recovery/evidence/ui/brandbook.png', fullPage: true });
  await page.setViewportSize({ width: 700, height: 900 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Brandbook overflows the narrow viewport');
  console.log('Brandbook: sample state, narrow layout and screenshot verified');
} finally { await browser.close(); }
