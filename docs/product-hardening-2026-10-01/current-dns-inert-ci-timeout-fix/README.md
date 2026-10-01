Hosted source CI36881877373 /job110435408549 (ac817bc) failed two tests: the separately corrected Telegram fixture and this inert DNS library/C# compile test. The latter returned status=null after15540ms against spawnSync timeout15000ms. stderr/stdout were empty, so the exact slow substage was not observed; compilation was included in that same deadline.

Only the inert import/path/junction/C#-compile call now receives a bounded45000ms test budget, and assertion diagnostics retain child error code/signal. Physical-host refusals keep their15000ms budget; production DNS query20s and mutation120s are unchanged. No DNS/SCM/registry/task operation is enabled or executed.

Targeted current test8/8PASS0skip,1986.4104ms with actual Windows PowerShell5.1; actual readonly native query is not invoked. Hosted final source CI remains required. Raw CI and local GREEN retained.
