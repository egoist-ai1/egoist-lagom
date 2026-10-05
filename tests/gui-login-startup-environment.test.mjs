import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
const ps7=process.env.LAGOM_TEST_POWERSHELL7||process.env.LAGOM_TEST_POWERSHELL;
const ps5=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const source=path.resolve(process.env.LAGOM_TEST_ORDINARY_GUI_SOURCE||'tests/windows-ordinary-gui.cs');
const startup=path.resolve(process.env.LAGOM_TEST_GUI_STARTUP_SOURCE||'src/installer/gui-login-startup.ps1');
const fixture=path.resolve(process.env.LAGOM_TEST_GUI_ENVIRONMENT_FIXTURE||'tests/gui-login-startup-environment.ps1');
const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass'];
const stages=['startup:entry','startup:modules','startup:ast','startup:data-root','startup:program-files-root','startup:canonical-root','startup:json'];
const roots="$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::Error.WriteLine('startup:entry');"+
 "$management=[IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management','Microsoft.PowerShell.Management.psd1');"+
 "$utility=[IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1');"+
 "if(-not [IO.File]::Exists($management) -or -not [IO.File]::Exists($utility)){throw 'Trusted fixture module is unavailable.'};"+
 "Microsoft.PowerShell.Core\\Import-Module -Name $management -ErrorAction Stop;Microsoft.PowerShell.Core\\Import-Module -Name $utility -ErrorAction Stop;"+
 "[Console]::Error.WriteLine('startup:modules');$tokens=$null;$errors=$null;"+
 "$ast=[Management.Automation.Language.Parser]::ParseFile($env:FIXTURE_STARTUP_SOURCE,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Startup AST differs.'};"+
 "$names=@('Get-GuiStartupProgramFilesRoot','Get-GuiStartupCanonicalRoot','Get-GuiStartupDataRoot');"+
 "$functions=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $names -contains $n.Name},$false));"+
 "if($functions.Count -ne 3){throw 'Root function extraction differs.'};foreach($f in $functions){. ([ScriptBlock]::Create($f.Extent.Text))};"+
 "[Console]::Error.WriteLine('startup:ast');[Console]::Error.WriteLine('startup:data-root');$dataRoot=Get-GuiStartupDataRoot;"+
 "[Console]::Error.WriteLine('startup:program-files-root');$programFilesRoot=Get-GuiStartupProgramFilesRoot;"+
 "[Console]::Error.WriteLine('startup:canonical-root');$canonicalRoot=Get-GuiStartupCanonicalRoot;"+
 "$r=@{dataRoot=$dataRoot;programFilesRoot=$programFilesRoot;canonicalRoot=$canonicalRoot;"+
 "psEdition=[string]$PSVersionTable.PSEdition;startupEntryExecuted=$false;nativeTaskScmRegistryWrites=0};"+
 "$json=Microsoft.PowerShell.Utility\\ConvertTo-Json -InputObject $r -Compress;[Console]::Error.WriteLine('startup:json');[Console]::Out.WriteLine($json)";
for(const [shell,edition] of [[ps5,'Desktop'],[ps7,'Core']]){
 test(edition+' startup known-folder roots use the native GUI environment derived from its actual Windows root',{skip:process.platform!=='win32'},async()=>{
  assert.ok(ps7&&path.isAbsolute(ps7),'Absolute selected LAGOM_TEST_POWERSHELL or LAGOM_TEST_POWERSHELL7 required.');
  assert.ok((await fs.stat(ps7)).isFile(),'Selected PowerShell 7 executable must exist.');
  const base=process.env.LAGOM_TEST_TEMP;
  assert.ok(base&&path.isAbsolute(base),'Absolute caller-owned LAGOM_TEST_TEMP required.');
  assert.ok((await fs.stat(base)).isDirectory(),'Existing caller-owned LAGOM_TEST_TEMP required.');
  const dir=await fs.mkdtemp(path.join(base,'gui-system-drive-'));
  try{
   const compiled=await execute(ps7,[...args,'-File',fixture,'-HarnessPath',source,'-WorkDirectory',dir],{env:{...process.env,TEMP:dir,TMP:dir},windowsHide:true,timeout:20_000,maxBuffer:128*1024});
   assert.equal(compiled.stderr.trim(),'');const proof=JSON.parse(compiled.stdout);
   assert.equal(proof.psEdition,'Core');assert.equal(proof.rows.length,6);
   for(const row of proof.rows)assert.equal(row.passed,true,row.name);
   for(const key of ['nativeEnvironmentTokenCalls','nativeLaunches','settingsTaskScmRegistryWrites'])assert.equal(proof[key],0);
   assert.equal(proof.startupEntryExecuted,false);
   let child;const started=performance.now();
   try{child=await execute(shell,[...args,'-Command',roots],{env:{...proof.environment,FIXTURE_STARTUP_SOURCE:startup},windowsHide:true,timeout:15_000,maxBuffer:64*1024});}
   catch(error){error.startupProbe={edition,elapsedMs:Math.round(performance.now()-started),stages:String(error.stderr||'').split(/\r?\n/).filter(stage=>stages.includes(stage)).slice(0,stages.length)};throw error;}
   assert.deepEqual(child.stderr.trim().split(/\r?\n/),stages);const value=JSON.parse(child.stdout);
   assert.equal(value.psEdition,edition);assert.equal(value.dataRoot,path.join(proof.environment.ProgramData,'EgoistShield/GuiStartup'));
   assert.equal(value.canonicalRoot,path.join(value.programFilesRoot,'EgoistShield'));assert.equal(value.startupEntryExecuted,false);assert.equal(value.nativeTaskScmRegistryWrites,0);
  }finally{assert.equal(path.dirname(dir),path.resolve(base));await fs.rm(dir,{recursive:true,force:true});}
 });
}
