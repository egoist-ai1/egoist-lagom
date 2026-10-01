# First hosted Core owner regression: missing inner diagnostics

[Exact-source PR job](https://github.com/egoist-ai1/egoist-lagom/actions/runs/36820418763/job/110234591015), source `900d84aaa218d090b7b78904dcb03a720b67503d`, failed in the new Core owner regression step. The harness compiled and attempted the EXE run, then returned failure. Its run.log and results.json were redirected to runner-owned files, and this initial test job did not upload them or print the inner failure. Therefore the actual inner cause is **unknown**. This log does not establish that the production owner correction failed.

The same job passed Node (878 cases: 866 passed, zero failed, 12 explicit environment/asset-dependent skips), 27 Core fault groups on actual .NET 8.0.31, and full Core persistence/crash stress. Actual NTFS stress recorded 10,000 writes and 50,000 reads: zero false Missing, unavailable or malformed reads. The formerly failing live-log reader passed this time. Wrapper and PS5 installer steps were not reached after the new regression failure.

The separate actual administrator configure check passed in run 36820434838 and is preserved in `../core-owner-native-run/`. The 900d84 package build completed, but no signed release acceptance or local installation is inferred. Preserve the inner owner regression diagnostics and reproduce on the real hosted environment before fixing its cause; do not weaken the assertion based on a guess.

The original 270,499-byte job log is preserved unchanged. `receipt.json` records its SHA256 and the precise pass/failure boundaries.
