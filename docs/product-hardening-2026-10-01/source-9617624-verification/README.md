# Проверка зафиксированных исходников 9617624

Локальный набор: **924/924 PASS, 0 skips**, exit 0, исходники не менялись во время проверки. Windows PR CI: **910 PASS, 14 skipped, 0 failed из 924**; журнал сохранён целиком. Дополнительные этапы Core fault/recovery/persistence stress, protected ACL и installer safety прошли в этом реальном Windows job. Эти результаты не выдаются за установленное приложение или многомесячную эксплуатацию.

Установщик пересобран, NSIS exit 0; 18 файлов выпуска подписаны Ed25519 и локально проверены. Authenticode отсутствует. Подписанный пакет имеет source commit 9617624b888d9e8bd2b1df1e60ca4a21947f5c2d, tree a99d45e7c306da25bdea60de1034cec530db0c1f и Setup SHA256 d77eb1b2ecac06df191cf2953653213377068beaaa3b0e447297e17f468b026c.

Настоящая приёмка GUI/SCM/DNS/TUN и restored-original helper handoff идёт отдельно в запуске 36856686510; этот snapshot не объявляет её успешной, физическая установка и публикация ещё не выполнялись. [Receipt и хеши](receipt.json).
