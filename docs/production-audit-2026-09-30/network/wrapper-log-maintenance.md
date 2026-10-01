# Ограничение собственных WinSW журналов в Core

Дополнительный аудит подтвердил отдельный дефект retention: `<log mode="roll-by-size">` ограничивает stdout/stderr дочернего процесса, но не WinSW `.wrapper.log`. Точный исходный контракт и запуск официального EXE описаны в [wrapper-risk.md](../wrapper-risk.md). Двадцать настоящих `status` вызовов создали 1280 байт Debug append без ротации при child threshold 1 КиБ. Штатный polling продукта читает SCM напрямую, поэтому этот результат не означает рост wrapper.log на каждом обычном tick. Перезапуски, команды управления и ошибки всё же могут накапливать записи без ограничения.

`OwnedWrapperLogMaintenance.cs` добавляет проверку **только трёх точных путей**:

- `Runtime/SystemDoH/service-logs/egoistshield-system-doh-service.wrapper.log`
- `Runtime/TelegramProxy/service-logs/egoistshield-telegram-proxy-service.wrapper.log`
- `Runtime/Zapret/logs/zapret-service/egoistshield-zapret-service.wrapper.log`

Guard включается установленным Core после успешной проверки защищённого ProgramData root; console/lab режим его не включает. Production state root должен точно совпадать с `CommonApplicationData/EgoistShield/Service`. Root, его цепочка родителей, log и `.previous` проверяются `TrustedPath`; junction/reparse paths и чужой root отвергаются. Пути не берутся из XML или внешнего запроса. Не читается содержимое живых журналов.

Первая доступная проверка выполняется при tick supervision; следующие — через пять минут по `Stopwatch`, отдельно от DNS maintenance. При размере **5 МиБ или больше** выполняется один same-directory `File.Move(..., overwrite:true)` в `.previous`. Предыдущий архив заменяется; дополнительных поколений не создаётся. Следующая append-операция wrapper создаёт новый текущий файл. Службы не останавливаются, не перезапускаются и не завершаются ради ротации; открытый файл не обрезается. Sharing/access denial у rename откладывает его до следующего срока. Отказ у одного файла не блокирует другие файлы; неожиданный отказ guard не прерывает независимые проверки служб/DNS. Совместное предупреждение о его отказах ограничено одним разом в час по монотонным часам; сбой записи самого предупреждения также не прерывает supervision.

Предел размера **мягкий**. Запись между проверками, постоянная блокировка, длительная операция или активная network transaction могут оставить log выше порога; `.previous` сохраняет полный старый файл, который уже мог превысить 5 МиБ. Не установлена математическая верхняя граница для этих условий. Rename между событиями безопаснее принудительного truncate, но гарантии отсутствия потери каждого диагностического события при любом стороннем вмешательстве нет. Guard не обновляет EOL log4net и не заменяет оставшийся план обновления wrapper dependency.

Изолированный контроль без guard сохранил 5 244 160 байт после двадцати native append в заранее подготовленный 5 МиБ файл и завершился ожидаемым отказом проверки ротации. Это файловый контроль прежнего отсутствующего retention, а не запуск старого Core в живой установке. Поведение настоящего официального WinSW подтверждено отдельным аудитом выше.

Финальная проверка `tests/OwnedWrapperLogMaintenanceRegression`: **10 групп PASS**, 1,59 с. Выполнены 144 настоящие файловые ротации в 48 ускоренных сроках; один backup сохранял последнее поколение. Проверены повторная append, точный порог, отсутствие каталогов/файлов, lookalike файл, native sharing locks текущего/предыдущего журнала, реальный NTFS ACL отказ rename с восстановлением исходного DACL, junction в родителе и backup leaf, чужой root, отмена и монотонный срок. Дополнительно вызван helper настоящего compiled Core через reflection: повторные отказы давали только первое/часовое предупреждение; неожиданный guard exception и занятый `service.log` не выходили наружу. Это проверка продолжения после helper, без обращения к настоящему DNS контроллеру. Ускоренные сроки не являются месяцами фактического uptime.

При объединённом прогоне найден отказ самого fixture на длинном пути: Windows PowerShell 5 не создал junction. Fixture исправлен на проверенный PowerShell 7 из `LAGOM_TEST_POWERSHELL`, с fallback на `pwsh.exe` в PATH. Оба потока читаются параллельно с пределом 8 КиБ каждый; общий 15-секундный срок охватывает чтение и выход процесса. При отказе закрываются свои потоки и завершается только запущенный fixture child. На собственном длинном root прежний fixture сначала воспроизвёл отказ после восьми успешных групп; исправленный прошёл **10/10**, 2,12 с. Реальные junction пути имели длину **336 и 402 символа**, targets — 325 и 332. Пути не сокращались, проверки не пропускались; product code не менялся.

Core Release build прошёл: **0 errors, 141 warning** в восстановленном коде; новый guard не добавил compiler warning. Test build содержит четыре унаследованных nullable warning из `TrustedPath.cs`. Для согласованного lockfile контекста restore/build нужны `PublishSingleFile=true` и `SelfContained=true`: ILLink.Tasks уже закреплён в production lockfile. Санитизированное evidence и source hashes находятся в [wrapper-log-validation.json](wrapper-log-validation.json).

Повтор с временными файлами только в собственном task work:

```powershell
# From the selected project. Supply an absolute, isolated work path.
$wrapperWork = '<absolute task work>'
$env:TEMP = $wrapperWork
$env:TMP = $wrapperWork
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:LAGOM_TEST_POWERSHELL = '<absolute configured PowerShell 7 pwsh.exe path>'
$dotnet = '.\.tools\dotnet-10.0.401\dotnet.exe'
& $dotnet build src/service/EgoistShield.Service.csproj -c Release `
  -p:RestoreLockedMode=true -p:PublishSingleFile=true -p:SelfContained=true `
  "-p:BaseIntermediateOutputPath=$wrapperWork\core-obj\" `
  "-p:MSBuildProjectExtensionsPath=$wrapperWork\core-obj\" `
  "-p:OutputPath=$wrapperWork\core-bin\" '-p:DefaultItemExcludes=obj\**\*.cs'
& $dotnet build tests/OwnedWrapperLogMaintenanceRegression/OwnedWrapperLogMaintenanceRegression.csproj -c Release `
  "-p:BaseIntermediateOutputPath=$wrapperWork\test-obj\" `
  "-p:MSBuildProjectExtensionsPath=$wrapperWork\test-obj\" `
  "-p:OutputPath=$wrapperWork\test-bin\" '-p:DefaultItemExcludes=obj\**\*.cs'
& $dotnet "$wrapperWork\test-bin\OwnedWrapperLogMaintenanceRegression.dll" `
  --work $wrapperWork --core "$wrapperWork\core-bin\EgoistShield.Service.dll"
```

Не выполнялись установка/публикация, изменение живых SCM/DNS/процессов, reboot и фактически прошедший многомесячный soak. Junction/ACL fixtures создавались только в собственном временном каталоге; исходные fixture ACL восстановлены. Финальное установленное состояние и общий release gate остаются за объединённой проверкой координатора.
