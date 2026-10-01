# Оригинальные Setup: DNS failure и следующий native gate

[Run 36839550966](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36839550966) использовал harness `5086586140306a7401ebe6d52e94211b2278633e` и неизменённый подписанный кандидат из source `466862cc00b36277460ccc94cb47f4df891ac14b`. [Принятые данные](native-466862-original-diagnostics-5086586/summary.json) подтверждают отказ **обоих оригинальных установщиков** с кодом 41; новая 3.8.0 не устанавливалась в этих двух diagnostic cases.

| Оригинал | Setup SHA256 | Последний PreInstall stage | Итог |
| --- | --- | --- | --- |
| 3.7.8, подписанная локальная generation | `34136729f0924e95af65b7fefd2792763c29694056b8ff76a79c9fe0e325f927` | `service-registrations-backed-up`, services=0 | 41, затем RollbackUpgrade, networkPreserved=true |
| 3.7.9, исходная публичная generation | `eb8db40e80201f5e9bf153368da8131325c0253bbc13a842c95f3f2725e04cc6` | `service-registrations-backed-up`, services=0 | 41, затем RollbackUpgrade, networkPreserved=true |

В обоих журналах отсутствует `network-baseline-captured`. Имеются `service-registrations-restored` и `optional-runtime-restored`; это не полный upgrade PASS. `networkPreserved=true` относится к измеренным DNS/routes/IPv6/proxy fingerprint, а не к доказательству всех возможных системных свойств.

## Факт запроса и причинная граница

[Настоящий readback 3.7.9](native-466862-original-diagnostics-5086586/old379/original-network-readback.stdout.txt), выполненный Windows PowerShell **5.1.26100.33438**, воспроизводит точный original uplink filter и запросы:

* Up `Ethernet 4`, index 4: IPv4 и IPv6 дают `CmdletizationQuery_NotFound,Get-DnsClientServerAddress`; это отсутствие matching row, а не тайм-аут.
* Up `vEthernet (nat)`, index 11, и `Ethernet 3`, index 14: оба семейства возвращают по одной row. Пустой список серверов в существующей row допустим.
* Probe выполнял только чтение; `networkMutations=0`. Он запущен после отказа Setup и сбора журнала.

Оба pinned EXE здесь проверены и без исполнения из них извлечён original `$PLUGINSDIR/owned-cleanup.ps1`. **Байты helper идентичны**: 190567 байт, SHA256 `c7eca1981c0aa2eb237f1db29c0acfa2fe62a0756ef292efb97339815011f44e`. Его `Save-SystemNetworkBaseline` (1602/1604) требует отдельную row каждого семейства с `ErrorAction Stop`; вызов расположен сразу после service backup (3534/3535), до stop/reset (3538). При измеренном Up index 4 эта операция неизбежно прерывает baseline.

Следовательно, **несовместимость старого DNS snapshot с реально наблюдённым интерфейсом подтверждена прямыми запросами** и согласуется с обоими журналами. Внутренний stderr именно NSIS child PreInstall всё ещё не сохранён; post-failure readback не доказывает, что topology перед самым запросом была идентичной, и для 3.7.8 отдельного native probe нет. Полная атрибуция конкретного thrown exception остаётся обоснованным выводом, а не прочитанным stack trace. Уже достаточно данных, чтобы не повторять тот же старый Setup на том же несовместимом образе без новой проверки предпосылок.

## Практический следующий запуск

Рекомендация — сохранить fresh 3.8.0 на `windows-latest`, а **только обе legacy upgrade cases** проверить на обычном GitHub-hosted **`windows-2022`**. GitHub предоставляет этот label как стандартную x64 Windows VM; официальный runner-images каталог связывает его с Server 2022, а нынешний `windows-latest` — с Server 2025. Это реальный другой OS образ без замены старых Setup/helper и без изменения чужих адаптеров. [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [официальные labels](https://github.com/actions/runner-images/blob/main/README.md).

`windows-2022` фиксирует OS family, не конкретный build и не NIC topology. Образы обновляются, а actual версию следует брать из `Set up job`, `ImageOS`/`ImageVersion` и OS readback. Просмотренный Win22 main README указывает `20260920.314.1`, а отдельный release `20260927.320.1` ещё помечен Pre-release; это не обещание, какая generation достанется следующему job. Первичные документы не гарантируют наличия DNS rows у каждого активного адаптера. [Windows 2022 inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md?plain=1), [release status](https://github.com/actions/runner-images/releases/tag/win22%2F20260927.320), [правила обновлений и actual image](https://github.com/actions/runner-images/blob/main/README.md).

Следующий root-owned запуск должен измерять последовательно:

1. На каждом fresh `windows-2022` runner записать actual image/OS/WinPS5.1/runtime и строгий clean-state guard. Перед старой установкой повторить **read-only** точный original uplink filter и обе family queries. Row count должен быть ≥1; пустые ServerAddresses допустимы. Missing row, provider failure или timeout — явная несостоявшаяся предпосылка/Unknown, без сетевого workaround и без зелёного upgrade PASS.
2. Если предпосылка выполнена, запустить **сам неизменённый оригинальный Setup**, проверенный первоначальными signatures/size/hashes. Подтвердить настоящий установленный payload, Core identity/policy, original installed helper hash. Извлечение файлов и ручная регистрация SCM не заменяют этот шаг.
3. Через настоящий разрешённый GUI/UIA включить Telegram background, проверить endpoint и private-state ACL, закрыть GUI и подтвердить работу службы. Затем выполнить настоящий original helper → подписанный кандидат, сохраняя текущие SourceSHA/asset/ownership guards, старый `NoRunAfter`, отсутствие GUI, сохранение Telegram, quiescence старых recovery mechanisms и uninstall cleanup. Gate оценивает весь переход, не только code 0 установщика.
4. Сохранить preflight, stdout/stderr, исходные журналы, before/after network и foreign service/task fingerprints на успехе и отказе. Acceptance SourceSHA не ослаблять ради старого пакета: текущая diagnostic модель уже отдельно обозначает harness508/artifact466; настоящий upgrade run должен соблюдать свой действующий source-bound контракт.

Fresh 3.8.0 на `windows-latest` отдельно продолжает проверять обработку отсутствующих DNS rows. Успех legacy на Server 2022 не подтверждает старую установку на Server 2025, Windows 10/11, публичное latest-feed обнаружение или длительную эксплуатацию. Эти фактические отказы обоих старых Setup сохраняются в отчёте.

Если `windows-2022` тоже не выполнит предпосылку, следующий результат должен быть **legacy gate unavailable/failed**, а не исключение интерфейса или замена helper. Только если нужна строгая идентификация внутренней ошибки, отдельный disposable diagnostic может выполнить точный authenticated embedded PreInstall под родным WinPS5.1 с capture stdout/stderr и rollback/network readback. Он имеет реальные подготовительные side effects, не запускается на физическом хосте и не заменяет original Setup/upgrade acceptance. Из имеющихся данных такой mutating source-phase diagnostic сейчас не требуется первым шагом.

В этом участке production, CI и физический хост не менялись; native запусков не выполнялось. Проверены source/evidence hashes и официальные primary sources. [Машинный отчёт](original-installer-dns-confirmation.json) сохраняет точные факты и ограничения.
