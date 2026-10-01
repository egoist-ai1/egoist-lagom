# Native DNS gate для подписанного Windows candidate

Добавлен исполняемый сценарий `tests/windows-dns-native-acceptance.ps1`, read-only сетевой/parser helper `.mjs` и безопасные guard/protocol тесты. Production, основной acceptance, workflow, UI и legacy helper этим участком не изменялись. Основной сценарий должен запускать DNS gate отдельным процессом после установки точного candidate и до VPN/private fixture/reinstall.

На Windows Server 2022/Windows 11 и новее текущий System DoH использует штатный Windows DNS Client под управлением защищённого Core. Отдельная SCM-служба SystemDoH для этого режима не устанавливается. Этот gate не распространяет результат на Windows 10 и старый локальный resolver.

## Вход и запуск

Нужны настоящий disposable **GitHub-hosted Windows** runner репозитория `egoist-ai1/egoist-lagom`, elevated PowerShell 7 x64, Node с установленными зависимостями, доступный SDK через существующий `SHIELD_DOTNET`, уже установленный canonical candidate и source-bound `package-integrity.json`. Expected SHA должен быть именно текущим `GITHUB_SHA`. Полные payload bytes, GUI/Worker fuses, ASAR integrity, PE `asInvoker`, forced elevation flags и защищённые ACL проверяются существующими acceptance helpers.

```powershell
$dnsEvidence = Join-Path $env:RUNNER_TEMP (
  'lagom-native-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT + '\dns-native\evidence'
)
pwsh -NoLogo -NoProfile -NonInteractive -File tests/windows-dns-native-acceptance.ps1 `
  -IntegrityManifestPath $absoluteCandidateIntegrityManifest `
  -ExpectedSourceCommit $env:GITHUB_SHA `
  -EvidenceDirectory $dnsEvidence `
  -Provider Cloudflare
```

`IntegrityManifestPath` обязан быть обычным файлом внутри реального `GITHUB_WORKSPACE`. Directory `RUNNER_TEMP\lagom-native-<run>-<attempt>\dns-native` должен отсутствовать до запуска. Все child receipts, logs, plans, captures и options остаются внутри этого нового каталога. `EvidenceDirectory` может быть опущен — используется `dns-native\evidence`. Есть второй проверенный production-профиль `-Provider Quad9`; произвольные серверы, URL и install roots не принимаются. Скрипт следует запускать отдельным процессом: dot-source в основной acceptance подменил бы его `script:Receipt/Work`.

`-Mode GuardOnly` выполняет реальную hosted/admin/source/path проверку без создания файлов и сетевых изменений. `QueryProbe` и `EmergencyGuardian` — внутренние дочерние режимы того же строгого host guard. `-LibraryOnly` только загружает определения для harmless тестов.

Перед изменением DNS gate отвергает существующие DNS/VPN intents, legacy/shared services, product recovery Tasks, NRPT, неоднозначный набор целевых адаптеров/default route, loopback DNS, занятую или неизвестную конфигурацию Pktmon и чужой DoH template для выбранного IP. Допускаются точные проверенные Core и уже provisioned Telegram. Без поддерживаемых cmdlets, полного исходного inventory, фактического HTTPS control connection процесса Actions runner и успешного независимого TLS/DNS-wire preflight ко всем выбранным адресам изменение DNS не начинается.

## Что проверяет настоящий прогон

1. Независимо снимает исходные per-GUID DNS addresses и static/DHCP values обеих семей, все доступные DoH entries, relevant DoH/NRPT registry trees, default routes, IPv6 bindings, user/WinHTTP proxy, определения Tasks и product service registrations. Проверяет разрешение `api.github.com`/`github.com`, TCP443 по полученным IP, HTTPS и существующие HTTPS connections настоящих `Runner.Listener.exe`/`Runner.Worker.exe`. Tokens, cookies и HTTP headers не записываются.
2. Через существующую ordinary GUI lease запускает настоящий установленный GUI с **пустыми argv**, medium integrity, выключенной группой Administrators, `elevated=false`, `uiAccess=false`. UIA привязан к его проверенным PID/start time/HWND. Начальный widget раскрывается настоящими «Настройки», затем «DNS». ValuePattern вводит разрешённый HTTPS в «Одна DNS-строка»; InvokePattern нажимает «Подключить ссылку». CDP, admin GUI, dev clients, mutating CLI и state overrides отсутствуют.
3. Требует настоящие per-adapter DNS addresses и Windows DoH API entries с правильным HTTPS template, `AutoUpgrade=true`, `AllowFallbackToUdp=false`. Требует private Core `native-doh-state.json` с canonical SYSTEM/Administrators ACL, строгим owner/schema/provider и исходным adapter baseline, совпадающим с независимым inventory. Чужие adapters, proxy, default routes, IPv6 bindings, Tasks и DoH entries должны сохраняться.
4. Закрывает GUI обычным WindowPattern, требует normal exit и zero-orphan cleanup. Без GUI делает настоящий `DnsQuery_W` через Windows DNS Client с `BYPASS_CACHE | NO_HOSTS_FILE | NO_MULTICAST`: положительный A-ответ и свежий случайный NXDOMAIN. Отдельный owned query child имеет 25-секундный предел.
5. Pktmon captures ограничены выбранными resolver IP и портами **53/443**, NICs, 256 bytes per packet, 1 MiB ETL и коротким окном проб. Parser требует двусторонние TLS application records на одном resolver flow во время запросов и отвергает matching plaintext probe на 53. Неизвестный link layout, truncation, неподтверждённый transport или ошибочная native API query дают отказ.
6. Завершает только held/hash/path/birth-verified принадлежащий candidate Core, наблюдает настоящий новый SCM PID и проверенную pipe identity. Снова требует private intent, DNS/API policy, успешные Windows запросы и provider TLS без GUI. SCM `Running` не считается проверкой DNS или HTTPS.
7. Повторно открывает настоящий ordinary GUI: «DNS» → «Отключить DoH» → «Отключить». Требует исчезновение protected DNS ownership, точное восстановление исходных DNS/DoH API/registry/static-DHCP choices и unrelated inventory, working control connections, нормальный exit GUI и продолжающий работу Core.

Политика Windows и wire observation записываются раздельно. Pcap не расшифровывает TLS и не выдаётся за серверный журнал DoH. Наблюдаемые provider TLS records вместе с forced Windows DNS replies и запретом unencrypted fallback подтверждают применённый transport в рамках этого запуска; содержимое TLS остаётся непрочитанным. [Microsoft: DoH auto-upgrade и fallback](https://learn.microsoft.com/en-us/powershell/module/dnsclient/set-dnsclientdohserveraddress?view=windowsserver2025-ps), [Windows DNS API](https://learn.microsoft.com/en-us/windows/win32/api/windns/nf-windns-dnsquery_w), [Pktmon capture bounds](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/pktmon-start), [pcapng conversion](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/pktmon-etl2pcap).

## CI аварийная страховка

Перед реальным UI apply отдельный hidden процесс вооружается immutable SHA-bound планом внутри нового owned work. Он следит за точным parent PID/birth, heartbeat (180 s), explicit failure и максимальной lease (1200 s). Обычный успех разоружает его только после независимого baseline readback. Сначала при ошибке делается попытка восстановить DNS настоящим ordinary GUI; если исходное состояние уже неизменно, дополнительные действия не нужны.

При аварии guardian делает **обычный SCM stop только точного source/hash/path/process-verified `EgoistShieldCore`**, чтобы running Core не создавал отсутствующие owned DoH entries заново. Нет wildcard termination, `Kill`, отключения recovery policy или изменений других служб. Затем он сравнивает текущие provider DNS addresses/static choice по сохранённому GUID и DoH template/fallback/auto-upgrade с test post-state. Восстанавливает только совпавшие принадлежащие тесту изменения. Index reuse и чужие последующие updates сохраняются. Production intent не редактируется. Receipt перечисляет каждое действие, preserved foreign state, фактический inventory readback и stopped-on-failure Core.

Любое применение guardian, timeout, неизвестный cleanup либо несовпадение baseline означает **failed gate**; это не способ получить PASS. После failure runner должен быть выведен из эксплуатации, основной job не продолжает другие mutating gates. Normal PASS восстанавливает настройки через GUI и сохраняет Core Running. Pktmon удаляет только свои точные named filters; исходная foreign capture/session не трогается.

## Реально выполнено при подготовке

На физическом компьютере: **SCM/DNS/Task/registry/host ACL changes — 0; native installer/DNS acceptance runs — 0**. Изменялись только новые исходники и собственные fixture/runtime files. Native DNS query не исполнялась.

Node 24.19.0: **8/8 tests PASS, 0 skips** с PowerShell 7.6.5 (5025.9481 ms) и штатным Windows PowerShell 5.1 (2134.1585 ms). Это безопасные проверки parser/контрактов, а не installed acceptance:

- Реальный вызов всех четырёх public/internal execution modes отвергает фактический non-hosted процесс до чтения inputs или записи.
- Library import не обращается к SCM/Tasks. Реальные собственные file/junction cases проверяют запрет reparse ancestry и path escape; junction удаляется без рекурсии с сохранением target. Реальный извлечённый native-query C# компилируется, но не вызывается.
- DNS wire parser отвергает wrong ID/question/rcode/TC/size. Инертные pcapng bytes проверяют оба endianness, provider/time/flow binding, отсутствие ложного PASS по TCP443, plaintext question и malformed/oversized captures. Эти bytes не обозначаются native packet evidence.

PowerShell parser — **0 errors**, JavaScript syntax checks — PASS, scoped diff whitespace check — PASS. PSScriptAnalyzer имеет 7 `PSReviewUnusedParameter` advisory: параметры фактически используются из функций script scope, статический анализатор не считает эти обращения top-level use. Других findings нет.

Frozen локальные байты:

| Файл | SHA-256 |
| --- | --- |
| `tests/windows-dns-native-acceptance.ps1` | `66aa8c90b7a7516d7c4562857dda9a2f6a8c8fd78ca7cbb0b4a8a2e1e79b4d29` |
| `tests/windows-dns-native-acceptance.mjs` | `37475f591f23b6b04a59bb0083fb8cae9242a8911f2b371adc255086ae8d7c4d` |
| `tests/windows-dns-native-guard.test.mjs` | `484939e5701bd6fa476197a6786cc9a23e59d168c8ac85ea792b04c8fe95927a` |

Actual native receipt сохраняет текущие checkout/helper hashes, source commit, integrity SHA, mutations, API readbacks и отдельные query/transport observations. Git checkout newline normalization может менять локальный byte hash; поэтому runner записывает свои фактические байты.

Нативный результат появится только после запуска root в disposable Windows CI на новом подписанном package. Actual reboot, adapter removal/reconnect/DHCP renewal, custom-hostname bootstrap rotation, Windows 10 local resolver и длительный pilot остаются отдельными gates; этот короткий прогон не доказывает месяцы непрерывной работы. `releaseReady` намеренно остаётся false даже при PASS этого DNS scope.
