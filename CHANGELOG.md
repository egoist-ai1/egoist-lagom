# Changelog

## Egoist Lagom 3.7.7

- Исправлено правило EGOIST MIX для голосового TCP Discord; на рабочем компьютере пользователь подтвердил работу голоса.
- Автоподбор проверяет все доступные профили дважды и выдаёт рекомендацию по покрытию и задержке без автоматического подключения.
- При свежем локальном журнале Discord проверяется доступность его голосового TCP-сервера; результат не выдаётся за проверку UDP-медиа.
- Исправлены обрезанные кнопки и перекрытие карточки рекомендации в узких окнах.
- Защищённый установщик сохраняет видимый ход работы, DNS и службы, запускает окно приложения после установки.
- Проверки: 345 автоматических тестов и 25 сценариев интерфейса. Подробности — в `docs/validation-3.7.7.md`.

## Egoist Lagom — final 3.7.0

- Reframed the public product identity around the compact black-and-white Lagom interface.
- Replaced public copy with concise, neutral language for connection profiles, DNS/DoH, local relay services and diagnostics.
- Fixed DNS preparation before profile selection, affirmative readback after apply, cancellation and UTF-8 result-size limits.
- Made installation phases silent, transactional and recoverable. The installer now releases only processes and services under its own canonical paths.
- Added atomic runtime recovery, retry handling for busy files, deterministic rollback and an installation mutex.
- Corrected narrow settings layouts, log-row wrapping, keyboard dialogs and reduced-motion behavior.
- Added executable Windows installer regressions and a generated package-integrity manifest.

The technical service identifiers remain stable for existing installations.
