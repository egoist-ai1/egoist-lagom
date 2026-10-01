# Восстановленный native baseline старых служб

**Отдельная проверка настоящего SCM / GUI / helper handoff допустима.** Она восстанавливает неизменённые authenticated binaries старой версии, затем проверяет реальный переход служб на новый кандидат. Она не означает, что original clean Setup успешно выполнился. Неудачные clean Setup / DNS preflight остаются отдельными сохранёнными результатами.

Реализованы `tests/windows-native-legacy-baseline.ps1`, `.mjs` и `.test.mjs`. Родительский legacy harness подключает библиотеку через `-LibraryOnly` и вызывает `Invoke-RestoredLegacyBaseline` после обычных GitHub-hosted / admin / clean-state guards. Новая библиотека повторно проверяет host, канонический Program Files root, отсутствие прежних служб/файлов и bounded runner paths. Она не подставляет environment values и не меняет адаптеры.

Node helper независимо проверяет исходные Ed25519 manifest/registry signatures, pinned root и exact original Setup SHA256/SHA512/size. Затем trusted 7-Zip listing проходит проверку путей, duplicates, ADS/device names, symlink/hardlink и размера до извлечения. Извлечение — в fresh runner work; каждый извлечённый файл получает размер/SHA256. Установленный Program Files payload полностью сравнивается с этим inventory до generated metadata и после original Core registration.

Истинная особенность NSIS: listing показывает пустой размер `Uninstall Egoist Shield.exe`, а 7-Zip реконструирует этот executable из Setup. Разрешено только это конкретное имя из pinned installer, не более 2 MiB; фактические размер/hash и происхождение записываются в `reconstructedArchiveEntries`. Все остальные unknown sizes отклоняются. Восстановленный uninstaller не доказывает выполнение исходного Setup или его ARP registration.

`resources/installation.json` отсутствует в packaged payload. Он записывается как **отдельное fixture-generated installer state**: свежий GUID и точная version-рецептура original PostInstall. Оба old cleanup byte-identical и буквально содержат `version="3.7.8"`, включая пакет 3.7.9. Fixture сохраняет эту рецептуру; authenticated package version 3.7.9 записана отдельно. После original Core phase metadata повторно читается, и возможное фактическое изменение во время этой фазы отражается отдельными before/after hashes. UUID/metadata не выдаются за signed payload.

Core не имеет самостоятельного `install` CLI. Библиотека выполняет **неизменённый authenticated** `owned-cleanup.ps1 -Phase InstallCoreService -InstallRoot <canonical>`. Этот shipped phase вызывает original Core `configure --install-root`, настоящий `sc.exe create/start` и recovery policy: Automatic / LocalSystem, reset 86400 секунд, restart 5000/15000/30000 ms, non-crash flag 1. Проверяется реальный SCM и соответствующий живой PID/executable. PostInstall с его DNS/cleanup действиями не запускается ради UUID.

Возвращаемый receipt имеет `kind=restored-authenticated-legacy-native-baseline`, `originalSetupExecuted=false`, `oldOriginalSetupExecuted=false`, `result=baseline-ready`; `guiAndHelperHandoffTested=false` и `releaseAcceptance=false`. Это только готовность baseline. Родительский harness затем должен выполнить неизменённые original GUI/UIA → Telegram service/endpoint без GUI → original helper → подписанный кандидат → полный payload, preserved service/recovery/private-state/network/foreign-registration readback и настоящий новый uninstall. Ни одна GUI/SCM проверка не заменяется mock или успехом извлечения.

Локально выполнены **6/6 focused tests, 0 fail, 0 skip**, PS7 parser — 0 ошибок. Они проверяют опасные пути/links/collisions/size ambiguity, changed/missing/extra payload, настоящие подписи при повреждённых файлах и отказ actual nonhosted окружения до восстановления. Дополнительно реально проверены signatures/hashes и inert extraction обоих неизменённых original EXE:

| Original | SHA256 Setup | Archive files | Payload files | Payload inventory SHA256 |
| --- | --- | ---: | ---: | --- |
| 3.7.8 | `34136729f0924e95af65b7fefd2792763c29694056b8ff76a79c9fe0e325f927` | 180 | 174 | `acbea21f4f8e1f4f335a1b94517df936ca08e6f45aa33a782f1ad6a59e33a3e8` |
| 3.7.9 | `eb8db40e80201f5e9bf153368da8131325c0253bbc13a842c95f3f2725e04cc6` | 179 | 173 | `8896468f194d872a87607cdb08272ab361d65defa240cb1874519364491ed2e5` |

Извлечение создало только собственные task temporary files. Setup/Core/GUI/SCM/Program Files не запускались и не изменялись на физическом компьютере. **Настоящее native baseline restoration и upgrade этим локальным результатом ещё не подтверждены.** [Машинный отчёт и полные inventories](legacy-native-baseline.json).

Не восстановлены исходные NSIS ARP/shortcut/AppCompat registrations; их отсутствие отмечено в receipt. Они не должны имитироваться ради зелёного service handoff. Старый user history, reboot, старые активные DNS/VPN подключения, все комбинации служб и месяцы непрерывной эксплуатации также не следуют из этой baseline-проверки. Эти сценарии требуют собственных реально выполненных проверок.
