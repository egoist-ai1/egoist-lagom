// Shares the recovered renderer's React runtime and verified action bindings.
const ShieldSpeedPanel=up, ShieldProtectionPanel=bp;
const rubyScreenCopy={dashboard:['Обзор','Подключения и состояние сети'],vpn:['VPN','Серверы, подписки и проверенный маршрут'],dns:['DNS','Адреса, шифрование и проверка соединения'],zapret:['Профили DPI','Профили обработки трафика и правила'], 'telegram-proxy':['Telegram','Локальный прокси и подключение'],settings:['Настройки','Поведение приложения и обслуживание']};
const rubyNavIcons={dashboard:'overview',vpn:'vpn',dns:'dns',zapret:'zapret','telegram-proxy':'telegram',settings:'settings'};
const rubyLegacyIconNames={activity:'activity',check:'check','circle-help':'help',clipboard:'copy','clock-3':'activity',download:'download',earth:'vpn','external-link':'external-link',gauge:'speedtest','key-round':'privacy','layout-dashboard':'overview','list-restart':'restore','map-pin':'location','maximize-2':'maximize',minus:'minimize',network:'dns',power:'power',radar:'route','refresh-ccw':'refresh',send:'telegram',settings:'settings','shield-alert':'warning','shield-check':'check','shield-off':'shield-off',star:'star','triangle-alert':'warning',upload:'upload',wrench:'system',x:'close'};
function RubyIcon({name,size=20,className='',style={},strokeWidth,forwardedRef,...props}){
  return <svg {...props} ref={forwardedRef} aria-hidden="true" focusable="false" data-icon={name} className={'ruby-icon '+className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth??1.65} strokeLinecap="round" strokeLinejoin="round" style={style}>{(rubyGlyphs[name]??rubyGlyphs.help).map(([tag,attributes],index)=>{
    const paint={...attributes};
    if(paint.fill&&paint.fill!=='none'&&paint.stroke===undefined)paint.stroke='none';
    if(strokeWidth!==undefined&&paint.strokeWidth!==undefined&&paint.stroke!=='none')paint.strokeWidth=strokeWidth;
    return O.createElement(tag,{...paint,key:index});
  })}</svg>;
}
function rubyButtonText(children){return O.Children.toArray(children).map(child=>typeof child==='string'||typeof child==='number'?String(child):O.isValidElement(child)?rubyButtonText(child.props.children):'').join(' ').replace(/\s+/g,' ').trim()}
function rubyButtonHasIcon(children){return O.Children.toArray(children).some(child=>O.isValidElement(child)&&(child.type===RubyIcon||child.type==='svg'||child.type?.displayName in rubyLegacyIconNames||rubyButtonHasIcon(child.props.children)))}
function rubyRequireOk(result,fallback){if(result?.ok===false)throw new Error(result.message||result.error||fallback);return result}
function rubyBusy(snapshot,...actions){return actions.some(id=>snapshot.busy===id||snapshot.busyActions?.includes(id))}
function rubyServerPage(nodes,page,size=60){
  const pages=Math.max(1,Math.ceil(nodes.length/size));
  const current=Math.min(Math.max(0,Number.isInteger(page)?page:0),pages-1);
  const start=current*size;
  return {page:current,pages,start,end:Math.min(start+size,nodes.length),total:nodes.length,rows:nodes.slice(start,start+size)};
}
function rubyFilterServers(nodes,query){
  const search=String(query??'').trim().toLocaleLowerCase('ru');
  return search?nodes.filter(node=>[node.name,node.country,node.city,node.server,node.protocol].some(value=>String(value??'').toLocaleLowerCase('ru').includes(search))):nodes;
}
function RubyServerPages({slice,onChange}){
  if(slice.pages<2)return null;
  return <nav className="ruby-server-pages" aria-label="Страницы серверов"><button className="btn-secondary compact" aria-label="Предыдущие серверы" disabled={slice.page===0} onClick={()=>onChange(slice.page-1)}><RubyIcon name="chevron-down" style={{transform:'rotate(90deg)'}} size={16}/>Назад</button><span role="status" aria-live="polite">{slice.start+1}–{slice.end} из {slice.total}</span><button className="btn-secondary compact" aria-label="Следующие серверы" disabled={slice.page===slice.pages-1} onClick={()=>onChange(slice.page+1)}>Далее<RubyIcon name="chevron-down" style={{transform:'rotate(-90deg)'}} size={16}/></button></nav>;
}
function rubyBackgroundVpnKnown(status){
  return rubyStatusKnown(status)&&status.observation?.state!=='unknown'&&['running','stopped','not-installed'].includes(status.serviceState)&&typeof status.serviceInstalled==='boolean'&&typeof status.backgroundEnabled==='boolean'&&typeof status.running==='boolean';
}
function rubyBackgroundVpnOwnsRoute(status){
  return rubyBackgroundVpnKnown(status)&&(status.backgroundEnabled||status.running);
}
async function rubyBackgroundVpnCommand(api,method,payload){
  if(!['serviceInstall','serviceStart','serviceStop','serviceRemove'].includes(method))throw new Error('Неизвестное действие фонового VPN.');
  rubyRequireOk(await Z('vpn.'+method,api?.vpn?.[method],...(payload?[payload]:[])),'Не удалось изменить фоновый VPN.');
  const after=await Z('vpn.serviceStatus',api?.vpn?.serviceStatus);
  if(!rubyBackgroundVpnKnown(after))throw new Error('Состояние фонового VPN не подтверждено. Дождитесь повторной проверки.');
  const expected=method==='serviceRemove'?!after.serviceInstalled&&!after.running&&!after.backgroundEnabled:method==='serviceStop'?!after.running&&!after.backgroundEnabled:after.serviceInstalled&&after.running&&after.backgroundEnabled;
  if(!expected)throw new Error(after.message||'Служба не подтвердила результат действия. Проверьте её состояние.');
  return after;
}
function RubyBackgroundVpn({snapshot,runAction,confirmAction}){
  const status=snapshot.vpnService,known=rubyBackgroundVpnKnown(status);
  const node=snapshot.state?.nodes?.find(item=>item.id===snapshot.state?.activeNodeId);
  const pending=rubyBusy(snapshot,'vpn-service-install','vpn-service-start','vpn-service-stop','vpn-service-remove');
  const busy=pending||!!snapshot.busy;
  const installed=known&&status.serviceInstalled;
  const enabled=known&&status.backgroundEnabled;
  const runtimeRunning=known&&status.running;
  const temporaryActive=snapshot.vpn?.temporaryRuntimeActive===true||(snapshot.vpn?.executionMode!=='background-service'&&(snapshot.vpn?.running||snapshot.vpn?.connected));
  const canInstall=known&&!!node&&snapshot.stateObservation?.known!==false&&!temporaryActive&&rubyStatusKnown(snapshot.vpn);
  function install(){
    if(!canInstall||busy)return;
    const target={id:node.id,name:Kd(node.name??node.remark??node.id)};
    confirmAction(installed?'Обновить конфигурацию фонового VPN':'Включить VPN без приложения',`Сервер «${target.name}» и текущие правила будут сохранены в службе Windows. TUN запустится после перезагрузки без открытия приложения. Временное соединение нужно отключить. Для смены сервера или правил повторно примените конфигурацию.`,installed?'Применить':'Установить и включить',()=>runAction('vpn-service-install',()=>rubyBackgroundVpnCommand(window.egoistAPI,'serviceInstall',target.id),'Фоновый VPN запущен; автозапуск службы подтверждён'));
  }
  function toggle(){
    if(!known||busy)return;
    if(enabled||runtimeRunning)return runAction('vpn-service-stop',()=>rubyBackgroundVpnCommand(window.egoistAPI,'serviceStop'),'Фоновый VPN остановлен; автозапуск отключён');
    if(installed)return runAction('vpn-service-start',()=>rubyBackgroundVpnCommand(window.egoistAPI,'serviceStart'),'Фоновый VPN запущен; автозапуск службы подтверждён');
    return install();
  }
  function remove(){
    confirmAction('Удалить службу VPN','Служба будет остановлена, её автозапуск и сохранённая конфигурация будут удалены. Подписки и временный режим сохранятся.','Удалить',()=>runAction('vpn-service-remove',()=>rubyBackgroundVpnCommand(window.egoistAPI,'serviceRemove'),'Служба VPN удалена'));
  }
  const label=!known?'Не проверено':runtimeRunning?'Работает':enabled?'Автозапуск включён · служба не готова':installed?'Установлена · выключена':'Не установлена';
  return <section className="panel vpn-background-panel" aria-label="VPN без приложения"><h3>VPN без приложения <small>TUN</small></h3><p>Служба Windows запускается после перезагрузки. Окно и запуск приложения при входе не требуются.</p><div className="vpn-background-status" role="status"><RubyIcon name={!known?'help':runtimeRunning?'check':enabled?'warning':'service'} size={17}/><strong>{pending?'Переключаем…':label}</strong></div>{!known&&<p>{status?.uiObservation?.error||status?.message||'Ожидаем ответ службы. Состояние не заменяется выключенным.'}</p>}{known&&<dl className="vpn-background-facts"><div><dt>Сохранённый сервер</dt><dd>{status.activeNodeId?Kd(status.activeNodeName??snapshot.state?.nodes?.find(item=>item.id===status.activeNodeId)?.name??status.activeNodeId):'Не выбран'}</dd></div><div><dt>Внешний маршрут</dt><dd>Требует отдельной проверки</dd></div></dl>}{status?.message&&known&&<p className="vpn-background-message">{status.message}</p>}<button role="switch" aria-label="VPN без приложения (TUN)" aria-checked={enabled} aria-busy={pending} disabled={!known||busy||(!installed&&!canInstall)} className="btn-secondary full" onClick={toggle}><RubyIcon name="power" size={17}/>{!known?'Ожидаем проверку':pending?'Переключаем…':enabled||runtimeRunning?'Остановить фоновый VPN':installed?'Включить фоновый VPN':'Установить и включить'}</button>{installed&&<><button className="btn-secondary full" disabled={!canInstall||busy} onClick={install}>Применить выбранный сервер</button><button className="btn-danger full" disabled={busy} onClick={remove}>Удалить службу VPN</button></>}{known&&!canInstall&&!installed&&<p>Выберите сервер и отключите временное соединение перед установкой службы.</p>}<small className="vpn-background-hint">Сохраняется текущая конфигурация. Пользовательские исполняемые файлы и Kill Switch для службы пока не поддерживаются.</small></section>;
}
function rubyComponentStatus(status,active,pending){
  if(pending)return {tone:'pending',label:'Переключаем…',detail:''};
  if(!status)return {tone:'unknown',label:'Проверяем состояние…',detail:''};
  if(status.uiObservation?.known===false||status.uiObservation?.stale===true)return {tone:'unknown',label:status.uiObservation.stale?'Данные устарели':'Не проверено',detail:status.uiObservation.error||'Не удалось получить актуальное состояние.'};
  const error=status.lastError?.message||status.lastError||status.statusError||status.error;
  if(active)return {tone:'ready',label:'Работает',detail:error?(typeof error==='string'?error:'Служба сообщила об ошибке.'):''};
  if(error)return {tone:'error',label:'Ошибка',detail:typeof error==='string'?error:'Служба сообщила об ошибке.'};
  if(status.serviceRunning||status.standaloneRunning||status.running)return {tone:'degraded',label:'Служба не готова',detail:'Процесс запущен, но рабочее состояние не подтверждено.'};
  return {tone:'off',label:'Выключен',detail:''};
}
function rubyTrafficSample(verified,received,value){
  return verified&&received&&Number.isFinite(value)?Math.max(0,value):null;
}
function rubyTabKey(event,items,current,onSelect){
  const index=items.indexOf(current);
  const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowRight'?(index+1)%items.length:event.key==='ArrowLeft'?(index-1+items.length)%items.length:null;
  if(next===null||!items.length)return;
  event.preventDefault();
  onSelect(items[next]);
  event.currentTarget.closest('[role="tablist"]')?.querySelector('[data-tab-id="'+items[next]+'"]')?.focus();
}
function rubyStartZapret(api, profile){
  return (async()=>{
    const before=await Z('zapret.status',api?.zapret?.status);
    if(!rubyStatusKnown(before))throw new Error('Не удалось проверить состояние профиля. Повторите проверку.');
    const target=before.serviceProfile||before.currentProfile||before.currentProfileName||profile;
    if(!target)throw new Error('Сначала выберите профиль DPI.');
    const result=before.serviceInstalled
      ?await Z('zapret.startService',api?.zapret?.startService,target)
      :await Z('zapret.startStandalone',api?.zapret?.startStandalone,target);
    rubyRequireOk(result,'Не удалось запустить профиль');
    const after=await Z('zapret.status',api?.zapret?.status);
    if(!rubyZapretReady(after)||(before.serviceInstalled&&after.serviceRunning!==true))throw new Error(after?.lastError||'Служба не подтвердила готовность профиля.');
    return after;
  })();
}
function RubyLogEntry({line}){
  return <details className={'log-line log-disclosure '+Xp(line)}><summary><span>{Yp(line)}</span><strong>{Zp(line)}</strong><span className="log-message-preview">{Qp(line)}</span><RubyIcon name="chevron-down" size={12}/></summary><p className="log-full-message">{Qp(line)}</p></details>;
}
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
  const actions=[[/проверить и установить/i,'auto-update'],[/импорт|вставить/i,'import'],[/экспорт/i,'export'],[/сохран/i,'save'],[/автоподбор|подобрать/i,'auto-select'],[/восстанов|сброс/i,'restore'],[/очист/i,'cleanup'],[/удал/i,'trash'],[/журнал|логи|логами/i,'logs'],[/папк/i,'folder'],[/копир/i,'copy'],[/обнов|проверяем|загруз/i,'refresh'],[/диагност|проверить|тест/i,'activity'],[/настро/i,'settings'],[/маршрут/i,'route'],[/служб/i,'service'],[/открыть Telegram/i,'telegram'],[/открыть|страницу/i,'external-link'],[/подключ|запуст|останов|включ|выключ/i,'power'],[/применить/i,'check']];
  return actions.find(([pattern])=>pattern.test(label))?.[1]??null;
}
const RubyButton=O.forwardRef(({children,className='',...props},ref)=>{
  const label=rubyButtonText(children);
  const isCompact=/(help|icon-button|server-favorite|favorite-button|compact|btn-compact|mini|tab|preset-button)/.test(className);
  const icon=!rubyButtonHasIcon(children)&&!isCompact?rubyActionIcon(label,props.role):null;
  return <button {...props} ref={ref} className={className+(icon?' ruby-action-button':'')}>{icon&&<RubyIcon name={icon} size={16} className="ruby-action-glyph"/>}{children}</button>;
});
function sp({activeScreen,onAppInfo,onNavigate,onSwitchToWidget,snapshot}){
  const windowApi=window.egoistAPI?.window;
  const closeLabel=snapshot?.state?.settings?.minimizeToTray?'Скрыть в трей':'Закрыть приложение';
  return <>
    <header className="ruby-titlebar">
      <button className="ruby-brand" onClick={()=>onNavigate('dashboard')} aria-label="Egoist Lagom: обзор"><img src="./assets/icons/brand-shield.svg" alt=""/><span>EGOIST <b>LAGOM</b></span></button>
      <div className="ruby-drag-region"/>
      <div className="ruby-window-controls">
        <button className="ruby-widget-switch-btn" aria-label="Перейти в мини-щит" title="Перейти в мини-щит" onClick={onSwitchToWidget}><RubyIcon name="brand-shield" size={20}/><span>Мини-щит</span></button>
        <button aria-label="Свернуть" title="Свернуть" onClick={()=>windowApi?.minimize?.()}><RubyIcon name="minimize" size={15}/></button>
        <button aria-label="Развернуть или восстановить окно" title="Развернуть или восстановить окно" onClick={()=>windowApi?.toggleMaximize?.()}><RubyIcon name="maximize" size={14}/></button>
        <button aria-label={closeLabel} title={closeLabel} onClick={()=>windowApi?.close?.()}><RubyIcon name="close" size={15}/></button>
      </div>
    </header>
    <aside className="ruby-sidebar">
      <nav aria-label="Основная навигация">{Cf.map(item=><button key={item.id} className={item.id===activeScreen?'active':''} aria-label={rubyScreenCopy[item.id][0]} title={rubyScreenCopy[item.id][0]} aria-current={item.id===activeScreen?'page':undefined} onClick={()=>onNavigate(item.id)}><RubyIcon name={rubyNavIcons[item.id]}/><span>{rubyScreenCopy[item.id][0]}</span></button>)}</nav>
      <footer><button onClick={onAppInfo}><RubyIcon name="info" size={14}/><span>О приложении</span></button><small>Версия Lagom</small></footer>
    </aside>
  </>;
}
function cp({activeScreen}){
  if(activeScreen==='dashboard')return null;
  const [title,description]=rubyScreenCopy[activeScreen]??['Egoist Lagom',''];
  return <header className="ruby-page-heading"><h1>{title}</h1><p>{description}</p></header>;
}
function RubyReadNotice({snapshot, activeScreen}){
  const keys={vpn:['vpn','vpnService'],dns:['dns','systemDoh'],zapret:['zapret'],'telegram-proxy':['telegram']}[activeScreen]??[];
  const status=keys.map(key=>snapshot[key]).find(value=>value?.uiObservation?.known===false);
  const stateError=snapshot.stateObservation?.known===false;
  if(!status&&!stateError)return null;
  const observation=status?.uiObservation??snapshot.stateObservation;
  return <aside className="ruby-read-notice" role="status"><RubyIcon name="warning" size={18}/><div><strong>{observation.stale?'Последние данные устарели':'Состояние не проверено'}</strong><p>{observation.error} Новая проверка выполняется автоматически.</p>{observation.lastConfirmedAt&&<small>Последний ответ {new Date(observation.lastConfirmedAt).toLocaleTimeString('ru-RU')} · запрос #{observation.generation}</small>}</div></aside>;
}
function lp({confirmAction,onCloseSpeedPanel,onNavigate,runAction,snapshot,speedPanelVisible}){
  const [protectionOpen,setProtectionOpen]=O.useState(false);
  const [serversOpen,setServersOpen]=O.useState(false);
  const api=window.egoistAPI;
  const vpnVerified=wm(snapshot.vpn);
  const vpnKnown=rubyStatusKnown(snapshot.vpn);
  const vpnRunning=vpnKnown&&!!(snapshot.vpn?.connected||snapshot.vpn?.running);
  const vpnFailed=/failed|error/i.test(String(snapshot.vpn?.lifecycle??''));
  const vpnBusy=rubyBusy(snapshot,'vpn-toggle','vpn-disconnect','vpn-connect-node');
  const backgroundKnown=rubyBackgroundVpnKnown(snapshot.vpnService),backgroundOwns= rubyBackgroundVpnOwnsRoute(snapshot.vpnService),backgroundRunning=backgroundKnown&&snapshot.vpnService.running;
  const rx=rubyTrafficSample(vpnVerified,snapshot.trafficSampleReceived,snapshot.traffic?.rx);
  const tx=rubyTrafficSample(vpnVerified,snapshot.trafficSampleReceived,snapshot.traffic?.tx);
  const dnsActive=rubyDnsReady(snapshot.systemDoh);
  const zapretActive=rubyZapretReady(snapshot.zapret);
  const telegramActive=rubyTelegramReady(snapshot.telegram);
  const anyActive=vpnRunning||backgroundRunning||dnsActive||zapretActive||telegramActive;
  const allKnown=backgroundKnown&&[snapshot.vpn,snapshot.systemDoh,snapshot.zapret,snapshot.telegram].every(rubyStatusKnown);
  const nodes=O.useMemo(()=>pm(snapshot.state?.nodes),[snapshot.state?.nodes]);
  const activeNode=nodes.find(node=>node.id===snapshot.state?.activeNodeId);
  const ip=Q(vpnVerified?snapshot.vpn?.egressIp:null,snapshot.myIp?.ip,snapshot.network?.publicIp,snapshot.health?.publicIp);
  const region=Q(snapshot.myIp?.country,snapshot.myIp?.countryCode,snapshot.network?.region);
  const provider=Q(snapshot.myIp?.provider,snapshot.network?.provider,snapshot.network?.isp);
  const route=snapshot.routeProbe?.route??snapshot.routeProbe;
  const routeDns=snapshot.routeProbe?.dns;
  function probe(){setProtectionOpen(true);return runAction('route-probe',async()=>{const [route,dns]=await Promise.all([Z('system.routeProbe',api?.system?.routeProbe),Z('system.dnsLeakTest',api?.system?.dnsLeakTest)]);return {route,dns}},'Проверка маршрута завершена')}
  function connect(){
    if(backgroundOwns){onNavigate('vpn');return}
    if(!vpnKnown)throw new Error('Состояние VPN не проверено. Дождитесь ответа службы.');
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
    return runAction('zapret-quick-start',()=>rubyStartZapret(api,profile),'Готовность профиля подтверждена');
  }
  function toggleTelegram(){
    if(!telegramActive&&!snapshot.telegram?.serviceInstalled){onNavigate('telegram-proxy');return}
    return runAction(telegramActive?'tg-stop':'tg-start',()=>telegramActive?Z('telegramProxy.stop',api?.telegramProxy?.stop):Z('telegramProxy.start',api?.telegramProxy?.start),telegramActive?'Telegram Proxy остановлен':'Telegram Proxy запущен');
  }
  function restore(){confirmAction('Восстановить настройки','Egoist Lagom вернёт исходный системный прокси и проверит доступ к сети. Настройки DNS, Telegram и сторонних программ сохранятся.','Восстановить',()=>runAction('internet-fix',()=>Z('system.internetFix',api?.system?.internetFix),'Восстановление завершено'))}
  const components=[{id:'dns',title:'DNS',description:'Шифрование DNS-запросов',icon:'dns',active:dnsActive,status:snapshot.systemDoh,pending:rubyBusy(snapshot,'doh-apply','doh-reset'),toggle:toggleDns},{id:'zapret',title:'Профили DPI',description:snapshot.zapret?.serviceInstalled?'Фоновая служба Windows':'Временный запуск до выхода из приложения',icon:'zapret',active:zapretActive,status:snapshot.zapret,pending:rubyBusy(snapshot,'zapret-quick-start','zapret-standalone','zapret-stop'),toggle:toggleZapret},{id:'telegram-proxy',title:'Telegram',description:'Локальный прокси для Telegram',icon:'telegram',active:telegramActive,status:snapshot.telegram,pending:rubyBusy(snapshot,'tg-start','tg-stop'),toggle:toggleTelegram}];
  return <div className="ruby-dashboard">
    <header className="ruby-dashboard-heading ruby-page-heading"><div><h1>Обзор</h1></div><span className={'ruby-connection-summary'+(anyActive?' active':'')}><i/>{!allKnown?'Есть непроверенные компоненты':anyActive?'Есть активные подключения':'Компоненты выключены'}</span></header>
    <section className="ruby-connection-panel" aria-label="Подключение">
      <div className="ruby-connect"><img className="ruby-connection-mark" src="./assets/icons/brand-shield.svg" alt="" aria-hidden="true"/><div className="ruby-connect-body"><h2>{snapshot.busy==='vpn-disconnect'?'Отключение VPN…':vpnBusy?'Подключение VPN…':backgroundOwns?backgroundRunning?'Фоновая служба VPN работает':'Служба VPN не готова':!vpnKnown?'VPN не проверен':vpnVerified?'Маршрут VPN подключён':vpnRunning?'Проверяем маршрут VPN':vpnFailed?'VPN не подключён':'VPN отключён'}</h2><p>{backgroundOwns?'Внешний маршрут требует отдельной проверки':!vpnKnown?(snapshot.vpn?.uiObservation?.error||'Ожидаем актуальное состояние'):vpnVerified?'Внешний маршрут подтверждён':vpnRunning?'Проверяем внешний адрес и маршрут':vpnFailed?'Повторите попытку или выберите другой сервер':'Выберите сервер для подключения'}</p><button className="ruby-server-select" onClick={()=>nodes.length?setServersOpen(true):onNavigate('vpn')}><RubyIcon name="vpn"/><span>{activeNode?dm(snapshot.vpn,snapshot.state):'Выбрать сервер'}</span><RubyIcon name="chevron-down" size={16}/></button><button className="btn-primary ruby-connect-button" disabled={vpnBusy||!backgroundKnown||(!backgroundOwns&&!vpnKnown)} aria-busy={vpnBusy} onClick={connect}><RubyIcon name="power" size={19}/>{vpnBusy?'Пожалуйста, подождите':backgroundOwns?'Управление VPN-службой':!vpnKnown||!backgroundKnown?'Ожидаем проверку':vpnRunning?'Отключить VPN':'Подключить VPN'}</button>{vpnVerified&&<small className="ruby-uptime">Подключено {Im(snapshot.vpn?.uptimeMs??snapshot.vpn?.startedAt)}</small>}</div></div>
      <aside className="ruby-network"><dl>{[['Ваш IP',ip],['Провайдер',provider],['Регион',region],['Протокол',activeNode?.protocol?.toUpperCase()]].map(([label,value])=><div key={label}><dt>{label}</dt><dd title={value??''}>{value??'Не определено'}</dd></div>)}</dl><div className="ruby-route-status"><RubyIcon name={vpnVerified?'check':'zapret'} size={22}/><div><h3>{vpnVerified?'Выход подтверждён':snapshot.busy==='route-probe'?'Проверяем выход…':route?'Результат проверки':'Выход не проверен'}</h3><p>{vpnVerified?'Внешний маршрут прошёл проверку':'Проверьте точку выхода в интернет'}</p></div></div><button className="btn-secondary" disabled={snapshot.busy==='route-probe'} onClick={probe}>Проверить</button></aside>
    </section>
    <section className="ruby-components" aria-label="Сетевые компоненты"><h2>Компоненты</h2><div className="ruby-component-list">{components.map(({id,title,description,icon,active,status,pending,toggle})=>{
      const display=rubyComponentStatus(status,active,pending);
      return <article key={id} data-state={display.tone}><RubyIcon name={icon} size={24}/><div className="ruby-component-copy"><div className="ruby-component-heading"><h3>{title}</h3><span className={'ruby-component-status '+display.tone}>{['error','degraded','unknown'].includes(display.tone)&&<RubyIcon name={display.tone==='unknown'?'help':'warning'} size={13}/>}<span>{display.label}</span></span></div><p>{description}</p>{display.detail&&<details className="ruby-component-details"><summary>Подробности</summary><p>{display.detail}</p></details>}{status?.uiObservation?.lastConfirmedAt&&<small className="ruby-observation-time">Проверка {new Date(status.uiObservation.lastConfirmedAt).toLocaleTimeString('ru-RU')} · #{status.uiObservation.generation}</small>}</div><button className="btn-secondary ruby-configure" aria-label={'Настроить '+title} onClick={()=>onNavigate(id)}>Настроить</button><button role="switch" aria-label={title} aria-checked={active} aria-busy={pending} className={'ruby-toggle'+(active?' active':'')} disabled={!rubyStatusKnown(status)||!!snapshot.busy} onClick={toggle}><span className="ruby-toggle-track"><i/></span><span>{pending?'…':display.tone==='unknown'?'?':active?'Вкл':'Выкл'}</span></button></article>;
    })}</div></section>
    <section className="ruby-traffic" aria-label="Трафик"><div className="ruby-traffic-heading"><RubyIcon name="activity"/><div><h2>Трафик</h2><small>{vpnVerified?'Трафик маршрута':'Соединение отключено'}</small></div></div><div className="ruby-metric"><span>Входящий</span><strong><RubyIcon name="download" size={17}/>{rx===null?(vpnVerified?'Нет данных':'—'):Gm(rx)+'/с'}</strong></div><div className="ruby-metric"><span>Исходящий</span><strong><RubyIcon name="upload" size={17}/>{tx===null?(vpnVerified?'Нет данных':'—'):Gm(tx)+'/с'}</strong></div><button className="btn-secondary" disabled={snapshot.busy==='speedtest'} onClick={()=>runAction('speedtest',()=>Z('system.speedtest',api?.system?.speedtest),'Замер скорости выполнен')}><RubyIcon name="speedtest"/>{snapshot.busy==='speedtest'?'Измеряем…':'Измерить скорость'}</button></section>
    <button className="ruby-recovery" disabled={snapshot.busy==='internet-fix'} onClick={restore}><RubyIcon name="restore"/>Восстановить интернет</button>
    <ShieldSpeedPanel onClose={onCloseSpeedPanel} open={speedPanelVisible&&(snapshot.busy==='speedtest'||!!snapshot.speedtest)} progress={snapshot.speedProgress} result={snapshot.speedtest}/>
    <ShieldProtectionPanel dns={routeDns??null} route={route??null} open={protectionOpen&&(snapshot.busy==='route-probe'||!!snapshot.routeProbe)} onClose={()=>setProtectionOpen(false)} onProtectionAction={action=>{const key=pp(action);if(key==='повторить проверку')return probe();setProtectionOpen(false);if(key==='восстановить интернет')return restore();if(key==='применить маршрут заново')return runAction('vpn-reapply-route',()=>Z('system.reapplyRoute',api?.system?.reapplyRoute),'Маршрут применён повторно');onNavigate(key.includes('dns')?'dns':'vpn')}}/>
    {serversOpen&&<ShieldServerPicker nodes={nodes} activeId={activeNode?.id} onClose={()=>setServersOpen(false)} onManage={()=>{setServersOpen(false);onNavigate('vpn')}} onSelect={node=>{setServersOpen(false);runAction('vpn-select',()=>Z('node.select',api?.node?.select,node.id),'Сервер выбран')}}/>}
  </div>;
}
function ShieldServerPicker({nodes,activeId,onClose,onManage,onSelect}){
  const dialog=O.useRef(null);
  const [query,setQuery]=O.useState(''),[page,setPage]=O.useState(0);
  const filtered=O.useMemo(()=>rubyFilterServers(nodes,query),[nodes,query]);
  const slice=rubyServerPage(filtered,page);
  O.useEffect(()=>{const previous=document.activeElement;dialog.current?.querySelector('button')?.focus();const key=e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const items=Array.from(dialog.current.querySelectorAll('button:not(:disabled)'));const index=items.indexOf(document.activeElement);if(e.shiftKey&&index===0){e.preventDefault();items.at(-1)?.focus()}else if(!e.shiftKey&&index===items.length-1){e.preventDefault();items[0]?.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus?.()}},[]);
  return <div className="ruby-modal-layer" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="ruby-modal" ref={dialog} role="dialog" aria-modal="true" aria-label="Выберите сервер"><header><div><h2>Выберите сервер</h2><p>Выбор сохраняется для следующего подключения</p></div><button className="ruby-close" aria-label="Закрыть выбор сервера" onClick={onClose}><RubyIcon name="close" size={18}/></button></header><label className="ruby-server-search"><span>Найти сервер</span><input className="input" type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(0)}} placeholder="Название, страна или адрес"/></label><div className="ruby-server-list">{slice.rows.length?slice.rows.map(node=><button key={node.id} aria-pressed={node.id===activeId} onClick={()=>onSelect(node)}><RubyIcon name="vpn"/><span>{Kd(node.name??node.remark??node.id)}<small>{node.protocol?.toUpperCase()??'Сервис'}{node.country?' · '+node.country:''}</small></span><RubyIcon name={node.id===activeId?'check':'arrow-right'} size={18}/></button>):<p className="ruby-list-empty">Нет серверов по этому запросу.</p>}</div><RubyServerPages slice={slice} onChange={setPage}/><button className="btn-secondary" onClick={onManage}>Управление серверами и подписками<RubyIcon name="arrow-right" size={16}/></button></section></div>;
}

function ap({ activeScreen, activity, children, onAppInfo, onDismissActivity, onNavigate, snapshot }) {
  const [widgetMode, setWidgetMode] = O.useState(true);
  const [reducedMotion, setReducedMotion] = O.useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  O.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

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
      <Tl reducedMotion="user" skipAnimations={reducedMotion}><main className="shield-widget-window">
        <ShieldWidget
          snapshot={snapshot}
          onOpenSettings={() => {
            onNavigate?.('settings');
            setWidgetMode(false);
          }}
        />
      </main></Tl>
    );
  }

  return (
    <Tl reducedMotion="user" skipAnimations={reducedMotion}><main className="app-shell" data-busy={snapshot?.busy ?? ''} data-screen={activeScreen}>
      {O.createElement(sp, {activeScreen, onAppInfo, onNavigate, snapshot, onSwitchToWidget: () => {
        setWidgetMode(true);
      }})}
      <section className="workspace"><RubyReadNotice snapshot={snapshot} activeScreen={activeScreen}/>{children}</section>
      {O.createElement(op, {activity: activeScreen === 'dashboard' && activity?.id === 'speedtest' ? null : activity, onDismiss: onDismissActivity})}
    </main></Tl>
  );
}
