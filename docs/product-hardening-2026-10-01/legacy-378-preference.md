# Совместимость launch preference с настоящей 3.7.8

Из оригинального подписанного Setup 3.7.8 извлечён старый helper: SHA-256 `e33bca4550b6e130287c8bb2d5c0dccf30b76e033bf99520e81d6c2acda609f5`, 62614 bytes. Его schema 1 state содержит `runAfter`, но не содержит `minimizedAfter`. Предыдущая реализация нового reader требовала оба поля и могла остановить обновление до handoff.

Reader теперь требует точный JSON boolean `runAfter`. Необязательный `minimizedAfter` при наличии также должен быть точным boolean; отсутствующее поле соответствует поведению исходной 3.7.8 — `false`. Canonical protected stage, SYSTEM/Administrators owner, закрытые права записи, запрет reparse paths и предел 4 MiB сохраняются. Из старого state по-прежнему извлекаются только launch preferences: service snapshots, installer paths и другие поля не импортируются.

Регрессия с собственными реальными JSON-файлами воспроизвела отказ на исходниках `9bf77129ccc2aeac741bf109b8ab6c9368fac558`. После изменения прошли **15 групп на PowerShell 7 и 15 на Windows PowerShell 5.1**. Проверены оба Boolean значения `runAfter`, отсутствующий `minimizedAfter`, отказ null/string optional field и malformed/missing `runAfter` до lease/staging. Предыдущие ACL/lease/watchdog/NoRunAfter проверки остаются в том же наборе.

Логи, receipts и точные source hashes: [evidence](legacy-378-preference/receipt.json). ACL fixtures проверяют production policy с настоящими Windows security descriptors, а не утверждают изменение владельца на физическом host. Все live SCM/DNS/TUN/Task/registry writes — 0. Настоящий old-helper переход должен подтвердиться отдельной матрицей Windows acceptance; этот файловый тест не выдаётся за установку.

Предыдущий [launch preference report](legacy-launch-preference.md) описывает свой исходный frozen scope; его raw evidence сохранён.
