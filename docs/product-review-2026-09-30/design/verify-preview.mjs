import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.LAGOM_PLAYWRIGHT_MODULE || 'playwright');
const project=path.resolve(import.meta.dirname,'../../..');
const ownWork=process.env.LAGOM_DESIGN_WORK_DIR; if(!ownWork)throw new Error('Set LAGOM_DESIGN_WORK_DIR to your own task work directory.');
const design=path.join(project,'docs/product-review-2026-09-30/design');
const screenshots=path.join(design,'screenshots');
const allScreens=['overview','connection','dns','profiles','telegram','settings','mini','closed','states'];
const selectedScreens=process.env.LAGOM_DESIGN_SCREENS?.split(',').filter(Boolean)??allScreens;
if(selectedScreens.some(screen=>!allScreens.includes(screen)))throw new Error('Unknown selected proposal screen.');
const previousReceipt=selectedScreens.length===allScreens.length?null:JSON.parse(await fs.readFile(path.join(design,'validation.json'),'utf8'));
await fs.mkdir(screenshots,{recursive:true});
process.env.TEMP=ownWork;process.env.TMP=ownWork;
const baselineCSSFiles=['src/recovered/renderer.css','src/brand/tokens.css','src/brand/compact-ruby.css','src/brand/compact-surfaces.css','src/brand/shield-widget.css','src/brand/final-polish.css'];
const counts=[];for(const name of baselineCSSFiles){const css=await fs.readFile(path.join(project,name),'utf8');counts.push({file:name,bytes:Buffer.byteLength(css),importantCount:(css.match(/!important/g)||[]).length});}
const lum=h=>{const s=h.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return s[0]*.2126+s[1]*.7152+s[2]*.0722;};
const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
const colorPairs=[['current DNS labels','#71717a','#0d0e12',4.5],['current dim on panel','#92939b','#0d0e12',4.5],['current control-line on raised','#63646e','#14151b',3],['proposal ink on panel','#f5f5f5','#121212',4.5],['proposal muted on panel','#b8b8b8','#121212',4.5],['proposal dim on raised','#a0a0a0','#1b1b1b',4.5],['proposal control-line on raised','#737373','#1b1b1b',3],['proposal action ink','#090909','#f5f5f5',4.5]].map(([name,fg,bg,min])=>({name,fg,bg,min,ratio:contrast(fg,bg),pass:contrast(fg,bg)>=min}));
const css=await fs.readFile(path.join(design,'tokens-proposal.css'),'utf8');const defs=new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
const style=await fs.readFile(path.join(design,'preview.css'),'utf8');const missing=[...new Set([...style.matchAll(/var\((--[\w-]+)/g)].map(m=>m[1]))].filter(name=>!defs.has(name));
if(missing.length)throw new Error('Undefined tokens: '+missing.join(', '));
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1360,height:900}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
let remoteRequests=0;await page.route(/^https?:\/\//,route=>{remoteRequests++;return route.abort();});
const previews=[];
try{
  await page.goto(pathToFileURL(path.join(design,'preview.html')).href);
  await page.evaluate(()=>document.fonts.ready);
  for(const [label,width,height] of [['wide',1360,900],['minimum',1000,680],['zoom200-equivalent',680,450],['minimum-zoom200-equivalent',500,340]]){
    await page.setViewportSize({width,height});
    for(const screen of selectedScreens){
      await page.evaluate(name=>navigate(name),screen);
      const data=await page.evaluate(()=>{
        const stage=document.getElementById('stage');stage.scrollTop=stage.scrollHeight;
        const controls=[...stage.querySelectorAll('button,input,select,textarea,summary')].filter(el=>{
          const rect=el.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return false;
          for(let ancestor=el.parentElement;ancestor&&ancestor!==stage;ancestor=ancestor.parentElement){if(ancestor.tagName==='DETAILS'&&!ancestor.open&&!ancestor.querySelector(':scope>summary')?.contains(el))return false;}
          return true;
        });
        return {documentOverflow:document.documentElement.scrollWidth-innerWidth,stageOverflow:stage.scrollWidth-stage.clientWidth,stageHeight:stage.clientHeight,scrollHeight:stage.scrollHeight,controls:controls.length,fontStatus:document.fonts.status,fontFamily:getComputedStyle(stage).fontFamily,lastVisibleControl:controls.at(-1)?.getBoundingClientRect().toJSON()??null,miniBox:stage.querySelector('.mini-preview')?.getBoundingClientRect().toJSON()??null};
      });
      if(data.documentOverflow>0||data.stageOverflow>0)throw new Error(`Overflow ${label}/${screen}: ${JSON.stringify(data)}`);
      if(data.lastVisibleControl&&data.lastVisibleControl.bottom>height+.5)throw new Error(`Visible control unreachable ${label}/${screen}: ${JSON.stringify(data)}`);
      previews.push({label,screen,width,height,...data});
      if(label==='minimum-zoom200-equivalent'&&screen==='mini')await page.screenshot({path:path.join(screenshots,`${label}-${screen}.png`),fullPage:false});
      await page.evaluate(()=>{document.getElementById('stage').scrollTop=0;});
      if((label==='wide'&&['overview','dns','settings','mini'].includes(screen))||(label==='minimum-zoom200-equivalent'&&screen==='settings'))await page.screenshot({path:path.join(screenshots,`${label}-${screen}.png`),fullPage:false});
    }
  }
  await page.setViewportSize({width:1360,height:900});await page.evaluate(()=>navigate('profiles'));
  await page.getByRole('tab',{name:'История',exact:true}).focus();await page.keyboard.press('ArrowRight');
  const tabsPass=await page.getByRole('tab',{name:'Правила',exact:true}).getAttribute('aria-selected')==='true';
  await page.evaluate(()=>navigate('overview'));await page.getByRole('button',{name:'Подключить щит',exact:true}).click();
  const demoPass=(await page.locator('#preview-feedback').textContent()).includes('не выполнялось');
  const matrix=previousReceipt?[...previousReceipt.matrix.filter(row=>!selectedScreens.includes(row.screen)),...previews]:previews;
  const receipt={schema:1,status:'proposal-only',baselineCommit:'199236e3b227f9885c2beef64faffbe9e9a35583',runtimeUnchanged:true,method:'own headless Chromium; standalone inert HTML; CSS viewport equivalents do not certify native Electron zoom',matrix,latestRound:{screens:selectedScreens,cases:previews.length,note:previousReceipt?'Only selected changed templates rechecked; unchanged rows retained from prior full proposal run.':'All proposal pages checked.'},colorPairs,tokenCount:defs.size,undefinedTokens:missing,compiledCSSInventory:counts,pageErrors:errors,remoteRequests,tabKeyboardPass:tabsPass,demoActionsRemainInert:demoPass,reducedMotion:{sourceRulePresent:style.includes('@media(prefers-reduced-motion:reduce)'),nativePreferenceChangeTested:false}};
  await fs.writeFile(path.join(design,'validation.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({matrix:previews.length,colorPairs,tokenCount:defs.size,compiledCSSInventory:counts,pageErrors:errors,remoteRequests,tabKeyboardPass:tabsPass,demoActionsRemainInert:demoPass}));
}finally{await context.close();await browser.close();}
