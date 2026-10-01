# Native gate фонового VPN

Подготовлен исполняемый тест настоящего установленного приложения: [windows-vpn-native-acceptance.ps1](../../tests/windows-vpn-native-acceptance.ps1). Его native `Run` ещё не выполнен. Принятые локальные проверки находятся в [vpn-native-gate-validation.json](vpn-native-gate-validation.json); в этом receipt явно указано `nativeAcceptancePassed=false` и `nativeGateStatus=prepared-not-executed`.

Финальный проверяемый runtime — **sing-box 1.14.0**, `81,819,136` байт, SHA256 `aad0ede010eafa7b277e520464f3a66fde820103d737eff739f40f3cc9451dcc`. Gate читает manifest и инвентарь фактически установленного authenticated payload, сверяет весь payload, fuses, ASAR header и worker inventory существующим штатным verifier. Старый `recovery/official-app` с 1.13.12 является baseline; предыдущий Inspect receipt не доказывает финальный installed payload.

## Допуск и запуск

Тест допускает только Windows x64, PowerShell 7, повышенного runner и точные GitHub-hosted признаки репозитория `egoist-ai1/egoist-lagom`; source commit должен совпадать с actual HEAD/GITHUB_SHA. Все файлы gate/ordinary GUI helpers должны входить в этот commit без diff. Он отказывает физическому host до записи файла, запуска GUI, обращения к SCM, изменения DNS, маршрутов или clipboard. `GuardOnly` не делает изменений.

До запуска основной acceptance должен установить exact signed candidate, полностью восстановить свой DNS и создать обычный основной work `RUNNER_TEMP/lagom-native-<run>-<attempt>`. Gate требует отсутствующую VPN-службу, защищённый snapshot, TUN и owned runtime/listener; обычный GUI-профиль не должен содержать старые узлы/правила, autoconnect, custom runtime, kill switch или tray close. Работающие DPI/SystemDoH предварительно исключаются. Другие baseline product services сохраняются.

```powershell
pwsh -NoProfile -File tests/windows-vpn-native-acceptance.ps1 `
  -Mode Run `
  -IntegrityManifestPath $manifestPath `
  -ExpectedSourceCommit $env:GITHUB_SHA
```

Необязательный `-EvidenceDirectory` разрешён только внутри `RUNNER_TEMP/lagom-native-<run>-<attempt>/vpn-native`; по умолчанию это его `evidence`. Основной receipt — `vpn-native/evidence/vpn-native-receipt.json`. Parent CI ограничивает child 1200 секундами. Node fixture/control watcher имеют отдельные конечные leases; ordinary GUI использует существующий guardian с lease 540 секунд.

## Что gate действительно проверяет

1. Через существующий [ordinary GUI lease](../../tests/windows-ordinary-gui.ps1) запускается только canonical installed `EgoistShield.exe`, с пустым argv и фактически измеренным medium token без enabled Administrators/elevation/UIAccess. UIAutomation работает в точном окне этого процесса. CDP, renderer JS evaluation, admin mutation CLI, подмена state/config и test hooks не используются.
2. Настоящие контролы GUI сохраняют `selected`, `system` и единственное правило `LagomVpnNativeProbe.exe → vpn`. Реальный clipboard-import добавляет единственный loopback SOCKS-узел. Harness только читает сохранённый профиль. Actual frozen production schemas/ConfigBuilder создают preflight **в own work**, затем настоящий pinned `sing-box check` принимает его до подтверждения установки TUN.
3. Установка происходит настоящей кнопкой/подтверждением. Независимое чтение требует SCM `Automatic + LocalSystem`, точный pinned WinSW → fixed installed Core `--run-vpn-runtime` → pinned sing-box `run -c` protected path, действительный процесс и время создания, private SY/BA ACL и exact immutable snapshot/config SHA из genuine UI preflight. Штатный Core CLI используется только для read-only наблюдения состояния.
4. Требуются настоящий `egoist-vpn` адаптер/адрес `172.19.0.1/30`, реальный выбранный маршрут synthetic адреса и listener `127.0.0.1:10838`, принадлежащий проверенному sing-box. Отдельный [plain TCP probe](../../tests/windows-vpn-native-probe.cs) без proxy-настроек обращается к `198.18.0.254:19080`. Реальный loopback SOCKS peer возвращает свежий непредсказуемый nonce. OS socket ownership связывает живой probe, sing-box и peer; старый ответ другой generation не принимается.
5. После штатного закрытия GUI должен полностью исчезнуть, service/runtime generation сохраниться, а новый nonce пройти. Затем завершается только held handle точно проверенного WinSW. Требуются новый SCM PID, более новые реальные wrapper/runtime creation times, завершённые старые held процессы, настоящая readiness/TUN и ещё один nonce без GUI.
6. Вновь открытый ordinary GUI штатно выключает и удаляет службу. Проверяются `Stopped + Disabled`, выключенный persisted intent, отсутствующие listener/runtime/TUN, точное восстановление baseline DNS/default/all routes/proxy/IPv6, затем отсутствие SCM и snapshot. Other baseline product service states/start/path/account не должны измениться.

SOCKS peer — контролируемая protocol integration fixture: принимает только фиксированный synthetic адрес, не делает внешний dial и не задаёт readiness приложения. Это проверка реальной границы TUN → sing-box → SOCKS; доступность стороннего VPN-провайдера и его внешний IP она не доказывает.

## DNS и аварийное завершение

До, во время и после TUN выполняются реальные DNS и HTTPS canaries, отдельно от probe. DNS использует Windows `DnsQuery_W` с `BYPASS_CACHE|NO_HOSTS_FILE|WIRE_ONLY|TREAT_AS_FQDN` (`0x1148`) для `github.com.`; сохранённый ответ resolver cache не может заменить такой запрос. Эти flags и освобождение native record chain сверены с [Microsoft DNS options](https://learn.microsoft.com/en-us/windows/win32/dns/dns-constants), [DnsQuery_W](https://learn.microsoft.com/en-us/windows/win32/api/windns/nf-windns-dnsquery_w), [DnsFree](https://learn.microsoft.com/en-us/windows/win32/api/windns/nf-windns-dnsfree).

Независимый control watchdog регулярно проверяет неизменные physical DNS/default routes/proxy/IPv6 и HTTPS `github.com/robots.txt` с проверенным TLS, новым curl process и явно отключённым proxy. Требуется sample внутри реально наблюдаемого интервала active TUN и новый sample после UI OFF. Это тест GitHub control path; сохранение всех возможных внешних endpoints не заявляется.

При отказе watchdog gate немедленно становится failed. Disposable emergency cleanup разрешает только previously absent fixed pinned `EgoistShieldVpn`: сначала Disabled с readback, затем stop, при зависании — exact verified wrapper handle. Core supervisor в production пропускает Disabled; recovery repair его не переводит в Auto. Если уже выполнявшаяся установка повторно включит Auto, только в failed cleanup разрешён нормальный stop точно проверенного pinned Core, затем повторный OFF и стабильный readback. Failure/recovery policy не отключается, wildcard kills нет. Emergency cleanup никогда не считается доказательством normal UI OFF или успешным native acceptance. Её native ветка также пока не исполнена.

Жёсткое внешнее завершение самого harness может прервать finally/watchdog; этот случай не объявляется доказанно очищенным. VM одноразовая, а native receipt не становится passed при timeout, неизвестном состоянии, failed guardian или cleanup.

## Принятые локальные проверки

| Проверка | Результат | Практическая граница |
| --- | --- | --- |
| PowerShell parser | 0 ошибок | Синтаксис, не SCM/TUN |
| Pure hosted guard matrix | 11/11 | Валидные/невалидные env, platform и privilege inputs |
| Actual physical `Run` | Refused before write | Нет физической установки/GUI/SCM/TUN/DNS setting mutations |
| Pre-enable config safety | 11/11 | Reject global/proxy DNS/extra process/domain/unsafe listener/target/route changes |
| Real SOCKS fixture | 9/9 sockets | IPv4/domain framing, fragmented greeting, auth/command/target refusal |
| Compiled real plain TCP child | 5/5 sockets | Correct nonce; wrong nonce/generation/status/truncated response rejected |
| Windows native argv reader | 1/1 | Реальный CommandLineToArgvW, не SCM identity |
| Read-only wire DNS | Ответ A получен | Actual DnsQuery_W, без изменения настроек DNS |
| Final pinned 1.14 native config checks | 2/2 | Принимается generated config; runtime TUN ещё не запущен |

SHA256 исполняемых исходников:

- `windows-vpn-native-acceptance.ps1`: `A8B611082EC04C7053079D511F29685926257B55A174A1CD844AC9A49784AF3A`
- `windows-vpn-native-probe.cs`: `427D28CCBF6D1E1FD20AA302FDE01BB7E44F458E4BF774086F3C73B3A6CECBFF`
- `windows-vpn-production-acceptance.mjs`: `29A6DB9DCD3AF7C826C6B2326BFE5A83D5A3634C8CB336183206D7121E0FBF35`

Два config checks инспектировали точные git blobs `62f0f2ecd06dbcb68e3a37ec8937dc74448d0c77`. На нём новые UI controls ещё не входили в commit; actual browser AX evidence новых штатных controls принадлежит UI owner. Native `Run` потребует нового final commit и Windows UIA mapping на настоящем hosted installed candidate. SCM/TUN/recovery/normal OFF/emergency cleanup, reboot и продолжительный pilot остаются открытыми gates. Локальные PASS не заменяют их и не подтверждают непрерывную работу месяцами.