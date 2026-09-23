// Shares the recovered renderer's React runtime and verified action bindings.
const ShieldSpeedPanel=up, ShieldProtectionPanel=bp;
const rubyScreenCopy={dashboard:['Обзор','Подключения и состояние сети'],vpn:['Соединение','Серверы, подписка и подключение'],dns:['DNS','Адреса, шифрование и проверка соединения'],zapret:['Профили','Профили маршрутов и настройки'], 'telegram-proxy':['Telegram','Локальный прокси и подключение'],settings:['Настройки','Поведение приложения и обслуживание']};
const rubyNavIcons={dashboard:'overview',vpn:'vpn',dns:'dns',zapret:'zapret','telegram-proxy':'telegram',settings:'settings'};
const rubyLegacyIconNames={activity:'activity',check:'check','circle-help':'help',clipboard:'copy','clock-3':'activity',download:'download',earth:'vpn','external-link':'external-link',gauge:'speedtest','key-round':'privacy','layout-dashboard':'overview','list-restart':'restore','map-pin':'location','maximize-2':'maximize',minus:'minimize',network:'dns',power:'power',radar:'route','refresh-ccw':'refresh',send:'telegram',settings:'settings','shield-alert':'warning','shield-check':'check','shield-off':'shield-off',star:'star','triangle-alert':'warning',upload:'upload',wrench:'system',x:'close'};
function RubyIcon({name,size=20,className='',style={},strokeWidth,forwardedRef,...props}){
  return <svg {...props} ref={forwardedRef} aria-hidden="true" className={'ruby-icon '+className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" style={style}>{(rubyGlyphs[name]??rubyGlyphs.help).map(([tag,attributes],index)=>O.createElement(tag,{...attributes,key:index}))}</svg>;
}
function rubyButtonText(children){return O.Children.toArray(children).map(child=>typeof child==='string'||typeof child==='number'?String(child):O.isValidElement(child)?rubyButtonText(child.props.children):'').join(' ').replace(/\s+/g,' ').trim()}
function rubyButtonHasIcon(children){return O.Children.toArray(children).some(child=>O.isValidElement(child)&&(child.type===RubyIcon||child.type==='svg'||child.type?.displayName in rubyLegacyIconNames||rubyButtonHasIcon(child.props.children)))}
function rubyRequireOk(result,fallback){if(result?.ok===false)throw new Error(result.message||result.error||fallback);return result}
function rubyActionIcon(label,role){
  if(role==='switch'){
    if(/старт.*Windows/i.test(label))return 'startup';
    if(/трей/i.test(label))return 'tray';
    if(/автоподключение/i.test(label))return 'power';
    if(/переподключ/i.test(label))return 'reconnect';
    if(/уведомлен/i.test(label))return 'notifications';
    if(/HWID/i.test(label))return 'privacy';
    if(/обновлен/i.test(label))return 'auto-update';
    return null;
  }
  const actions=[[/импорт|вставить/i,'import'],[/экспорт/i,'export'],[/сохран/i,'save'],[/автоподбор|подобрать/i,'auto-select'],[/восстанов|сброс/i,'restore'],[/очист/i,'cleanup'],[/удал/i,'trash'],[/журнал|логи|логами/i,'logs'],[/папк/i,'folder'],[/копир/i,'copy'],[/обнов|проверяем|загруз/i,'refresh'],[/диагност|проверить|тест/i,'activity'],[/настро/i,'settings'],[/маршрут/i,'route'],[/служб/i,'service'],[/открыть Telegram/i,'telegram'],[/открыть|страницу/i,'external-link'],[/подключ|запуст|останов|включ|выключ/i,'power'],[/применить/i,'check']];
  return actions.find(([pattern])=>pattern.test(label))?.[1]??null;
}
const RubyButton=O.forwardRef(({children,className='',...props},ref)=>{
  const label=rubyButtonText(children);
  const isCompact=/(help|icon-button|server-favorite|favorite-button|compact|btn-compact|mini|tab|preset-button)/.test(className);
  const icon=!rubyButtonHasIcon(children)&&!isCompact?rubyActionIcon(label,props.role):null;
  return <button {...props} ref={ref} className={className+(icon?' ruby-action-button':'')}>{icon&&<RubyIcon name={icon} size={16} className="ruby-action-glyph"/>}{children}</button>;
});
function sp({activeScreen,onAppInfo,onNavigate,onSwitchToWidget}){
  const windowApi=window.egoistAPI?.window;
  return <>
    <header className="ruby-titlebar">
      <button className="ruby-brand" onClick={()=>onNavigate('dashboard')} aria-label="Egoist Lagom: обзор"><img src="./assets/icons/brand-shield.svg" alt=""/><span>EGOIST <b>LAGOM</b></span></button>
      <div className="ruby-drag-region"/>
      <div className="ruby-window-controls">
        <button className="ruby-widget-switch-btn" aria-label="Виджет" title="Свернуть в мини-щит" onClick={onSwitchToWidget}><RubyIcon name="brand-shield" size={20}/><span>Щит</span></button>
        <button aria-label="Свернуть" title="Свернуть" onClick={()=>windowApi?.minimize?.()}><RubyIcon name="minimize" size={15}/></button>
        <button aria-label="Развернуть" title="Развернуть" onClick={()=>windowApi?.toggleMaximize?.()}><RubyIcon name="maximize" size={14}/></button>
        <button aria-label="Закрыть" title="Вернуться в виджет" onClick={onSwitchToWidget}><RubyIcon name="close" size={15}/></button>
      </div>
    </header>
    <aside className="ruby-sidebar">
      <nav aria-label="Основная навигация">{Cf.map(item=><button key={item.id} className={item.id===activeScreen?'active':''} aria-label={rubyScreenCopy[item.id][0]} aria-current={item.id===activeScreen?'page':undefined} onClick={()=>onNavigate(item.id)}><RubyIcon name={rubyNavIcons[item.id]}/><span>{rubyScreenCopy[item.id][0]}</span></button>)}</nav>
      <footer><button onClick={onAppInfo}><RubyIcon name="info" size={14}/><span>О приложении</span></button><small>Версия Lagom</small></footer>
    </aside>
  </>;
}
function cp({activeScreen}){
  if(activeScreen==='dashboard')return null;
  const [title,description]=rubyScreenCopy[activeScreen]??['Egoist Lagom',''];
  return <header className="ruby-page-heading"><h1>{title}</h1><p>{description}</p></header>;
}
function lp({confirmAction,onCloseSpeedPanel,onNavigate,runAction,snapshot,speedPanelVisible}){
  const [protectionOpen,setProtectionOpen]=O.useState(false);
  const [serversOpen,setServersOpen]=O.useState(false);
  const api=window.egoistAPI;
  const vpnVerified=wm(snapshot.vpn);
  const vpnRunning=!!(snapshot.vpn?.connected||snapshot.vpn?.running);
  const vpnFailed=/failed|error/i.test(String(snapshot.vpn?.lifecycle??''));
  const vpnBusy=snapshot.busy==='vpn-toggle'||snapshot.busy==='vpn-disconnect';
  const dnsActive=snapshot.systemDoh?.running===true;
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
    const target=activeNode||nodes[0];
    if(!target){onNavigate('vpn');return}
    return runAction('vpn-toggle',()=>Z('vpn.connect',api?.vpn?.connect,target.id),'Соединение подключается');
  }
  function toggleDns(){
    if(dnsActive)return runAction('doh-reset',()=>Z('system.resetSystemDoh',api?.system?.resetSystemDoh),'Исходные параметры DNS восстановлены');
    const url=snapshot.state?.settings?.systemDohUrl;
    if(!url){onNavigate('dns');return}
    return runAction('doh-apply',()=>Z('system.applySystemDoh',api?.system?.applySystemDoh,url),'DNS подключён');
  }
  function toggleZapret(){
    if(zapretActive)return runAction('zapret-stop',async()=>{
      if(snapshot.zapret?.serviceRunning)rubyRequireOk(await Z('zapret.stopService',api?.zapret?.stopService),'Не удалось остановить профиль');
      if(snapshot.zapret?.standaloneRunning)rubyRequireOk(await Z('zapret.stopStandalone',api?.zapret?.stopStandalone),'Не удалось остановить профиль');
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
  const components=[{id:'dns',title:'DNS',description:'Шифрование DNS-запросов',icon:'dns',active:dnsActive,toggle:toggleDns},{id:'zapret',title:'Профили',description:'Правила маршрутизации',icon:'zapret',active:zapretActive,toggle:toggleZapret},{id:'telegram-proxy',title:'Telegram',description:'Локальный прокси для Telegram',icon:'telegram',active:telegramActive,toggle:toggleTelegram}];
  return <div className="ruby-dashboard">
    <header className="ruby-dashboard-heading ruby-page-heading"><div><h1>Обзор</h1></div><span className={'ruby-connection-summary'+(anyActive?' active':'')}><i/>{anyActive?'Есть активные подключения':'Всё выключено'}</span></header>
    <section className="ruby-connection-panel" aria-label="Подключение">
      <div className="ruby-connect"><img className="ruby-connection-mark" src="./assets/icons/brand-shield.svg" alt="" aria-hidden="true"/><div className="ruby-connect-body"><h2>{snapshot.busy==='vpn-disconnect'?'Отключение…':vpnBusy?'Подключение…':vpnVerified?'Маршрут подключён':vpnRunning?'Проверяем маршрут':vpnFailed?'Маршрут не подключён':'Маршрут отключён'}</h2><p>{vpnVerified?'Маршрут подтверждён':vpnRunning?'Проверяем внешний адрес и маршрут':vpnFailed?'Повторите попытку или выберите другой сервер':'Выберите сервер для подключения'}</p><button className="ruby-server-select" onClick={()=>nodes.length?setServersOpen(true):onNavigate('vpn')}><RubyIcon name="vpn"/><span>{activeNode?dm(snapshot.vpn,snapshot.state):'Выбрать сервер'}</span><RubyIcon name="chevron-down" size={16}/></button><button className="btn-primary ruby-connect-button" disabled={vpnBusy} aria-busy={vpnBusy} onClick={connect}><RubyIcon name="power" size={19}/>{vpnBusy?'Пожалуйста, подождите':vpnRunning?'Отключить':'Подключить'}</button>{vpnVerified&&<small className="ruby-uptime">Подключено {Im(snapshot.vpn?.uptimeMs??snapshot.vpn?.startedAt)}</small>}</div></div>
      <aside className="ruby-network"><dl>{[['Ваш IP',ip],['Провайдер',provider],['Регион',region],['Протокол',activeNode?.protocol?.toUpperCase()]].map(([label,value])=><div key={label}><dt>{label}</dt><dd title={value??''}>{value??'Не определено'}</dd></div>)}</dl><div className="ruby-route-status"><RubyIcon name={vpnVerified?'check':'zapret'} size={22}/><div><h3>{vpnVerified?'Выход подтверждён':snapshot.busy==='route-probe'?'Проверяем выход…':route?'Результат проверки':'Выход не проверен'}</h3><p>{vpnVerified?'Внешний маршрут прошёл проверку':'Проверьте точку выхода в интернет'}</p></div></div><button className="btn-secondary" disabled={snapshot.busy==='route-probe'} onClick={probe}>Проверить</button></aside>
    </section>
    <section className="ruby-components" aria-label="Сетевые компоненты"><h2>Компоненты</h2><div className="ruby-component-list">{components.map(({id,title,description,icon,active,toggle})=><article key={id}><RubyIcon name={icon} size={24}/><div className="ruby-component-copy"><h3>{title}</h3><p>{description}</p></div><button className="btn-secondary ruby-configure" aria-label={'Настроить '+title} onClick={()=>onNavigate(id)}>Настроить</button><button role="switch" aria-label={title} aria-checked={active} className={'ruby-toggle'+(active?' active':'')} disabled={!!snapshot.busy} onClick={toggle}><span className="ruby-toggle-track"><i/></span><span>{active?'Вкл':'Выкл'}</span></button></article>)}</div></section>
    <section className="ruby-traffic" aria-label="Трафик"><div className="ruby-traffic-heading"><RubyIcon name="activity"/><h2>Трафик</h2></div><div className="ruby-metric"><span>Входящий</span><strong><RubyIcon name="download" size={17}/>{vpnVerified?Gm(snapshot.traffic?.rx??0):'0 Б'}/с</strong></div><div className="ruby-metric"><span>Исходящий</span><strong><RubyIcon name="upload" size={17}/>{vpnVerified?Gm(snapshot.traffic?.tx??0):'0 Б'}/с</strong></div><button className="btn-secondary" disabled={snapshot.busy==='speedtest'} onClick={()=>runAction('speedtest',()=>Z('system.speedtest',api?.system?.speedtest),'Замер скорости выполнен')}><RubyIcon name="speedtest"/>{snapshot.busy==='speedtest'?'Измеряем…':'Speedtest'}</button></section>
    <button className="ruby-recovery" disabled={snapshot.busy==='internet-fix'} onClick={restore}><RubyIcon name="restore"/>Восстановить интернет</button>
    <ShieldSpeedPanel onClose={onCloseSpeedPanel} open={speedPanelVisible&&(snapshot.busy==='speedtest'||!!snapshot.speedtest)} progress={snapshot.speedProgress} result={snapshot.speedtest}/>
    <ShieldProtectionPanel dns={routeDns??null} route={route??null} open={protectionOpen&&(snapshot.busy==='route-probe'||!!snapshot.routeProbe)} onClose={()=>setProtectionOpen(false)} onProtectionAction={action=>{const key=pp(action);if(key==='повторить проверку')return probe();setProtectionOpen(false);if(key==='восстановить интернет')return restore();if(key==='применить маршрут заново')return runAction('vpn-reapply-route',()=>Z('system.reapplyRoute',api?.system?.reapplyRoute),'Маршрут применён повторно');onNavigate(key.includes('dns')?'dns':'vpn')}}/>
    {serversOpen&&<ShieldServerPicker nodes={nodes} activeId={activeNode?.id} onClose={()=>setServersOpen(false)} onManage={()=>{setServersOpen(false);onNavigate('vpn')}} onSelect={node=>{setServersOpen(false);runAction('vpn-select',()=>Z('state.set',api?.state?.set,{...snapshot.state,activeNodeId:node.id}),'Сервер выбран')}}/>}
  </div>;
}
function ShieldServerPicker({nodes,activeId,onClose,onManage,onSelect}){
  const dialog=O.useRef(null);
  O.useEffect(()=>{const previous=document.activeElement;dialog.current?.querySelector('button')?.focus();const key=e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const items=Array.from(dialog.current.querySelectorAll('button:not(:disabled)'));const index=items.indexOf(document.activeElement);if(e.shiftKey&&index===0){e.preventDefault();items.at(-1)?.focus()}else if(!e.shiftKey&&index===items.length-1){e.preventDefault();items[0]?.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus?.()}},[]);
  return <div className="ruby-modal-layer" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="ruby-modal" ref={dialog} role="dialog" aria-modal="true" aria-label="Выберите сервер"><header><div><h2>Выберите сервер</h2><p>Выбор сохраняется для следующего подключения</p></div><button className="ruby-close" aria-label="Закрыть выбор сервера" onClick={onClose}><RubyIcon name="close" size={18}/></button></header><div className="ruby-server-list">{nodes.map(node=><button key={node.id} aria-pressed={node.id===activeId} onClick={()=>onSelect(node)}><RubyIcon name="vpn"/><span>{Kd(node.name??node.remark??node.id)}<small>{node.protocol?.toUpperCase()??'Сервис'}{node.country?' · '+node.country:''}</small></span><RubyIcon name={node.id===activeId?'check':'arrow-right'} size={18}/></button>)}</div><button className="btn-secondary" onClick={onManage}>Управление серверами и подписками<RubyIcon name="arrow-right" size={16}/></button></section></div>;
}

function ap({ activeScreen, activity, children, onAppInfo, onDismissActivity, onNavigate, snapshot }) {
  const [widgetMode, setWidgetMode] = O.useState(true);

  O.useEffect(() => {
    try {
      Promise.resolve(window.egoistAPI?.window?.setWidgetMode?.(widgetMode)).catch(error => console.error('Window mode:', error));
    } catch (e) {}
  }, [widgetMode]);

  O.useEffect(() => {
    const unsub = window.egoistAPI?.window?.onSwitchToWidget?.(() => {
      setWidgetMode(true);
    });
    return () => unsub?.();
  }, []);

  if (widgetMode) {
    return (
      <main className="shield-widget-window">
        <ShieldWidget
          snapshot={snapshot}
          onOpenSettings={() => {
            onNavigate?.('settings');
            setWidgetMode(false);
            try {
              window.egoistAPI?.window?.setWidgetMode?.(false);
            } catch (e) {}
          }}
        />
      </main>
    );
  }

  return (
    <main className="app-shell" data-busy={snapshot?.busy ?? ''} data-screen={activeScreen}>
      {O.createElement(sp, {activeScreen, onAppInfo, onNavigate, snapshot, onSwitchToWidget: () => {
        setWidgetMode(true);
        try {
          window.egoistAPI?.window?.setWidgetMode?.(true);
        } catch (e) {}
      }})}
      <section className="workspace">{children}</section>
      {O.createElement(op, {activity: activeScreen === 'dashboard' && activity?.id === 'speedtest' ? null : activity, onDismiss: onDismissActivity})}
    </main>
  );
}
