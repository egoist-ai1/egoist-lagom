import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL('C:/Users/Egoist/Desktop/EgoistCODEX AI/.local/workers/web/node_modules/playwright/index.mjs'));
const browser=await chromium.launch({headless:true});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1488,height:1074},colorScheme:'dark',reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4175/');
 await page.locator('.hero-art').waitFor();
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:'recovery/evidence/ui/obsidian-1488.png',fullPage:true});
 await page.getByRole('button',{name:'Подключить',exact:true}).click();
 await page.getByRole('button',{name:'Отключить',exact:true}).waitFor();
 await page.getByRole('button',{name:'Отключить',exact:true}).click();
 await page.getByRole('button',{name:'Подключить',exact:true}).waitFor();
 await page.getByRole('switch',{name:'DNS',exact:true}).click();
 if(await page.getByRole('switch',{name:'DNS',exact:true}).getAttribute('aria-checked')!=='true')throw Error('DNS switch failed');
 await page.getByRole('switch',{name:'DNS',exact:true}).click();
 await page.locator('.server-picker').click();
 await page.getByRole('button',{name:/Германия/}).click();
 if(!(await page.locator('.server-picker').innerText()).includes('Германия'))throw Error('Server selection failed');
 for(const tab of ['Соединение','DNS','Профили','Telegram']){await page.locator('nav').getByRole('button',{name:tab,exact:true}).click();await page.screenshot({path:'recovery/evidence/ui/obsidian-'+({'Соединение':'vpn','DNS':'dns','Профили':'zapret','Telegram':'telegram'})[tab]+'.png',fullPage:true})}
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByRole('switch',{name:'Анимация интерфейса'}).click();
 await page.screenshot({path:'recovery/evidence/ui/obsidian-settings.png',fullPage:true});
 await page.locator('nav').getByRole('button',{name:'Обзор',exact:true}).click();
 for(const width of [1024,768,390]){await page.setViewportSize({width,height:1200});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Overflow at '+width);await page.screenshot({path:'recovery/evidence/ui/obsidian-'+width+'.png',fullPage:true})}
 if(errors.length)throw Error(errors.join('\n'));
 await fs.writeFile('recovery/evidence/ui/obsidian-checks.json',JSON.stringify({passed:true,errors,viewports:[1488,1024,768,390],interactions:['connect','disconnect','DNS on/off','server selection','five navigation tabs','settings animation']},null,2));
 console.log('Prototype interactions and responsive layouts passed');
}finally{await browser.close()}
