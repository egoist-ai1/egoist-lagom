# Полный набор source 15aea78: сохранённый отказ

Source `15aea7863c8bfaa59fec2ac8c68924ef46ad12a7`, tree `ca5283aad44f276743c35062201e51e7bec6c6b3`: **931/938 PASS, 7 FAIL, 0 skips/cancelled/todo**, exit 1, 25991.5632 ms. Исходник не менялся во время прогона.

Все семь отказов находятся в `tests/telegram-native-listener.test.mjs`: positive readiness, foreign IPv6, explicit IPv6, stopped/standalone mode, two-read missing proof, start-pending and foreign pending-to-running. Старые ответы schema 1 и PowerShell fixture должны быть проверены относительно нового фиксированного native schema 2 контракта. Это ещё не доказательство успешной новой реализации; expectations нельзя ослаблять для получения PASS.

[Исходный журнал](full-node.txt), SHA-256 `a3401e37d24b9a0d50cef39e984d34798c42086beedb0c15ae006ae7d60f0983`, и [исходный source-bound receipt](source-bound-receipt.json) сохранены без изменения. По этому результату пакет не подписывается и релиз не публикуется. Отдельная диагностика старых оригинальных GUI выполняется независимым workflow по этому harness commit; она не принимает новую поставку.
