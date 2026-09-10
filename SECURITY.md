# Безопасность Egoist Shield

## Проверка релиза

Официальные релизы публикуются только в `egoist-ai1/egoistshield`. Manifest schema v2 подписывается Ed25519 release key, которому доверяет подписанный root registry. Setup дополнительно связан с manifest по имени, версии, canonical URL, размеру, SHA-256, SHA-512 и GitHub asset digest.

Версия 3.6.1 не имеет Authenticode. Ed25519 подтверждает release asset относительно закреплённого ключа, но не заменяет репутацию издателя Windows и не устраняет SmartScreen/UAC. Из-за утраты прежних закрытых ключей переход на новый корневой ключ требует ручной установки: [порядок смены доверия](docs/trust-bootstrap-3.6.md).

## Сообщить об уязвимости

Не публикуйте токены, VPN links, diagnostics или персональные журналы в открытом issue. Создайте приватный security advisory в GitHub Security или свяжитесь с владельцем через профиль проекта. Укажите версию, Windows build, воспроизводимые шаги и минимальный обезличенный журнал.

## Границы

MDM/GPO, Defender Tamper Protection, WDAC и сторонний security provider не обходятся. Egoist Shield показывает границу и возможное ручное действие. Приложение не удаляет чужие VPN, DNS, WinDivert или антивирусные компоненты только по имени процесса.
