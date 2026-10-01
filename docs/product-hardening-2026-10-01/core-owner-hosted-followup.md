# Follow-up: visible Core owner regression failures

The [actual hosted PR check](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36820418763/job/110234591015) at source `900d84aaa218d090b7b78904dcb03a720b67503d` failed in the new Core owner regression runner. The original runner preserved its inner output on the disposable host but did not print it or upload an artifact. The cause of the failed inner group is **unknown**. No production defect or harmless SDDL metadata difference is inferred from this missing evidence.

Only `tests/core-owner-regression.ps1` changed. Before throwing, it now prints the failed group names/errors and the last 16 KiB of the actual run log; build failures print the same bounded build-log tail. The evidence directory is printed before the build. Invalid or oversized result JSON cannot mask the original nonzero runner exit. Complete local files and existing source/hash receipts remain preserved. The eight C# groups, their assertions and production code are unchanged.

Local parser validation passed with zero errors. Four checks executed the actual diagnostic functions using explicitly labelled own fixtures: a real 64 KiB file retained only its bounded error tail, passed groups were excluded from the failure summary, oversized error output was truncated, and missing evidence did not throw. This verifies observability, not the still-pending hosted eight-group outcome.

The same source already [passed actual elevated Core configuration](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36820434838/job/110234655159): real ProgramData root, private Service/config/marker owners read back as BuiltinAdministrators; private DACLs contain only SYSTEM and Administrators FullControl; marker 4 and network preservation passed. This was a source-built diagnostic EXE, with no installer or registered product service. Both accepted evidence inventories were independently checked against their recorded file hashes.

The first hosted PR run separately passed 866 Node tests with 12 skips and zero failures, all 27 Core fault groups on actual .NET 8.0.31, and 10,000 atomic writes / 50,000 reads with zero false missing, unavailable or malformed results. Its production persistence groups and live-file reader also passed. These successful checks do not resolve the unidentified owner-harness failure.

Frozen raw working-byte hashes:

| File | SHA256 |
| --- | --- |
| `tests/core-owner-regression.ps1` | `C4B509929DCF8B43798776FE6464B274EF59763B020DD226E0AA33725EF221B4` |
| `tests/core-owner-regression.cs` (unchanged) | `D151B052B30E281CE5D52536B2DD618620A73085A349C7E110D4D9FBF9463E00` |

The parent adds always-uploaded CI evidence and repeats the same owner harness on the real hosted administrator. Any assertion fix requires that captured failure. Signed whole Setup, installed service/network/legacy acceptance and months of uptime are not established here; `releaseReady=false`.

The [machine-readable receipt](core-owner-hosted-followup.json) records exact bounds, local checks, accepted raw log and source hashes. Initial raw job log: 270,499 bytes, SHA256 `004A76C334ADD98EBB6EC2CBC799C3B409431BE0F974A2A3E82FCEAE65E8642F`.
