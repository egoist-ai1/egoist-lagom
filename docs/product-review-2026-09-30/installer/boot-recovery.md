R29: восстановление после перезагрузки во время установки
======================================================

Реализован отдельный модуль регистрации защищённой задачи восстановления: [maintenance-boot-recovery.ps1](../../../src/installer/maintenance-boot-recovery.ps1). Это проверка исходников и границ вызовов. Реальная регистрация задачи, её запуск при загрузке Windows, восстановление служб и обновление установленной 3.7.9 этим отчётом не подтверждены.

Причина
-------

Во время обслуживания службы приложения, включая Core, временно получают Disabled. Обычные worker/watchdog процессы исчезают при перезагрузке. Поэтому один watchdog не обеспечивает восстановление после reboot без следующего запуска установщика. Новая регистрация должна завершиться с проверкой до первого Disabled; регистрацию нельзя считать успешной лишь по отсутствию ошибки Create.

Контракт интеграции
-------------------

Модуль импортируется без действий в ОС и предоставляет три функции:

| Функция | Обязательный результат |
| --- | --- |
| Register-InstallerMaintenanceBootRecovery -StageDirectory STAGE | Защищённый inventory записан; собственная задача создана либо уже соответствует inventory; readback подтверждён. Вызвать после сохранения исходных snapshots, до maintenance marker/Disabled. |
| Assert-InstallerMaintenanceBootRecovery -StageDirectory STAGE | Повторно подтверждены canonical stage, защита файлов, immutable SHA, state identity и конфигурация задачи. Использовать перед boot/watchdog recovery и изменениями служб. |
| Unregister-InstallerMaintenanceBootRecovery -StageDirectory STAGE -RestorationVerified:$true | Caller уже проверил восстановление служб и снял свой maintenance marker. Удаляется только задача с повторно проверенным собственным identity; отсутствие задачи — безопасный повторный no-op. |

Caller удерживает общий mutex Global\EgoistShield.DeferredReinstall. -Recover запускает восстановление с runAfter=false. Ошибка/занятый lease/unresolved restoration должны завершать task action ненулевым кодом; успешный код допустим после проверенного результата. Отдельно обработать reboot между регистрацией и началом обслуживания: отсутствие собственного marker при handoffStarted=false не должно ошибочно превращаться в вечный unresolved recovery.

Root отвечает за доставку worker/helper/module, snapshots, общую блокировку, саму операцию восстановления и service readback. Module не останавливает и не запускает службы.

Защита и владение
-----------------

Stage — прямой GUID-каталог под Windows CommonApplicationData EgoistShieldInstaller\DeferredRuns. CommonApplicationData берётся через Windows SpecialFolder; произвольный ReceiptRoot отклоняется. Reparse points проверяются во всём пути.

Canonical product ancestors, stage и обязательные файлы должны иметь owner SYSTEM либо Administrators, разрешать им полный доступ и исключать сторонние write/delete-child/write-DACL права. Protected DACL требуется для каталогов. InheritOnly ACE не подтверждает доступ к текущему объекту. Установщик должен защитить также новые дочерние файлы: защищённая родительская папка сама по себе не меняет owner вновь созданного файла.

boot-recovery.json создаётся с FileSecurity owner Administrators и SYSTEM/Administrators FullControl. WriteThrough и Flush(true) предшествуют rename. Inventory связывает registration ID, canonical stage, task name, state path и SHA256:

- invoke-final-silent-reinstall.ps1;
- service-maintenance.ps1;
- maintenance-boot-recovery.ps1.

state.json изменяется в процессе работы, поэтому проверяются его path/ACL/owner/schema/product identity и ограничение 4 MiB. Content hash состояния не фиксируется. Task URI связывает stage/registration ID, а description — SHA256 точных inventory bytes.

Task name: EgoistShield-InstallerBootRecovery-STAGE_GUID. Native COM adapter использует локальный корневой task folder и create-only flags TASK_CREATE | TASK_DONT_ADD_PRINCIPAL_ACE (18), service-account logon 5, SYSTEM и пустой password. Существующая чужая задача не обновляется; collision между read и create приводит к отказу. Эти параметры следуют [TaskFolder.RegisterTask](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskfolder-registertask).

Task DACL protected, owner SYSTEM/Administrators, FullControl только SYSTEM/Administrators. Readback проверяет principal/logon, единственные boot trigger и Exec action, argv, working directory, URI/inventory hash, execution limits и ограничения. Доступ SYSTEM необходим для штатной работы Scheduler. [Microsoft: task security descriptor](https://learn.microsoft.com/en-us/windows/win32/taskschd/registeredtask-setsecuritydescriptor).

Политика запуска
----------------

Action — только canonical Windows System32\WindowsPowerShell\v1.0\powershell.exe, staged worker и -Recover -StageDirectory STAGE. Shell/GUI команды и произвольный пользовательский путь не добавляются. Quoting проверен реальным Windows argv parser.

| Настройка | Значение |
| --- | --- |
| Boot delay | 30 секунд |
| Principal | SYSTEM, HighestAvailable |
| Multiple instances | IgnoreNew |
| ExecutionTimeLimit | 20 минут |
| Failure restarts | 3, интервал 2 минуты |
| Battery/network/idle restrictions | Отключены |
| Hidden | true |
| WakeToRun | false |

Boot trigger и его delay определяются механизмом Scheduler. [Microsoft: boot trigger XML](https://learn.microsoft.com/en-us/windows/win32/taskschd/boot-trigger-example--xml-). Execution limit и ограниченные failure restarts задаются явно; это не доказательство фактического retry timing после reboot. [ExecutionTimeLimit](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-executiontimelimit), [RestartCount](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-restartcount), [RestartInterval](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-restartinterval).

Убраны зависимости от питания от сети и наличия сетевого соединения: восстановление не должно ждать их только из-за стандартных task defaults. [Battery setting](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-disallowstartifonbatteries), [network setting](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-runonlyifnetworkavailable).

Проверки
--------

Windows PowerShell 5.1 исполнил 22 группы / 490 assertions. [Тесты](../../../tests/installer-boot-recovery.ps1) выполняют реальные production registration/assert/retirement функции и COM adapter через контролируемую Schedule.Service factory.

Покрыты idempotency, create-only collision race, scheduler read/create/delete failures, обязательный post-create readback, SHA всех трёх scripts и точных inventory bytes, изменяемое состояние, owner/ACL/size/schema gates, 17 вариантов XML tampering и дополнительные actions/triggers/principals, task ACL/logon, legacy retirement, foreign replacement и refusal до проверенного restoration.

Реальные операции теста: собственные временные файлы, hashing/flush/rename, NTFS junction и его отказ, Windows CommandLineToArgvW, reflection поддерживаемого WinPS FileStream ACL constructor. ACL proofs возвращаются контролируемым Get-Acl с реальными .NET security descriptors; защищённое native создание файла заменено обычным temp stream, сохранив production создание FileSecurity. Это не проверяет фактический owner/DACL в файловой системе.

Native Scheduler reads/create/update/delete/action runs, SCM/DNS/ACL writes: **0**. Import safety проверяется до dot-source; COM factory заблокирована до установки тестового boundary. Машиночитаемое evidence и SHA текущих source/test files: [boot-recovery.json](boot-recovery.json).

PSScriptAnalyzer: 0 errors, 2 рекомендации PSUseShouldProcessForStateChangingFunctions. Internal installer entrypoints имеют фиксированное владение и не добавляют interactive confirmation. Это не заявление об отсутствии всех замечаний анализатора.

Ограничения и release gates
--------------------------

Нужны native acceptance: фактический SYSTEM task registration/readback; owner/DACL созданного inventory/state; reboot между Register/marker/Disabled/installer/restore; retry/timeout; retirement после readback; восстановление boot-disabled служб без GUI; отсутствие конфликтов и сохранение исходного snapshot при прерывании. Требуется отдельная проверка реальных SCM очередей и обновления с установленного старого релиза.

Scheduler не имеет compare-and-delete API. Перед удалением выполняется свежая identity проверка, а native adapter повторно сравнивает XML/DACL непосредственно перед DeleteTask. Shared mutex сериализует операции приложения. Это не защита от привилегированного администратора, заменяющего task в последнем межпроцессном окне.

Исторический migration gate остаётся открыт: installed updater 3.7.8/3.7.9 может запустить старый установленный helper и передать новой Setup старый stage без boot task/inventory. Такой stage нельзя объявлять проверенным новым handoff. Нужен отдельно проверенный подписанный bootstrap/migration adapter; trust checks данного module ослаблять нельзя. Безопасный no-op legacy retirement при отсутствии task не означает поддержку безопасного обновления этим старым helper.

Этот module не установлен и не опубликован самим исполнителем. Проверки не доказывают месяцы непрерывной работы или восстановление после любой аппаратной ошибки.
