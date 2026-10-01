# Core: доверенный владелец ACL и чтение живого журнала

Исходная база `ead2bebea1d5866c4c162bbff9b514db533721ab`. Исправление заморожено в рабочем дереве; новый commit и настоящая установка исправленного кандидата ещё ожидаются.

Реальная signed Setup завершилась кодом **43**, `core-configure` — **1**: `ProtectedProductRoot.ApplyDirectoryAcl` пытался назначить владельцем SYSTEM из обычного повышенного administrator token. Подробности приняты в [installer diagnostics](core-install-owner-failure/installer-diagnostic.json) и [journal](core-install-owner-failure/installer-upgrade-journal.jsonl). На одном собственном NTFS-файле старый код воспроизвёл ту же `InvalidOperationException`; исходный ACL восстановлен. Текущий локальный токен не повышен, поэтому это локальное воспроизведение SID-ошибки не выдаётся за установку под администратором.

Владелец выбирается из настоящего Windows token: SYSTEM оставляет SYSTEM, повышенный администратор назначает BuiltinAdministrators. Для BA дополнительно проверяются enabled/SE_GROUP_OWNER и отсутствие deny-only. Неизвестный или обычный токен отклоняется до записи production-каталогов. Назначение чужого SID требует иных привилегий; такие привилегии здесь не включаются. [Контракт Windows](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setnamedsecurityinfow), [проверка роли токена](https://learn.microsoft.com/en-us/dotnet/api/system.security.principal.windowsprincipal.isinrole?view=net-10.0).

Права не расширены: private Service/installer/Vpn/TelegramProxy/SystemDoH содержат ровно SYSTEM+Administrators FullControl; public roots дополнительно дают Users ReadAndExecute. После применения проверяются владелец и точные правила. Reparse guards сохранены. Marker **v4** запускает полный проход для старых владельцев; его чтение ограничено 32 байтами, запись получает private ACL до содержимого.

Новые atomic temp/state и лог получают доверенного владельца через security attributes непосредственно при создании, затем проверяют ACL открытого handle до данных. После rename/replace проверяется итоговый файл; сохранённый Windows владелец назначения принимается только если он SYSTEM/BA. Default TokenOwner, который может быть персональным SID, больше не определяет production-файл. Для лога настоящий API-тест выявил запрет `Append + ReadPermissions`; исправленный `OpenOrCreate + Seek(End)` сохраняет FileShare.Read и semaphore. Nonproduction пути не получают новые ACL.

Отдельный настоящий [CI отказ live-log reader](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36815148626/job/110218485894) исправлен в SelfTest: чтение активных log/journal использует ReadWrite+Delete sharing, cancellation и предел 8 MiB. Production writer exclusion не ослаблен. [Принятый полный job log](core-install-owner-failure/pr-persistence-live-log-sharing.txt) SHA256 `F8FDF7CA998F0CE0B832DD9B84EAA9E74903C2A95385BB85AD0FED7EE9C462ED`.

## Проверено

- Focused regression **8/8 PASS**: 8 бинарных descriptor roundtrip для SY/BA × file/dir × private/public, отказ при 6 испорченных ACL/owners, отказ настоящему обычному токену, native creation/append на own NTFS, live-writer sharing RED→PASS, cancellation/8 MiB cap.
- Nonproduction atomic: 256 замен, 256 valid reads, **0 false Missing**, exclusive create/cancellation/ACL сохранены; log append/redaction/rotation сохранены.
- Точный product project: locked restore, self-contained single-file publish SDK **10.0.401**, runtime **10.0.12**, EXE `--self-test`: **все exit0**. Собранные исходники совпадают с замороженными файлами.
- Partial проекты: исходный **net8.0 compile PASS** обоих; локальный runtime прогон PASS с явным test-only Major roll-forward на доступный .NET10.0.12. Настоящий net8 runtime остаётся hosted SDK8 проверкой; production target не менялся.
- Существующий VPN/privacy native harness **5/5 PASS**, actual own NTFS read denied; 0 SCM/DNS/TUN/task mutations. В нём изменён ровно один descriptor-only caller; его unused SelfTest snapshot старше новой reader-проверки.
- Ошибка нового Append opener поймана отдельной реальной NTFS-проверкой и сохранена как RED, затем исправлена. Временные ошибки настройки harness сохранены и отделены от production результатов. Existing nullable warnings не скрывались.

## Следующая настоящая проверка

На disposable elevated Windows runner собрать **точный этот source**, выполнить `EgoistShield.Service.exe configure --install-root "C:\Program Files\EgoistShield"` без `--state-root`, проверить actual ProgramData owners/DACL/reparse и marker4/service-config. Source-only diagnostic должен сохранять `releaseReady=false`. Self-contained EXE не требует отдельно установленного runtime; build требует SDK10.0.401 и locked NuGet пакеты/runtime10.0.12.

Проверенная последовательность сборки; все промежуточные пути должны быть в собственном RUNNER_TEMP:

```powershell
$coreProject = Join-Path $repositoryRoot 'src/service/EgoistShield.Service.csproj'
$coreObj = (Join-Path $ownedArtifacts 'core-obj') + '\'
$coreProps = @('-p:PublishSingleFile=true', '-p:SelfContained=true',
  ('-p:BaseIntermediateOutputPath=' + $coreObj),
  ('-p:MSBuildProjectExtensionsPath=' + $coreObj),
  '-p:DefaultItemExcludes=obj\**\*.cs')
& $pinnedSdk restore $coreProject --locked-mode -r win-x64 @coreProps -v quiet
& $pinnedSdk publish $coreProject --no-restore -c Release -r win-x64 @coreProps `
  -p:EnableCompressionInSingleFile=true -o (Join-Path $ownedArtifacts 'core-publish') -v quiet
```

Следом нужен новый подписанный whole Setup и отдельные native service/network/upgrade gates. Эти конечные проверки **pending**. Месяцы непрерывной работы конечным тестом не подтверждаются; релиз этим worker не публиковался.

## Замороженные исходники

| Файл | SHA256 сырых байтов проверенного рабочего дерева |
| --- | --- |
| `src/service/EgoistShield.Service/ProtectedProductRoot.cs` | `7D02237F021979AA943B16B2C8357E48D7824430AF147C7E2649876C0201A896` |
| `src/service/EgoistShield.Service/AtomicJsonFile.cs` | `09471387A813C2D1BCA85D5ECFEF7669BCAFD57846486B456B1F7D5EB7A3CA6F` |
| `src/service/EgoistShield.Service/ServiceLog.cs` | `3650D4FF168569C88A5A8662CB8AE120E135C94DABEBAFDC716A40CBA4975FFD` |
| `src/service/EgoistShield.Service/SelfTest.cs` | `07A0F5E8038412069D4D7C72E0A26EEF8914D22B931D27F235472505860671A0` |
| `tests/AtomicJsonFileLockRegression/AtomicJsonFileLockRegression.csproj` | `6F02432CBFA5DD97592BA674FD1089259DB0CCBC6895CC9F100DC368111F8965` |
| `tests/CoreServiceReliabilityRegression/CoreServiceReliabilityRegression.csproj` | `B62E2D03A90BD81722CF2EC2E6DC4F00C3E41B77344CC0467791893B5140407E` |
| `tests/vpn-service-native.cs` | `7931DAB1C8C65FE5DC485805157C6E23338A6C694975F4BDA59C81988FEE4BBC` |
| `tests/core-owner-regression.cs` | `D151B052B30E281CE5D52536B2DD618620A73085A349C7E110D4D9FBF9463E00` |
| `tests/core-owner-regression.ps1` | `071AA397E0C98252E2FF5C5FD3668DB92EEDAC5F9262293074619572A50CDE1A` |

[core-owner-fix.json](core-owner-fix.json) содержит source inventories, before/after результаты, actual NTFS ошибки, CI evidence hashes и точные ограничения.
