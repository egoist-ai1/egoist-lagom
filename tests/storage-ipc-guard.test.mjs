import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {loadRecovered} from './load-recovered.mjs';
function fixture() {
  const calls=[],handlers=new Map();let writable=false,barriers=0;
  const ipc=loadRecovered('electron/ipc/trusted-ipc', {path:path.win32,logger:{warn(){}},
    session:{defaultSession:{setPermissionRequestHandler(){}}}},
    ['configureTrustedIpcPolicy','installWindowSecurityGuards','installIpcMainGuard']);
  const mainFrame={url:'file:///C:/Installed/renderer/index.html'};
  const webContents={mainFrame,on(){},setWindowOpenHandler(){},getURL:()=>mainFrame.url};
  const event={sender:webContents,senderFrame:mainFrame};
  ipc.configureTrustedIpcPolicy({packagedRendererRoot:String.raw`C:\Installed\renderer`,assertMutationAllowed:async()=>{
    barriers++;if(!writable)throw Object.assign(new Error('Storage denied'),{code:'STATE_STORAGE_UNAVAILABLE'});
  }});
  ipc.installWindowSecurityGuards({webContents});
  const ipcMain={handle:(channel,listener)=>handlers.set(channel,listener)};ipc.installIpcMainGuard(ipcMain);
  return {calls,event,handlers,ipcMain,ready(){writable=true;},get barriers(){return barriers;},
    register(channel){ipcMain.handle(channel,async(_event,value)=>{calls.push(channel);return value??'inspection';});},
    invoke(channel,ev=event){return handlers.get(channel)(ev);}};
}
test('storage denial stops native IPC handlers and unknown future mutations before execution',async()=>{
  const f=fixture();
  for(const channel of ['system:set-dns','system-doh:apply','zapret:start','telegram-proxy:save-config','vpn:connect','future:mutation']){
    f.register(channel);await assert.rejects(f.invoke(channel),{code:'STATE_STORAGE_UNAVAILABLE'});
  }
  assert.deepEqual(f.calls,[]);assert.equal(f.barriers,6);
  f.ready();await f.invoke('system:set-dns');assert.deepEqual(f.calls,['system:set-dns']);
});
test('readonly inspection, retry, navigation and cancellation remain accessible',async()=>{
  const f=fixture();
  const channels=['state:get','state:get-snapshot','state:retry-load','diagnostics:export-bundle','vpn:status','shield:status','window:set-widget-mode','shield:cancel'];
  for(const channel of channels){f.register(channel);assert.equal(await f.invoke(channel),'inspection');}
  assert.deepEqual(f.calls,channels);assert.equal(f.barriers,0);
});
test('state commits retain their structured result path and still require a trusted sender',async()=>{
  const f=fixture();f.register('state:patch-settings');await f.invoke('state:patch-settings');
  assert.equal(f.barriers,0);
  await assert.rejects(f.invoke('state:patch-settings',{...f.event,senderFrame:{url:f.event.senderFrame.url}}),/Untrusted/);
  assert.deepEqual(f.calls,['state:patch-settings']);
});
