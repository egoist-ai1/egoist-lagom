# Atomic ACL comparison: observed NTFS metadata

The [actual administrator capture](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36823434766/job/110243766727) identified the owner harness failure. After 256 replacements, the nonproduction file owner remained Administrators and every ordered ACE, access mask, inheritance flag, protection and canonical state matched. The only change was DACL automatic-inheritance control bit `0x400`: flags `32772 → 33796`, SDDL `D: → D:AI`. All 256 concurrent reads were valid, with zero missing values. Actual production configure returned 0 and the network fingerprint matched. Eight accepted artifact files were independently checked against their recorded hashes.

The test now ignores **only that observed control bit** when comparing nonproduction files. Owner, exact ordered DACL binary bytes, protected/canonical state and every other control flag must still match. Production ACL enforcement was not modified; `src/service` has no changes between source `900d84` and frozen test commit `d1ea1cf54b6b6b33508f1b0edb448be169441fca`.

The new ninth group compiles the exact historical AtomicJsonFile snapshot in a separate test assembly. Its raw fixture SHA is pinned before compilation, its normalized text matches the `ead2beb` Git source, and its original bytes are preserved with the root-owned `-text` Git attribute. On the current token, the group performs 256 historical replacements, 256 direct managed replacements and 256 native `ReplaceFileW` replacements with flags 0. It retains real initial/final descriptors on PASS. Five in-memory negative cases separately refuse changed owner, ACE rights, other control flags, protection and ACE order.

Both isolated local comparisons, before the assertion correction, passed 256 replacements / 256 valid reads with no missing result and unchanged SDDL. Direct managed/native replacements preserved a deliberately distinct destination DACL. The exact pinned SDK then compiled the final historical library and owner harness; **9/9 groups passed locally**. This local token is neither SYSTEM nor administrator. The next real administrator run is required to confirm the historical/native transition on that host; local results alone do not establish it.

Microsoft documents DACL preservation and distinguishes the ignore-error flags. The pinned .NET 10.0.12 source maps the three-argument managed overload to `ignoreMetadataErrors=false`, then native flags 0. The automatic-inheritance bit is a separate descriptor control flag. These contracts support the targeted comparison; the actual before/after capture is the evidence that rights did not change. [ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew), [descriptor controls](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-descriptor-control), [.NET overload](https://github.com/dotnet/runtime/blob/v10.0.12/src/libraries/System.Private.CoreLib/src/System/IO/File.cs), [.NET Windows mapping](https://github.com/dotnet/runtime/blob/v10.0.12/src/libraries/System.Private.CoreLib/src/System/IO/FileSystem.Windows.cs).

Frozen raw source hashes:

| File | SHA256 |
| --- | --- |
| `tests/core-owner-regression.cs` | `7EBD1DBEDCB2315AEA382BA95E700DA3E013CA19541CA7622053B5FC9298E15E` |
| `tests/core-owner-regression.ps1` | `D5D368D0CA4D390D8E156F3B655B465C54F13986D9CD463690CBACBF4D092D05` |
| `tests/fixtures/AtomicJsonFile.ead2.cs` | `1EE6256769F2D036DD93B114B6D89CD72BC1530CB3FDA9DEF7139873042FA231` |

The [structured receipt](core-owner-atomic-acl-followup.json) preserves the captured administrator descriptors, local real before/after comparisons and precise source/build hashes. Fast administrator run `36824899477` and full PR `36824901562` were started by the parent and remain pending in this receipt. Signed whole Setup, installed services/network/legacy acceptance and sustained uptime remain separate gates; `releaseReady=false`.
