# Telegram cleanup fixture follow-up

Base source: `ac817bc6a2534aaa47cf21798041d3cfa41bbaca`. Only `tests/lagom-runtime-regressions.test.mjs` was changed. The old fixture omitted the injected process/Windows environment and still expected a PowerShell CIM error after production had moved to the fixed native cleanup command.

The fixture now supplies `path.win32`, `process.platform=win32`, the explicit Windows ProgramData root, and a fixed resources path. It uses the actual protected Telegram runtime path and expects the injected native discovery failure object to propagate unchanged. Assertions still require exactly one invocation, now of the exact core-service executable with `--telegram-runtime-cleanup --runtime primary`, and require no saved-state clearing. This also excludes any fallback image-name kill command.

The entire relevant file was run before and after the fixture update:

- RED: **15/16 PASS, 1 FAIL, 0 skip**, 812.7264 ms. The failing test received ReferenceError for the omitted process fixture.
- GREEN: **16/16 PASS, 0 FAIL, 0 skip**, 840.2289 ms.

Full raw outputs are `telegram-fixture-red.txt` and `telegram-fixture-green.txt`. The file SHA256 and evidence hashes are in `report.json`.

No production file was changed, no C# rebuild or native cleanup rerun was performed, and no physical service/network/registry/GUI state was modified. The changed failure case remains an injected source-contract test. The independent installer EBUSY fixture, README/root raw evidence and full-source rerun belong to root and were not touched. Previous frozen reports were not edited.
