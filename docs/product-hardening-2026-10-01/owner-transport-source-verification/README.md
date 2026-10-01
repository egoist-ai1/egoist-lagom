# Owner correction and original legacy transport: integrated source checks

The complete integrated Node suite passed **878/878**, with zero failed, skipped or cancelled cases, in 25,459.5515 ms. The log is preserved unchanged. Four installer diagnostic checks also passed on Windows PowerShell 5.1: complete bounded CIM retry, exact bounded failure-log copying, physical-host refusal before Setup/Core actions, and real duplicate PATH result resolution. Workflow actionlint returned 0; its empty successful output is preserved.

`receipt.json` identifies the pre-commit working tree and hashes all 17 changed source/harness files. This is source verification; it does not identify a rebuilt installer or assert native release acceptance. The Core owner/ACL and actual live-log sharing regressions, locked self-contained publish, existing VPN/privacy checks and linked partial-project builds are documented separately in `../core-owner-fix.md` with their own evidence.

The next gate is actual elevated Core configuration in the production-shaped ProgramData directory on a clean hosted Windows runner. The full signed Setup then needs fresh installation, ordinary GUI, DNS/TUN and both original-helper upgrade gates. Original 3.7.8 is transferred as unchanged signed local bytes; its public stable feed was never switched, and no such public provenance is claimed. Temporary old-version sidecars must be removed from the draft before publication.

The actual failed signed Setup and separate live-log persistence failure are preserved in `../core-install-owner-failure/`. No product SCM, DNS, TUN, scheduled-task or registry changes were made on the user's installed machine during these source checks.

The final source-only diagnostic uses the independently tested separate locked restore and single-file publish with isolated intermediate paths. It also checks the actual marker4 file. Those final harness changes were made after the complete Node run; the affected four diagnostic tests passed again on PS7, and the PowerShell parser passed. The final harness hash is included in this receipt. Actual configure behavior is still delegated to the hosted gate.
