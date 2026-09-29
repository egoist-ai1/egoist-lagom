<div align="center">
  <img src="docs/brand/lagom-mark.svg" width="76" alt="Egoist Lagom" />
  <h1>Egoist Lagom</h1>
  <p><strong>Спокойный командный центр сетевых настроек Windows.</strong></p>
  <p>Лаконичный чёрно-белый интерфейс, локальные профили соединения, DNS/DoH, Telegram Proxy и понятное обслуживание служб.</p>

  <p>
    <a href="https://github.com/egoist-ai1/egoist-lagom/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/egoist-ai1/egoist-lagom?display_name=tag&style=for-the-badge&color=111111" /></a>
    <a href="https://github.com/egoist-ai1/egoist-lagom/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/egoist-ai1/egoist-lagom/ci.yml?branch=main&style=for-the-badge&label=checks&color=111111" /></a>
    <img alt="Windows 10 and 11 x64" src="https://img.shields.io/badge/Windows-10%20%7C%2011%20x64-111111?style=for-the-badge&logo=windows11&logoColor=white" />
    <img alt="Monochrome UI" src="https://img.shields.io/badge/interface-monochrome-111111?style=for-the-badge" />
  </p>

  <p>
    <a href="https://github.com/egoist-ai1/egoist-lagom/releases/latest"><strong>Скачать Egoist Lagom</strong></a>
    · <a href="docs/reliability-3.7.9/README.md">Аудит 3.7.9</a>
    · <a href="docs/release-notes-3.7.9.md">Что нового</a>
    · <a href="docs/reliability-3.7.9/README.md#автообновление-и-ограничения">Ограничения</a>
  </p>
</div>

Egoist Lagom создан для людей, которым нужен быстрый и аккуратный контроль локальных сетевых настроек. Все необязательные компоненты выключены после чистой установки и включаются только по действию пользователя.

Сборка 3.7.9 объединяет Windows-разработку Lagom и Shield, обновляет Electron до 44.4.5 и ускоряет проверку принадлежности Telegram-процесса. Исправления, реальные fault-тесты и ограничения приведены в [отчёте 3.7.9](docs/reliability-3.7.9/README.md). Версии 3.7.8 и новее используют подписанный канал автообновлений, когда запущено приложение. Сами службы работают без него. Для 3.7.7 и более ранних нужен один ручной запуск проверенного установщика: прежний закрытый ключ не найден. Проверка подписей обязательна.

## Возможности

- **Профили соединения.** Импорт, выбор и проверка сохранённых конфигураций.
- **DNS и DoH.** Применение выбранных адресов, проверка readback и восстановление исходных параметров адаптера.
- **Telegram Proxy.** Локальная служба для Telegram с проверкой порта, состояния и журнала.
- **Службы Windows.** Установка, запуск, остановка и удаление собственных служб через один транзакционный Core.
- **Восстановление.** Возврат только изменений Egoist Lagom с сохранением внешних пользовательских настроек.
- **Диагностика.** Локальные журналы, компактные результаты проверок и нейтральные сообщения об ошибках.

Установленные автоматические службы DNS, Telegram и Zapret контролирует Core, запускаемый Windows без открытия интерфейса. Явное выключение компонента сохраняется. Восстановление ограничено проверкой ownership, журналом и интервалами повторов; отказ внешнего сервера не устраняется перезапуском локальной службы. VPN и его повторное подключение пока требуют работающего приложения. Локальный Xray DNS обслуживает A/AAAA; для полной поддержки типов DNS при новой стандартной конфигурации предпочтителен native Windows DoH.

## Интерфейс

Все экраны используют одну систему: чёрный фон, белая типографика, тонкие серые границы и короткие анимации на `opacity`/`transform`. Узкие окна, клавиатурный фокус, Escape, reduced motion и масштаб 200% входят в проверочный набор.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/dns.png" alt="Настройки DNS" /></td>
    <td width="50%"><img src="docs/screenshots/telegram.png" alt="Telegram Relay" /></td>
  </tr>
  <tr>
    <td align="center">DNS и проверка соединения</td>
    <td align="center">Telegram Proxy и журнал</td>
  </tr>
</table>

## Установка

1. Откройте [последний релиз](https://github.com/egoist-ai1/egoist-lagom/releases/latest).
2. Скачайте версионированный `EgoistShield-Setup-<версия>.exe` и одноимённый файл `.sha256`.
3. Сверьте SHA-256.
4. Запустите установщик и подтвердите штатный запрос Windows UAC.

Поддерживается Windows 10/11 x64. Установщик работает с правами администратора, освобождает только собственные компоненты Egoist Lagom и сохраняет пользовательские настройки сторонних программ.

## Сборка

Проверено с Node.js 24.19.0, Python 3.11+, .NET SDK 10.0.401 / runtime 10.0.12 и NSIS 3. Electron загружается по закреплённой версии и SHA-256; восстановленные ресурсы приложения и проверенные архивы остальных компонентов остаются входами упаковки. Задайте абсолютный `SHIELD_EVIDENCE_DIR` в рабочем каталоге сборки. SDK выбирается через `global.json`; `SHIELD_DOTNET` позволяет указать отдельную установленную копию.

```powershell
npm ci
python scripts/fetch-electron-runtime.py --work-dir "$env:SHIELD_EVIDENCE_DIR"
npm run build
npm test
npm run package:win
```

`npm run package:win` создаёт EXE, SHA-256 и `package-integrity.json` локально в `dist/`. Большие generated-папки и локальные ключи исключены из Git.

## Проверка

Итоговые счётчики и воспроизведения ошибок приведены в [отчёте 3.7.9](docs/reliability-3.7.9/README.md); история предыдущей реализации — в [аудите 3.7.8](docs/reliability-3.7.8/README.md). CI выполняет Node, C# и Windows PowerShell проверки. Локальные лаборатории и виртуальное время не подтверждают месяцы непрерывной эксплуатации или реальные перезагрузки Windows.

## Приватность и лицензия

Состояние, журналы и конфигурации хранятся локально. Диагностические архивы скрывают секреты; перед публикацией любого журнала проверьте его содержимое.

Проект предназначен для управления компьютерами и службами, которыми вы владеете или которыми вам разрешено управлять. См. [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) и [LICENSE.txt](LICENSE.txt).
