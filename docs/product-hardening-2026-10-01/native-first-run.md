# Первая реальная установка и ошибка DNS-снимка

Сборка исходников `8331dee050a070c729e14720ce5d767106a9830a` прошла пакетирование, проверку runtime и Node-тесты на Windows. Настоящий Setup на чистом disposable Windows runner завершился с кодом **41** в PreInstall, до копирования payload и запуска GUI. Это не успешная установка и не подтверждение готовности релиза.

Setup: 276 731 971 байт, SHA-256 `e53cccd522b396ff88e2159c97cf3c2f7c3d45bcfe0210babecdcf8adf80016a`. [Run установки](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36795591137), [исходный receipt](native-first-run/clean-install-before.json).

Отдельный [диагностический run](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36798923145) выполнил настоящий source PreInstall на чистой Windows 10.0.26100 через Windows PowerShell, сохранив stderr, который NSIS обычно поглощает. Исходники: `62f0f2ecd06dbcb68e3a37ec8937dc74448d0c77`; SHA-256 `owned-cleanup.ps1` до исправления: `d2e591ab8b2b1defc61a88fb4e4ac1d18bf3d68f7554599f013613d81eabec62`. [Receipt](native-first-run/installer-diagnostic.json), [фактическая ошибка](native-first-run/source-pre-install.stderr.txt).

Ошибка возникла в `Save-SystemNetworkBaseline`: запрос DNS для IPv4 интерфейса 9 возвратил `CmdletizationQuery_NotFound`. Наличие подключённого виртуального сетевого адаптера не гарантирует наличие DNS client records. Сеть runner до и после отказа совпала; службы приложения отсутствовали.

Исправление читает полный DNS client inventory одним запросом с `ErrorAction Stop`, связывает записи с точным индексом и семейством, исключает адаптеры без DNS client records и сохраняет флаги реально снятых семейств. Откат не задаёт DNS для отсутствовавшего семейства. Старые version-1 журналы без этих флагов сохраняют прежнее значение. Ошибка самого CIM provider по-прежнему прерывает подготовку; она не скрывается пустым снимком.

Контролируемая регрессия импортирует настоящие production-функции через AST, воспроизводит старый отказ и проверяет шесть групп: отсутствие семейства, IPv4/IPv6-only, точность static DNS, отсутствие чужих интерфейсов в откате, отказ provider без публикации неполного журнала и совместимость старого журнала. PASS на PowerShell 7 и Windows PowerShell 5.1; собственные NTFS-файлы настоящие, DNS/registry/external-command границы контролируемые, изменений сетевых настроек и SCM физического хоста нет.

Повторный source PreInstall и затем новая сгенерированная установка обязательны. Source-phase PASS сам по себе не доказывает работоспособность Setup, UI, SCM, TUN, обновления или длительную эксплуатацию.
