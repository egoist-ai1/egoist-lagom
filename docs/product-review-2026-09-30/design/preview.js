'use strict';
// This document has no preload, IPC, service API, fetch, telemetry or OS actions.
// It can only navigate local design templates and acknowledge inert demo buttons.
const stage=document.getElementById('stage');
const feedback=document.getElementById('preview-feedback');
let feedbackTimer;
function navigate(name,{focus=false}={}){
  const template=document.getElementById(name);
  if(!(template instanceof HTMLTemplateElement))return;
  stage.replaceChildren(template.content.cloneNode(true));
  stage.scrollTop=0;
  document.querySelectorAll('.sidebar button[data-screen]').forEach(button=>{
    if(button.dataset.screen===name)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
    button.setAttribute('aria-label',button.textContent.replace(/^[^\p{L}]+/u,'').trim());
  });
  if(focus)stage.focus({preventScroll:true});
  document.title=`Egoist Lagom — ${stage.querySelector('h1')?.textContent??name} — макет`;
}
function chooseTab(button){
  const tabs=[...button.closest('[role=tablist]').querySelectorAll('[role=tab]')];
  for(const tab of tabs){const active=tab===button;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;document.getElementById(tab.getAttribute('aria-controls')).hidden=!active;}
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.screen)navigate(button.dataset.screen,{focus:true});
  else if(button.hasAttribute('data-demo')){
    clearTimeout(feedbackTimer);
    feedback.textContent=`Макет: «${button.dataset.demo}» не выполнялось. Службы, сеть и приложение не изменены.`;
    feedbackTimer=setTimeout(()=>{feedback.textContent='';},6000);
  }else if(button.getAttribute('role')==='tab')chooseTab(button);
});
document.addEventListener('keydown',event=>{
  const button=event.target.closest('[role=tab]');if(!button)return;
  const tabs=[...button.closest('[role=tablist]').querySelectorAll('[role=tab]')];
  const index=tabs.indexOf(button);
  const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index-1+tabs.length)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
  if(next===null)return;event.preventDefault();chooseTab(tabs[next]);tabs[next].focus();
});
navigate('overview');
