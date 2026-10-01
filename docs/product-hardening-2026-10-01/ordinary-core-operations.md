# Обычный GUI и привилегированные DNS-операции Core

2026-10-01. Устранён отказ пяти production-обработчиков DNS при обычном запуске установленного `asInvoker` GUI. До изменения обработчики требовали `runtimeManager.isAdmin() === true`, хотя защищённая Core уже выполняет эти операции от службы. Проверка была воспроизведена на настоящем коде обработчика: `system-doh:apply` возвращал `ok:false` с требованием запуска от администратора при `isAdmin=false`.

## Допуск и граница полномочий

| Канал | Путь production-запроса после допуска |
| --- | --- |
| `system-doh:apply` | Связанный facade SystemDoH; штатный DoH через `dns.doh.apply`, локальный/custom-port режим через фиксированный `component.execute` / `SystemDoH.apply` и типизированный `dns.apply` |
| `system-doh:reset` | Связанный facade: `dns.doh.remove` либо `dns.restore-owned` и фиксированный `SystemDoH.stopAndRemove`; восстановление сохранённого ручного DNS через `dns.apply` |
| `system-doh:restart` | Связанный facade: штатный DoH через `dns.doh.apply` либо фиксированный `SystemDoH.restart` |
| `system:set-dns-servers` | Существующий канонический CoreServiceClient, `dns.apply` |
| `system:reset-dns-servers` | Существующий канонический CoreServiceClient, `dns.reset` |

В packaged-приложении допуск выполняется до снимка DNS и остановки другого режима. Для SystemDoH требуется запись в WeakMap, созданная самим `useComponentService` после установки всех четырёх используемых wrapper-методов: status/apply/restart/stopAndRemove. Accessor проверяет тот же связанный Core-клиент и идентичность методов. Наличие произвольного поля `.coreService`, исходный незавёрнутый менеджер или заменённый wrapper права не дают. Custom-port вызов проходит через существующий fixed worker facade, а не через исходный прямой метод менеджера.

Клиент посылает только readonly `hello` с пустым payload. Допуск требует `protocolVersion:1`, `clientPid === process.pid`, `identityProbe:false`, `developmentOverride:false`. PID берётся из ответа Core, которая установила реального клиента pipe; IPC-вход от renderer не может передать свой PID или административный флаг. Это не проверка «SCM сообщил Running».

Проверенная цепочка исходников:

1. CoreServiceClient по каноническому pipe имеет `requireServerIdentity=true`. До обмена он запускает установленный фиксированный helper `--verify-pipe-server` и сверяет PID pipe-сервера с PID службы; протокол и requestId ответа также проверяются.
2. PipeServer вызывает ClientAuthorizer **до чтения и исполнения запроса**, включая `hello`.
3. ClientAuthorizer проверяет фактический PID/время запуска/SID клиента, канонический защищённый GUI в Program Files и разрешённую командную строку. Для GUI не требуется административный токен. Worker не имеет интерактивной GUI-авторизации; native helper получает только identity-probe роль.
4. OperationDispatcher отвечает на `hello` с установленными из ClientIdentity признаками клиента. Identity-probe допущен только к `hello`; новый gate отвергает эту роль и dev override. Реальная мутация повторно проходит существующую авторизацию и фиксированные типизированные Core/worker операции.

Если отсутствует зарегистрированный facade, helper/Core недоступны, Core отказывает или ответ `hello` не подтверждает текущий production GUI, обработчик возвращает `ok:false` с сообщением Core. Для DoH `status:null` означает, что состояние не проверено; фиктивное состояние «отключено/работает» не создаётся. Снимок, teardown и запись настроек до допуска не выполняются. Повышенные права у packaged GUI также не включают прямой DNS fallback при отсутствующей Core. Прямой fallback существующих manual-DNS helper остаётся только у непакетированной среды разработки после прежней административной проверки.

Существующие ветки `NODE_ENV=test` не менялись и не используются новыми регрессионными сценариями: они запускают production-ветку. Поведение установки, разрешённые Core-команды, авторизатор, main/preload/state/rules schemas и скрытая dev-авторизация в этом исправлении не изменены.

## Остальные проверки isAdmin в этом же файле

| Место | Назначение и результат аудита |
| --- | --- |
| `app:is-admin` | Диагностика реального токена GUI. Продолжает возвращать false для обычного процесса; права интерфейсу не подделяются |
| `system:terminate-conflicts` | Считывает isAdmin для поля отчёта, но не запрещает остановку собственных runtime/Core-компонентов. Проверка не удалялась |
| `system:internet-fix` | Существующий допуск admin **или** успешный `CoreServiceClient.isAvailable()`; эта функция делает настоящий identity/hello обмен. Путь смешанный: typed `network.repair-owned` плюс собственный VPN, HKCU proxy и отдельные legacy/direct шаги (в том числе KillSwitch и flushdns). Он не объявляется полностью перенесённым в Core и не изменён в этом узком исправлении |
| Новый DNS helper в development | Сохраняет `runtimeManager.isAdmin()` перед прежними прямыми административными путями |

Иных запретительных `runtimeManager.isAdmin()` guards в handlers-system после этих пяти замен не осталось. Это адресный аудит данного файла, не доказательство брокеризации всех функций приложения.

## Проверка и её пределы

**58/58 PASS, 0 пропусков**, включая 17 новых сценариев, соседние facade/DNS routing сценарии и все 30 правил/settings/StateStore проверок. `git diff --check` чистый. Хеши state-store, rules schema и preload совпали с предыдущим freeze; изменён только новый DNS gate участок handlers-system и поддерживающий accessor facade.

Новый набор исполняет настоящие recovered-модули handlers/schema/StateStore/SystemDohManager, настоящий component protocol/facade и CoreServiceClient. Клиент сохраняет канонический pipe и включённую проверку server identity; тестовый транспорт перенаправлен на собственный настоящий Windows named pipe. Фикстура подменяет только ОС-верификатор и DNS-ответы, фиксирует точные helper argv и проверяет typed worker-запросы реальным `validateComponentRequest`. Файлы StateStore записываются только в собственном каталоге задачи. Никакие установленные Core/SCM/DNS/registry не менялись.

Проверены все пять каналов при `isAdmin=false`, отсутствующий identity helper, отказ `hello`, неполный и неверный ответ, probe/dev роли, чужой PID, несовместимый внутренний протокол, простой `.coreService` на raw-менеджере и замена wrapped метода. Эти отказы не вызывают snapshot/teardown/сохранение настроек. Проверены custom-port worker, ошибка мутации без сохранения неподтверждённых настроек/production fallback, неизвестное локальное DNS-состояние, запрет даже для admin packaged GUI при отсутствующей Core и сохранённый admin development fallback.

Это **регрессия реального кода с контролируемой transport/OS фикстурой**, а не результат авторизации установленного GUI с настоящим medium-токеном. Native Windows acceptance с каноническим empty-argv GUI, UIAutomation и реальными DNS/Core readback выполняется отдельно. Положительный установленный обычный GUI здесь помечен pending; helper stdout в фикстуре не выдаётся за native ACL/PID proof. Продолжительность работы в течение месяцев этим прогоном не доказывается.

Воспроизведение из корня проекта с собственным существующим каталогом:

```powershell
$env:LAGOM_TEST_TEMP = $ownWorkDirectory
& $nodePath --test tests/ordinary-core-operations.test.mjs tests/component-facade.test.mjs tests/component-dns-routing-reliability.test.mjs tests/state-rules-patch.test.mjs tests/production-state-patch.test.mjs tests/state-store.test.mjs
```

Снимок исходников и логов; LF-хеши нормализуют только CRLF→LF:

```json
{
  "schemaVersion": 1,
  "recordedAtUtc": "2026-10-01T01:41:38.544776+00:00",
  "taskId": "01a0f42b-2910-7fe3-90ed-233033c751cb",
  "gitHeadAtReceipt": "ec975d1411fd39351bd32444e793fa01dfdea950",
  "testNodeVersion": "24.19.0",
  "platform": "Windows",
  "baseline": {
    "tests": 1,
    "pass": 0,
    "fail": 1,
    "exitCode": 1,
    "cause": "production handler refused isAdmin=false before DNS dispatch"
  },
  "finalFocusedAndAdjacent": {
    "tests": 58,
    "pass": 58,
    "fail": 0,
    "skipped": 0,
    "durationMs": 6789.1656,
    "exitCode": 0,
    "newScenarios": 17
  },
  "changedSources": [
    {
      "path": "src/component-facade.js",
      "sha256": "643410754f66f5197e930d51f8f60fb35fbe7c22b71c6141f07581d69b5f56da",
      "lfSha256": "57810649b4736f81e499b1f34832d4e2df024a8f8dca7e5cfccffbfc1e4efe94"
    },
    {
      "path": "src/recovered/electron/ipc/handlers-system.js",
      "sha256": "8d4e561c809e0acb7da47a2b25787a5bb7cc8e2a066c1f8e7aa8589b897c8fcd",
      "lfSha256": "163110b9fd3d35a58fd45815c890ba4fcef5f563f6b8318bb08863de342bee0d"
    },
    {
      "path": "tests/ordinary-core-operations.test.mjs",
      "sha256": "77487e28e0d91a1350fa9d6c07096a650be6bd73db3a0c4f5c2af25bb04f9a9a",
      "lfSha256": "77487e28e0d91a1350fa9d6c07096a650be6bd73db3a0c4f5c2af25bb04f9a9a"
    }
  ],
  "reviewedReadOnlySources": [
    {
      "path": "src/recovered/electron/ipc/port-utils.js",
      "sha256": "32353bb7641f3212d27118cc9a7e19ce4276341e2ac38b66a6e9c0635c305e98",
      "lfSha256": "32353bb7641f3212d27118cc9a7e19ce4276341e2ac38b66a6e9c0635c305e98"
    },
    {
      "path": "src/service/EgoistShield.Service/PipeServer.cs",
      "sha256": "bb573b4ea0814d5304837a209e2d7347c689fb0e02abf78134ea2fcaf6e507c7",
      "lfSha256": "c585dba848fb4bf0b166422e4a482d57cdaaf452b014568cbf56b13ac4f74cce"
    },
    {
      "path": "src/service/EgoistShield.Service/ClientAuthorizer.cs",
      "sha256": "21faaae25c505374277b241e3bee7b9190315870826f6456dcf688ae540f1b18",
      "lfSha256": "21faaae25c505374277b241e3bee7b9190315870826f6456dcf688ae540f1b18"
    },
    {
      "path": "src/service/EgoistShield.Service/OperationDispatcher.cs",
      "sha256": "37e4538c2ac091a30d52edff131afa616877d39ddf1636cea141361063edb199",
      "lfSha256": "37e4538c2ac091a30d52edff131afa616877d39ddf1636cea141361063edb199"
    },
    {
      "path": "src/recovered/electron/main.js",
      "sha256": "ab540a132a2603896106681813c60c3c0cbd303310612b6fef4eb3052e758ed1",
      "lfSha256": "d3d539be3298f104b77377510e0751a4a709ba887248362cfeaeb9edaacc51d6"
    }
  ],
  "unchangedRulesSources": [
    {
      "path": "src/recovered/electron/ipc/state-store.js",
      "sha256": "88e9244153aa07395994d9d8ef2cfad1250a286905f4175e56bd79f046f92b4b",
      "lfSha256": "712c8d87a4844b413e68cb10c6221bfbf1e1007099e81cef6656a5d9fbe91e86"
    },
    {
      "path": "src/recovered/electron/ipc/ipc-schemas.js",
      "sha256": "5a3363f0cd6da4d356ca31cefb0e4412369fcdf890597c4ab53623f336393a38",
      "lfSha256": "5a3363f0cd6da4d356ca31cefb0e4412369fcdf890597c4ab53623f336393a38"
    },
    {
      "path": "src/recovered/preload.cjs",
      "sha256": "b43a139cb749c3240857b47b48b45086f5a242b7c7ece51c8a29a8bb929f8d23",
      "lfSha256": "f7bf8512b57708e85c707ba37757965662a2f80915f3d78543596816b1d578a7"
    }
  ],
  "ownRawLogs": [
    {
      "name": "ordinary-core-before.txt",
      "sha256": "958eaa61e471c13779eff89423014d7ab1bfaa3c021b085e7c6fa4a48c1cf827"
    },
    {
      "name": "ordinary-core-after.txt",
      "sha256": "5bb52b18817a36667ee97786029b1e8ed6427e4e2cd0c064540911382d071176"
    }
  ],
  "installedGuiNativeAuthorization": "pending separate Windows acceptance",
  "physicalScmDnsRegistryMutations": 0
}
```
