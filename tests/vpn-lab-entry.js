if(!['SHIELD-LAB','SHIELD-UD5I7VUH'].includes(process.env.COMPUTERNAME))throw new Error('Disposable Shield guest required');
if(process.env.EGOISTSHIELD_MOCK_RUNTIME)throw new Error('Mock runtimes are forbidden in this test');
const labEvidence=[];
const labRoot='C:/ShieldLab/vpn-data';
const labResources='C:/Program Files/EgoistShield/resources';
process.resourcesPath=labResources;
const labRuntime=new VpnRuntimeManager(labResources,labRoot);
const labState=new StateStore(labRoot);
const labCore=new CoreServiceClient();
const labZapret=useComponentService(new ZapretManager(labResources,path.join(labResources,'app.asar'),labRoot), 'Zapret',labCore);
configureSystemProxyOwnershipState(labRoot);
async function runVpnLab(){
  await promises.mkdir(labRoot,{recursive:true});
  await labState.load();
  const node=JSON.parse(await promises.readFile('C:/ShieldLab/vpn-node.json','utf8'));
  await labState.patch({nodes:[node],activeNodeId:node.id,settings:{...DEFAULT_STATE.settings,notifications:false,reconnectOnDrop:false}});
  registerVpnHandlers({stateStore:labState,runtimeManager:labRuntime,zapretManager:labZapret,networkCombinatorManager:null,window:null});
  for(const tun of [false,true]){
    const started=Date.now();
    const evidence={mode:tun?'tun':'proxy',ok:false};
    await labState.patch({settings:{...labState.get().settings,useTunMode:tun}});
    await promises.writeFile('C:/ShieldLab/vpn-progress.json',JSON.stringify({current:evidence.mode,evidence:labEvidence}));
    try{
      const status=await labHandlers.get('vpn:connect')(null,node.id);
      evidence.connected=status.connected;
      evidence.egressVerified=status.egressVerified;
      evidence.isMock=status.isMock;
      evidence.isAdmin=status.isAdmin;
      evidence.runtimeKind=status.runtimeKind;
      evidence.connectMs=Date.now()-started;
      if(!status.connected||!status.egressVerified||status.isMock)throw new Error(status.lastError||'Real external VPN route was not verified');
      const diagnostic=await labHandlers.get('vpn:diagnose')();
      evidence.diagnosticOk=diagnostic.ok;
      evidence.ok=Boolean(diagnostic.ok);
      if(tun&&evidence.ok){
        const direct=await globalThis.fetch('https://api.ipify.org?format=json',{signal:AbortSignal.timeout(30000)});
        if(!direct.ok)throw new Error('Direct TUN egress returned HTTP '+direct.status);
        const directIp=(await direct.json()).ip;
        evidence.directTunEgressMatches=Boolean(directIp&&directIp===status.egressIp);
        if(!evidence.directTunEgressMatches)throw new Error('Direct TUN route did not match the verified upstream');
        const routeTarget=await (await import('node:dns/promises')).lookup('api.ipify.org',{family:4});
        if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(routeTarget.address))throw new Error('TUN route target is invalid');
        const route=await execFileAsync$2(resolveWindowsExecutable('powershell.exe'),['-NoProfile','-NonInteractive','-Command',`(Find-NetRoute -RemoteIPAddress '${routeTarget.address}').InterfaceAlias | ConvertTo-Json -Compress`],{windowsHide:true,timeout:120000});
        const aliases=JSON.parse(route.stdout.trim());
        evidence.systemRouteUsesTun=(Array.isArray(aliases)?aliases:[aliases]).includes('egoist-tun');
        if(!evidence.systemRouteUsesTun)throw new Error('Windows route to the HTTPS probe does not use the TUN adapter');
        const reconnect=await labHandlers.get('vpn:connect')(null,node.id);
        evidence.tunReconnected=Boolean(reconnect.connected&&reconnect.egressVerified&&!reconnect.isMock);
        if(!evidence.tunReconnected)throw new Error(reconnect.lastError||'TUN reconnect failed');
      }
    }catch(error){evidence.ok=false;evidence.error=redactDiagnosticText(error.message)}
    finally{
      try{evidence.disconnected=!(await labHandlers.get('vpn:disconnect')()).connected}catch(error){evidence.disconnectError=redactDiagnosticText(error.message)}
      evidence.ok=Boolean(evidence.ok&&evidence.disconnected);
      evidence.ms=Date.now()-started;
      labEvidence.push(evidence);
      await promises.writeFile('C:/ShieldLab/vpn-results.json',JSON.stringify(labEvidence,null,2));
      console.log(JSON.stringify(evidence));
    }
  }
}
runVpnLab().catch(error=>{console.error(redactDiagnosticText(error.message));labEvidence.push({ok:false,error:'VPN harness initialization failed'})}).finally(async()=>{
  await labRuntime.disconnect().catch(()=>{});
  app.emit('before-quit');
  await promises.rm('C:/ShieldLab/vpn-node.json',{force:true});
  for(const name of ['egoistshield-state.json','egoistshield-state.json.bak'])await promises.rm(path.join(labRoot,name),{force:true});
  process.exit(labEvidence.length===2&&labEvidence.every(row=>row.ok)?0:1);
});
