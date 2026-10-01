# Обновление при самовосстанавливающихся старых службах

Дата: 2026-09-30. Исследована версия исходников `199236e3b227f9885c2beef64faffbe9e9a35583` (кандидат 3.8.0). Это независимый read-only разбор: SCM, DNS, пользовательские процессы и установленная версия не изменялись. Номера строк ниже относятся к исследованному снимку, до последующих исправлений root.

## Вывод

**INST-01, P1: у установки нет общего окна обслуживания служб.** Она посылает Stop/при необходимости завершает процессы, но сохраняет Automatic и SCM recovery; Core также продолжает считать остановленные службы желаемыми. Код допускает возвращение процесса между Stop и заменой файлов. Это соответствует описанному пользователем отказу. Конкретную гонку на действующих службах в этом аудите не воспроизводили, поэтому это подтверждённый дефект протокола, а не отчёт об измеренном сбое конкретной машины.

Нужен временный запрет запуска только доказанно собственных служб, с сохранением прежних режимов и обязательным восстановлением при отказе. Простое увеличение таймаута или повторный `taskkill` причину не устраняет.

## Причинная цепочка и существующие защиты

| Место | Проверенный факт | Следствие |
|---|---|---|
| `scripts/invoke-final-silent-reinstall.ps1:1029–1043` | Перед остановкой сохраняются службы, user state, DNS, runtime; запускается watchdog; пишется `handoffStarted`. | Уже есть основание для обратимого обслуживания. Snapshot должен оставаться до любого изменения StartType. |
| Тот же файл, `498–505`, `1044–1050` | Stop-Service без изменения StartType/recovery; порядок TG, Zapret, Gravityless, Core, затем SystemDoH. | Core ещё работает, когда останавливают часть контролируемых служб. Отложенный SCM restart не запрещён. |
| `src/service/EgoistShield.Service/OperationDispatcher.cs:94–110` | Supervision проходит каждые 15 с под собственным mutation lock. Installer не использует этот lock. | Внешний Stop не становится намеренным выключением. |
| `OwnedServiceSupervisor.cs:67–95`, `141–173` | После 60 с запуска, три неуспешных наблюдения ≥30 с, cooldown ≥5 мин; восстановление только Installed, Auto, Running intent, с повторной проверкой. | Это ограничивает шторм, но не исключает гонку установки. При Disabled восстановление пропускается. Не каждый Stop немедленно приводит к Core restart. |
| `OwnedServiceIntentStore.cs:14–18` | Core хранит Running intent в `service-supervision.json`; контролирует SystemDoH, Zapret, TelegramProxy. | Gravityless/legacy Xray не следует ошибочно объявлять контролируемыми этим supervisor; у них возможен отдельный SCM recovery. |
| `OwnedServiceController.cs:392–400` | Ремонт recovery одновременно делает `sc config start=auto`, dependencies и restart/5000, /10000, /60000. | In-flight policy repair способен вернуть Auto после внешнего Disable. Сначала нужно гарантированно остановить сам Core. |
| `src/installer/owned-cleanup.ps1:442–470` | Stop ждёт 15 с; зависший принадлежащий службе PID завершается; при Delete проверяется исчезновение регистрации. При обычном Stop окончательная стабильная остановка не проверяется. | Принудительный выход с активным recovery способен запланировать новое открытие файлов. |
| Тот же файл, `698–705` | Legacy/shared службы обрабатываются раньше текущего списка; внутри текущего списка Core первый. | Частичная защита порядка есть, единого restart barrier нет. |
| Тот же файл, `530–559` | GuardFiles каждые 125 мс завершает только `EgoistShield.exe` из собственных roots. | Это не запрет восстановления Core/WinSW/Xray; не следует расширять guard до бесконечного убийства всех engine names. |
| Тот же файл, `1306–1316`; `setup.nsi:301–315` | Новый Core сразу получает Auto, restart/5,15,30 с и запускается до PostInstall. | Окно обслуживания должно действовать и на новую версию Core до завершения восстановления wrappers/configuration. |
| `invoke-final-silent-reinstall.ps1:1070–1077` | После успеха NSIS Core ещё раз останавливается, затем восстанавливаются runtime, XML, wrappers и службы. | Повторная обычная остановка также не блокирует SCM recovery во время миграции. |
| `owned-cleanup.ps1:797–885`, `2968–3186` | Экспорт service registry, карантин прежней установки, rollback файлов и внешнего baseline уже существуют. | Нужно расширить эти транзакции, сохранив их, а не создать второй конкурирующий updater. |

Microsoft документирует, что уже поставленное в очередь восстановление SCM нельзя отменить; для запрета неожиданного повторного запуска служба должна быть Disabled. Следовательно, только смена failure actions на none не закрывает уже существующую очередь. [ChangeServiceConfig2](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-changeserviceconfig2a). Disabled отвергает StartService с ERROR_SERVICE_DISABLED. [ChangeServiceConfigW](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-changeserviceconfigw).

## Наиболее узкое исправление

1. **До остановки — один защищённый durable snapshot.** Сохранить ImagePath, исходный StartType/DelayedAutoStart, текущее состояние, PID с временем рождения, recovery settings, dependencies и Running intent. Snapshot хранит исходное состояние, повторный вызов не должен перезаписать Auto уже выставленным Disabled. Подтвердить запись; при невозможности записи ничего не останавливать.
2. **Core выключить первым.** Доказать ImagePath, временно сменить StartType через SCM на Disabled, проверить SCM readback, послать Stop и дождаться Stopped и завершения именно старого процесса. Если он завис — только отдельный доказанный OWN_PROCESS, с повторной проверкой PID/времени рождения/ExecutablePath. Не убивать общий SCM/service host. Если Core не удалось остановить, не продолжать замену wrappers.
3. **Остальные собственные службы сделать Disabled и остановить.** Проверять SCM, не полагаться на ExitCode одной команды. SystemDoH остановить последним, после сохранения DNS и подготовки восстановления. Проверить отсутствие собственных процессов/владельцев нужных файлов. Установка не требует удаления всех служб ради снятия блокировки.
4. **Сохранить запрет на время распаковки и миграции.** Для нового Core нужен защищённый maintenance marker/lease, который отключает supervision и мутации до восстановления; либо перенести его старт до окончания работы с компонентами. Marker должен читаться и на старте нового Core, иметь проверяемого владельца/фазу; испорченный marker не должен разрешать обычную работу. Одна пауза в UI или testenv-переменная границу безопасности не создаёт. Не записывать false в Running intent вместо обслуживания — это уничтожает пользовательский выбор.
5. **После проверки файлов — явно вернуть StartType через SCM.** `Restore-PreservedState:546` импортирует `.reg`; после добавления Disabled нужно дополнительно вызвать SCM config/Set-Service и проверить живое значение. Прямой импорт реестра не заменяет API-контракт SCM. Начать с DNS и проверки собственного ответа, затем остальные ранее работавшие службы, Core — после восстановления конфигураций и intent. Исходные Manual/Disabled не превращать в Auto. Включить recovery и убрать marker только при подтверждённом завершении.
6. **Любая ошибка и watchdog используют тот же exit path.** После kill worker, ошибки доступа, ENOSPC, сбоя unpack или wrapper migration восстановить старый payload/configuration, прежние режимы, ранее работавшие службы и лишь всё ещё принадлежащие приложению DNS настройки. Если восстановление не доказано, оставить защищённый snapshot и понятное состояние «восстановление ожидает завершения», не писать success. Новая попытка сначала завершает эту транзакцию.

Временное Disabled уже блокирует restart для существующих recovery queues и удовлетворяет текущий Core guard. Изменение failure actions допустимо лишь при точном API snapshot/restore; оно не обязательно для узкого исправления и не должно удалять постоянное самовосстановление после установки. Повторное включение службы с ещё живущей старой очередью требует контроля начала/конца окна и фактического readback; тест должен выдержать максимальную старую задержку.

## Владение, aliases и границы

- Известные актуальные: `EgoistShieldCore`, `EgoistShieldTelegramProxy`, `EgoistShieldZapret`, `EgoistShieldGravitylessDNS`, `EgoistShieldSystemDoH` (`owned-cleanup.ps1:148–154`). Исторические: `EgoistShieldDNS`, `EgoistShieldProxy`, `EGISShieldDNS` (`156–160`). Общие имена `dnscrypt-proxy`, `NetguardDNS` требуют ImagePath proof (`164–166`). Отдельная SCM служба буквально `XRA` в этом списке не найдена.
- `xray.exe`, `sing-box.exe`, `winws.exe`, `dnscrypt-proxy.exe` — общие runtime names. Останавливать только путь внутри доказанного install/data root, не по имени. Чужой WinDivert, системный DNS Client, корпоративный VPN/AV, Services.exe/Svchost.exe неприкосновенны. Драйвер остановить/удалить можно только с owned `.sys` proof (`1454–1495`).
- Exclusive name с чужим ImagePath уже оставляется нетронутым (`430–438`); это правило сохранить и для Disable/restore. При конфликте имени установка должна назвать причину и безопасно завершить восстановление. Имя продукта не доказывает путь файла.
- `Stop-AllServicesFromOwnedRoots:574–582` удаляет и неизвестные службы с доказанным собственным путём, но `Get-VerifiedOwnedServiceRecords:757–769` сохраняет только known/exclusive names. Для полного покрытия собственных historical/custom aliases discovery и snapshot должны использовать одну ownership policy; иначе такое удаление не имеет записи для rollback.
- Protected worker snapshot сейчас ограничен пятью текущими service names (`invoke-final-silent-reinstall.ps1:59–64`, `332–361`). Наследуемые алиасы должны либо войти в общую транзакцию с proof, либо завершиться диагностикой совместимости. Не расширять roots на весь Program Files или все пользовательские профили ради слова «любой».
- Проверка существующей установки требует здоровый canonical root/runtime manifest (`owned-cleanup.ps1:664–681`, `2470–2476`). Историческая установка без этих файлов не становится подтверждённо поддержанной миграцией. Версии 3.7.7/3.7.8/3.7.9 и старые без Core нужны отдельными реальными upgrade cases.

## Проверка исправления

Обязательные безопасные regression cases: уже поставленный в очередь restart; живой Core с Running intent и pending policy repair; зависший StopPending; stale snapshot и повторный worker; kill между snapshot/Disable/Stop/unpack/migration/start; Manual/Disabled и намеренно выключенная служба; общий alias с чужим путём; неизвестный собственный alias; чужой владелец файла; отказ Disable и неуспех restore; DNS только на loopback. Проверить и ручную установку, и auto-update handoff, и uninstall/rollback, если используют общий stop helper.

Поведение можно сначала проверить на отдельных тестовых SCM службах из защищённой лабораторной директории; реальные OS DNS/production-службы не нужны. Изолированная модель и source assertions не доказывают поведение очереди Windows SCM. Для релизного вывода нужны upgrade/reboot в чистой Windows VM с исходными 3.7.7/3.7.8/3.7.9 и фактическим readback: новая версия, прежний пользовательский выбор, ожидаемые Auto/Manual/Disabled, собственные listeners, отсутствие старых processes/locks и незавершённых marker. Текущий тест `tests/final-silent-reinstall.test.mjs:82–103` проверяет source-порядок watchdog/DNS, а не живую SCM гонку.

## Provenance снимка

| Source | SHA-256 |
|---|---|
| `src/installer/owned-cleanup.ps1` | `EEE3C5F526D87B3C3B525E0D9CE8CE6593A3BBEAFDB36F2F9E0AB4DD576293DD` |
| `src/installer/setup.nsi` | `5BBB20A4569F8BCD6F9C89A93ABA865C996906B9DB1009962C59709E0138E479` |
| `scripts/invoke-final-silent-reinstall.ps1` | `FF3E74C738D0F0D0F979897946D8D756EA039C6B140DFAA868BFBC598A309405` |
| `src/service/EgoistShield.Service/OwnedServiceSupervisor.cs` | `1D20965724A09FA3C2D009968B398C7FA90EFD5512C6411837FC0889572EB878` |
| `src/service/EgoistShield.Service/OwnedServiceController.cs` | `C45250F096A69DFAD5A83323E4835CF9C0A656CEF0A07247770BFDEE90DCFB22` |
| `src/service/EgoistShield.Service/OperationDispatcher.cs` | `113186FA323DA22EEA05DD3DE18E8F4C70413A5B655DE2720FAB9E5BC92916B9` |
