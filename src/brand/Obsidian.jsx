// Compiled into the recovered renderer with its React, icons, actions and result panels.
const ShieldInfoIcon=dd, ShieldDownloadIcon=md, ShieldGaugeIcon=_d, ShieldCheckIcon=ud, ShieldGlobeIcon=hd, ShieldOffIcon=jd, ShieldSpeedPanel=up, ShieldProtectionPanel=bp;
function ShieldArrow(){return <img className="shield-ui-icon" src="./assets/arrow-right.svg" alt=""/>}
function ShieldChevron(){return <img className="shield-ui-icon" src="./assets/caret-down.svg" alt=""/>}
function sp({activeScreen,onAppInfo,onNavigate,snapshot}) {
  const windowApi=window.egoistAPI?.window;
  return <header className="shield-header">
    <button className="shield-brand" onClick={()=>onNavigate('dashboard')} aria-label="Egoist Lagom: обзор"><img src={Yd} alt=""/><span>EGOIST LAGOM</span></button>
    <nav className="shield-nav" aria-label="Основная навигация">{Cf.filter(item=>item.id!=='settings').map(item=><button key={item.id} aria-current={item.id===activeScreen?'page':undefined} aria-label={item.label} className={item.id===activeScreen?'active':''} onClick={()=>onNavigate(item.id)}>{item.id==='dashboard'?'Обзор':item.label}</button>)}</nav>
    <div className="shield-tools"><button aria-label="Настройки" title="Настройки" onClick={()=>onNavigate('settings')}><Od size={22} strokeWidth={1.4}/></button><button aria-label="О приложении" title="О приложении" onClick={onAppInfo}><ShieldInfoIcon size={19} strokeWidth={1.4}/></button></div>
    <div className="window-controls"><button aria-label="Свернуть" onClick={()=>windowApi?.minimize?.()}><Cd size={14}/></button><button aria-label="Развернуть" onClick={()=>windowApi?.toggleMaximize?.()}><Sd size={13}/></button><button aria-label="Закрыть" onClick={()=>windowApi?.close?.()}><Id size={14}/></button></div>
  </header>
}
function cp({activeScreen}) {
  if(activeScreen==='dashboard') return null;
  return <header className="shield-page-title"><h1>{Cf.find(item=>item.id===activeScreen)?.label}</h1></header>
}
function lp({confirmAction,onCloseSpeedPanel,onNavigate,runAction,snapshot,speedPanelVisible}) {
  const [protectionOpen,setProtectionOpen]=O.useState(false);
  const [serversOpen,setServersOpen]=O.useState(false);
  const api=window.egoistAPI;
  const vpnVerified=wm(snapshot.vpn);
  const vpnRunning=!!(snapshot.vpn?.connected||snapshot.vpn?.running);
  const vpnFailed=/failed|error/i.test(String(snapshot.vpn?.lifecycle??''));
  const vpnBusy=snapshot.busy==='vpn-toggle'||snapshot.busy==='vpn-disconnect';
  const dnsActive=snapshot.systemDoh?.running===true;
  const VpnStateIcon=vpnVerified?Ad:ShieldOffIcon;
  const zapretActive=!!(snapshot.zapret?.serviceRunning||snapshot.zapret?.standaloneRunning);
  const telegramActive=!!snapshot.telegram?.running;
  const anyActive=vpnRunning||dnsActive||zapretActive||telegramActive;
  const nodes=pm(snapshot.state?.nodes);
  const activeNode=nodes.find(node=>node.id===snapshot.state?.activeNodeId);
  const ip=Q(vpnVerified?snapshot.vpn?.egressIp:null,snapshot.myIp?.ip,snapshot.network?.publicIp,snapshot.health?.publicIp);
  const region=Q(snapshot.myIp?.country,snapshot.myIp?.countryCode,snapshot.network?.region);
  const provider=Q(snapshot.myIp?.provider,snapshot.network?.provider,snapshot.network?.isp);
  const route=snapshot.routeProbe?.route??snapshot.routeProbe;
  const routeDns=snapshot.routeProbe?.dns;
  function probe(){setProtectionOpen(true);return runAction('route-probe',async()=>{const [route,dns]=await Promise.all([Z('system.routeProbe',api?.system?.routeProbe),Z('system.dnsLeakTest',api?.system?.dnsLeakTest)]);return {route,dns}},'Проверка маршрута завершена')}
  function connect(){
    if(vpnRunning)return runAction('vpn-disconnect',()=>Z('vpn.disconnect',api?.vpn?.disconnect),'Соединение отключено');
    if(!activeNode){onNavigate('vpn');return}
    return runAction('vpn-toggle',()=>Z('vpn.connect',api?.vpn?.connect,activeNode.id),'Соединение подключается');
  }
  function toggleDns(){
    if(dnsActive)return runAction('doh-reset',()=>Z('system.resetSystemDoh',api?.system?.resetSystemDoh),'Исходные параметры DNS восстановлены');
    const url=snapshot.state?.settings?.systemDohUrl;
    if(!url){onNavigate('dns');return}
    return runAction('doh-apply',()=>Z('system.applySystemDoh',api?.system?.applySystemDoh,url),'DNS подключён');
  }
  function toggleZapret(){
    if(zapretActive)return runAction('zapret-stop',async()=>{
      if(snapshot.zapret?.serviceRunning)await Z('zapret.stopService',api?.zapret?.stopService);
      if(snapshot.zapret?.standaloneRunning)await Z('zapret.stopStandalone',api?.zapret?.stopStandalone);
      return {ok:true};
    },'Профиль остановлен');
    const profile=Q(snapshot.zapret?.currentProfile,snapshot.zapret?.currentProfileName);
    if(!profile){onNavigate('zapret');return}
    return runAction('zapret-standalone',()=>Z('zapret.startStandalone',api?.zapret?.startStandalone,profile),'Профиль запущен');
  }
  function toggleTelegram(){
    if(!telegramActive&&!snapshot.telegram?.serviceInstalled){onNavigate('telegram-proxy');return}
    return runAction(telegramActive?'tg-stop':'tg-start',()=>telegramActive?Z('telegramProxy.stop',api?.telegramProxy?.stop):Z('telegramProxy.start',api?.telegramProxy?.start),telegramActive?'Telegram Proxy остановлен':'Telegram Proxy запущен');
  }
  function restore(){confirmAction('Восстановить настройки','Egoist Lagom вернёт исходный системный прокси и проверит доступ к сети. Настройки DNS, Telegram и сторонних программ сохранятся.','Восстановить',()=>runAction('internet-fix',()=>Z('system.internetFix',api?.system?.internetFix),'Восстановление завершено'))}
  const cards=[{id:'dns',title:'DNS',description:'Шифрование DNS-запросов.',Icon:hd,active:dnsActive,toggle:toggleDns},{id:'zapret',title:'Профили',description:'Правила маршрутизации.',Icon:Td,active:zapretActive,toggle:toggleZapret},{id:'telegram-proxy',title:'Telegram',description:'Локальный прокси для Telegram.',Icon:Dd,active:telegramActive,toggle:toggleTelegram}];
  return <div className="obsidian-dashboard">
    <div className="obsidian-heading"><h1>Ваше пространство связи</h1><span><i className={anyActive?'active':''}/>{anyActive?'Есть активные подключения':'Все подключения выключены'}</span></div>
    <section className={'obsidian-hero'+(vpnVerified?' connected':'')}>
      <div className="obsidian-main"><img className="obsidian-art" src="./assets/obsidian-hero.png" alt="" aria-hidden="true"/><div className="obsidian-connect"><VpnStateIcon className="obsidian-status-icon" size={30} strokeWidth={1.2}/><h2>{snapshot.busy==='vpn-disconnect'?'Отключение…':vpnBusy?'Подключение…':vpnVerified?'Маршрут подключён':vpnRunning?'Проверяем маршрут':vpnFailed?'Маршрут не подключён':'Маршрут отключён'}</h2><p>{vpnVerified?'Маршрут подтверждён.':vpnRunning?'Проверяем внешний адрес и маршрут.':vpnFailed?'Подключение не подтверждено. Повторите попытку или выберите другой сервер.':<>Выберите сервер и подключитесь<br/>для работы с маршрутом.</>}</p><button className="obsidian-primary" disabled={vpnBusy} onClick={connect}><span>{vpnBusy?'Пожалуйста, подождите':vpnRunning?'Отключить':'Подключить'}</span><ShieldArrow size={23}/></button><button className="obsidian-server" onClick={()=>nodes.length?setServersOpen(true):onNavigate('vpn')}><ShieldGlobeIcon size={25} strokeWidth={1.2}/><span>{activeNode?dm(snapshot.vpn,snapshot.state):'Выбрать сервер'}</span><ShieldChevron size={15}/></button>{vpnVerified&&<small className="obsidian-uptime">{Im(snapshot.vpn?.uptimeMs??snapshot.vpn?.startedAt)}</small>}</div></div>
      <aside className="obsidian-network"><h3>Сеть</h3><dl>{[['Ваш IP',ip],['Провайдер',provider],['Регион',region],['Протокол',activeNode?.protocol?.toUpperCase()]].map(([label,value])=><div key={label}><dt>{label}</dt><dd title={value??''}>{value??'Не определено'}</dd></div>)}</dl><div className="obsidian-probe"><Ad size={29} strokeWidth={1.2}/><div><h3>{vpnVerified?'Выход подтверждён':snapshot.busy==='route-probe'?'Проверяем выход…':route?'Результат проверки':'Выход не проверен'}</h3><p>{vpnVerified?'Внешний маршрут прошёл проверку.':'Проверьте точку выхода в интернет.'}</p><button className="obsidian-secondary" disabled={snapshot.busy==='route-probe'} onClick={probe}>Проверить</button></div></div></aside>
    </section>
    <section className="obsidian-components" aria-label="Сетевые компоненты">{cards.map(({id,title,description,Icon,active,toggle})=><article key={id}><button className="obsidian-component-open" onClick={()=>onNavigate(id)}><Icon size={47} strokeWidth={1.05}/><span><strong>{title}</strong><small>{description}</small></span></button><button className={'obsidian-switch '+(active?'active':'')} role="switch" aria-label={title} aria-checked={active} disabled={!!snapshot.busy} onClick={toggle}><i/>{active?'Вкл':'Выкл'}</button></article>)}</section>
    <section className="obsidian-traffic"><div><h3>Трафик</h3><p>{vpnVerified?'Текущая скорость':'Статистика появится после подключения'}</p></div><div className="obsidian-metric"><ShieldDownloadIcon size={23} strokeWidth={1.2}/><div><p>Входящий</p><strong>{vpnVerified?Gm(snapshot.traffic?.rx??0):'0 Б'}/с</strong></div></div><div className="obsidian-metric"><Pd size={23} strokeWidth={1.2}/><div><p>Исходящий</p><strong>{vpnVerified?Gm(snapshot.traffic?.tx??0):'0 Б'}/с</strong></div></div><button disabled={snapshot.busy==='speedtest'} onClick={()=>runAction('speedtest',()=>Z('system.speedtest',api?.system?.speedtest),'Замер скорости выполнен')}><ShieldGaugeIcon size={25} strokeWidth={1.2}/><span>{snapshot.busy==='speedtest'?'Измеряем…':'Speedtest'}</span><ShieldArrow size={16}/></button><button disabled={snapshot.busy==='internet-fix'} onClick={restore}><ShieldGlobeIcon size={25} strokeWidth={1.2}/><span>Восстановить настройки</span><ShieldArrow size={16}/></button></section>
    <ShieldSpeedPanel onClose={onCloseSpeedPanel} open={speedPanelVisible&&(snapshot.busy==='speedtest'||!!snapshot.speedtest)} progress={snapshot.speedProgress} result={snapshot.speedtest}/>
    <ShieldProtectionPanel dns={routeDns??null} route={route??null} open={protectionOpen&&(snapshot.busy==='route-probe'||!!snapshot.routeProbe)} onClose={()=>setProtectionOpen(false)} onProtectionAction={action=>{const key=pp(action);if(key==='повторить проверку')return probe();setProtectionOpen(false);if(key==='восстановить интернет')return restore();if(key==='применить маршрут заново')return runAction('vpn-reapply-route',()=>Z('system.reapplyRoute',api?.system?.reapplyRoute),'Маршрут применён повторно');onNavigate(key.includes('dns')?'dns':'vpn')}}/>
    {serversOpen&&<ShieldServerPicker nodes={nodes} activeId={activeNode?.id} onClose={()=>setServersOpen(false)} onManage={()=>{setServersOpen(false);onNavigate('vpn')}} onSelect={node=>{setServersOpen(false);runAction('vpn-select',()=>Z('state.set',api?.state?.set,{...snapshot.state,activeNodeId:node.id}),'Сервер выбран')}}/>}
  </div>
}
function ShieldServerPicker({nodes,activeId,onClose,onManage,onSelect}){
  const dialog=O.useRef(null);
  O.useEffect(()=>{const previous=document.activeElement;dialog.current?.querySelector('button')?.focus();const key=e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const items=Array.from(dialog.current.querySelectorAll('button'));const index=items.indexOf(document.activeElement);if(e.shiftKey&&index===0){e.preventDefault();items.at(-1)?.focus()}else if(!e.shiftKey&&index===items.length-1){e.preventDefault();items[0]?.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus?.()}},[]);
  return <div className="obsidian-modal-layer" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="obsidian-modal" ref={dialog} role="dialog" aria-modal="true" aria-label="Выберите сервер"><button className="obsidian-close" aria-label="Закрыть выбор сервера" onClick={onClose}><Id size={23}/></button><h2>Выберите сервер</h2><div className="obsidian-server-list">{nodes.map(node=><button key={node.id} onClick={()=>onSelect(node)}><ShieldGlobeIcon size={24}/><span>{Kd(node.name??node.remark??node.id)}<small>{node.protocol?.toUpperCase()??'Сервис'}{node.country?' · '+node.country:''}</small></span>{node.id===activeId?<ShieldCheckIcon size={20}/>:<ShieldArrow size={18}/>}</button>)}</div><button className="obsidian-secondary" onClick={onManage}>Управление серверами и подписками</button></section></div>
}


