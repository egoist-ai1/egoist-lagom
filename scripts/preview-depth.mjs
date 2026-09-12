import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL('C:/Users/Egoist/Desktop/EgoistCODEX AI/.local/workers/web/node_modules/playwright/index.mjs'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1056, height: 1200 }, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL('C:/Users/Egoist/Projects/EgoistShield/recovery/evidence/ui/shield-depth-preview.html').href);
  const frame = page.frames()[1];
  const root = frame.locator('#shield-depth');
  await root.waitFor();
  await root.locator('.es-primary').click();
  await page.waitForTimeout(850);
  if (await root.locator('.es-primary').getAttribute('aria-pressed') !== 'true') throw new Error('Power state failed');
  await root.getByRole('switch').first().click();
  if (await root.getByRole('switch').first().getAttribute('aria-checked') !== 'true') throw new Error('Switch failed');
  await root.locator('.es-primary').click();
  await page.waitForTimeout(850);
  await root.getByRole('switch').first().click();
  for (const width of [1056,768,392]) {
    await page.setViewportSize({ width, height: 1800 });
    if (await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Overflow at '+width);
    await root.screenshot({ path: `recovery/evidence/ui/shield-depth-${width}.png` });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await fs.writeFile('recovery/evidence/ui/shield-depth-qa.json', JSON.stringify({ errors, widths:[1024,736,360], interactions:['connect','disconnect','switch on/off'], passed:true },null,2));
  console.log('Depth preview: connection transition, switches, 1024/736/360 layouts verified');
} finally { await browser.close(); }
