import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../src/recovered/electron/ipc/desktop-updater.js',import.meta.url),'utf8');
const context=vm.createContext({console,path,promises:fs,process,setTimeout,URL});
vm.runInContext(`${source}\nthis.DesktopUpdater=DesktopUpdater;this.UpdaterError=UpdaterError;`,context);
const {DesktopUpdater,UpdaterError}=context;

test('interrupted update download resumes automatically in the same action',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lagom-updater-retry-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const progress=[];
  const updater=new DesktopUpdater({currentVersion:'3.7.1',userDataDir:root,onProgress:value=>progress.push(value)});
  const partialPath=path.join(root,'updates','Egoist-Lagom-Setup.exe.partial');
  const candidate={version:'3.7.2',size:100};
  let attempts=0;
  updater.downloadCandidate=async()=>{
    attempts+=1;
    await fs.mkdir(path.dirname(partialPath),{recursive:true});
    await fs.writeFile(partialPath,Buffer.alloc(attempts*20));
    if(attempts<3)throw new UpdaterError('download-failed','Загрузка прервана.',true);
  };
  await updater.downloadCandidateWithRetry(candidate,partialPath);
  assert.equal(attempts,3);
  assert.deepEqual(progress.map(value=>value.percent),[20,40]);
  assert.ok(progress.every(value=>value.phase==='downloading'&&value.message.includes('Продолжаем загрузку')));
});

test('non-resumable update failure is not retried',async()=>{
  const updater=new DesktopUpdater({currentVersion:'3.7.1',userDataDir:'C:/unused'});
  let attempts=0;
  updater.downloadCandidate=async()=>{attempts+=1;throw new UpdaterError('signature-invalid','Подпись неверна.');};
  await assert.rejects(updater.downloadCandidateWithRetry({version:'3.7.2',size:100},'C:/unused/update.partial'),error=>error.code==='signature-invalid');
  assert.equal(attempts,1);
});
