# Исправление Core: чужой Telegram listener

Root сообщил наблюдаемый отказ: SCM службы Lagom был Running, её дочерний процесс завершался с bind 10048, а настроенный порт отвечал процессом Egoist Relay. Прежний Core проверял только TCP connect и мог считать чужой ответ healthy. Живое изменение портов выполнял Root: по его readback Lagom работает на 1445, Relay сохранён на 1443. Этот подпроект не менял работающие службы, процессы, конфигурацию или registry.

`OwnedTcpListenerProbe` теперь получает read-only snapshot SCM и listener owning PID. При Running проверяются точный executable текущего SCM процесса и время его создания; listener должен находиться в его дереве. Время рождения каждого parent не может быть позже child. Источник этого правила — [Win32_Process: ParentProcessId и CreationDate](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process). В snapshot нет command lines, environment или секретов proxy.

Для сконфигурированного IPv4 loopback рассматриваются точный адрес, IPv4 wildcard и потенциально dual-stack `::`; IPv6 loopback — точный адрес и `::`. Потенциальный wildcard подтверждается реальным TCP connect. Все подходящие listeners должны принадлежать службе; смешанная ownership не выдаётся за успех. После connect выполняется свежая проверка SCM/process ownership. Неизвестная metadata, циклы, повторяющиеся PID или изменение SCM snapshot дают unknown. [Get-NetTCPConnection](https://learn.microsoft.com/en-us/powershell/module/nettcpip/get-nettcpconnection?view=windowsserver2025-ps), [Win32_Service ProcessId](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-service).

Foreign ownership даёт `LocalServiceHealth.Conflict`, а `service.status.supervision` показывает `listener-conflict`. Core сбрасывает последовательность неудачных liveness наблюдений и воздерживается от Start/Stop/restart. То же правило действует для уже остановленной, но намеренно включённой Telegram службы: пока чужой listener занимает порт, Start не повторяется. Перед запланированным recovery выполняется ещё один probe; обнаруженный takeover отменяет recovery. У подтверждённо свободного отсутствующего listener сохраняется прежнее ограниченное восстановление.

Одна ownership команда ограничена четырьмя секундами; общий TCP/ownership probe — восемью. Timeout/ошибка metadata дают unknown, не assumed healthy или рестарт. Реальная стоимость WMI snapshot и latency пользовательской команды под общей очередью в этой серии не измерялись. Scope — локальная endpoint ownership и отзывчивость; это не проверка удалённого Telegram relay. Core не меняет порт и не завершает чужой процесс. Встроенная политика WinSW/SCM остаётся отдельным механизмом восстановления; нулевое число recovery ниже относится к действиям Core.

Проверено SDK **10.0.401**. Полный production-source regression работал на **.NET 10.0.12**, Core fault project сохраняет target net8.0 и запускался на **.NET 8.0.30**. Новые сценарии:

* Настоящий TCP listener отвечает старому `TcpAsync` как Responsive, а foreign snapshot даёт Conflict.
* Listener takeover между первым snapshot и TCP/readback не даёт healthy.
* Точный child/grandchild дерева WinSW принимается; reused PID, wrong SCM image, missing CreationDate и unstable SCM не принимаются.
* IPv4/IPv6 endpoint matching и wildcard требуют последующей TCP проверки.
* 10 000 повторений циклической ancestry завершаются в ограниченной глубине.
* 1 440 running и 1 440 stopped checks при постоянном foreign listener: **0 Core recovery, 0 предупреждений**, `listener-conflict` сохраняется.
* Свободный отсутствующий listener намеренно включённой остановленной службы допускает одну ограниченную Start попытку.
* Сгенерированный snapshot исполнялся в настоящем Windows PowerShell 5.1 с mock CIM/TCP cmdlets: owned, foreign, missing и unstable SCM — passed. Настоящие SCM мутации не выполнялись.

Полная итоговая серия: Core **22/22**, Native/Core **12/12**, существующий SelfTest — passed. Очищенные результаты и актуальные source SHA-256 находятся в [receipts.json](receipts.json), [Core results](core-regression.txt), [full-source results](native-regression.txt). Исходники этой правки: `OwnedTcpListenerProbe.cs`, `LocalServiceHealthProbe.cs`, `OwnedServiceSupervisor.cs`, `OperationDispatcher.cs`, `OwnedServiceController.cs`; тесты добавлены в ранее созданные service regression проекты.

Запрет автоматического старта Zapret при выборе standalone проверяется отдельным владельцем network lifecycle. Core уже сохраняет intentional off для `startStandalone/restartStandalone`, а temporary VPN suspension не превращается в пользовательское отключение. Окончательная установка и SelfTest именно упакованного бинарника выполняются Root отдельно.
