# Audit-only reproducers

Baseline: Egoist Lagom source `199236e3b227f9885c2beef64faffbe9e9a35583`. These scripts intentionally assert observed baseline defects; they are not post-fix acceptance tests.

Arguments for each script: absolute project root, then the active task's own absolute work directory outside the project. Use the directory returned by `brain task paths --id <actual CODEX_THREAD_ID>`. Do not use another task's runtime.

```powershell
node <this-directory>/audit-boundaries.mjs <absolute-project-root> <own-task-work>
node <this-directory>/audit-shared-download.mjs <absolute-project-root> <own-task-work>
node <this-directory>/audit-canonical-url.mjs <absolute-project-root> <own-task-work>
```

The boundary script reads actual source, evaluates only relevant functions and writes inert fixtures. The shared-download script uses one owned loopback HTTP listener and closes its sockets; it shortens the header budget to expose the distinction from a body deadline. Its open-failure case uses a controlled response stream and an actual own directory. The URL script performs no network operation. No installed EXE, GUI, native engine, installer, service, DNS or privilege change is invoked.

Receipts are written only to the supplied task work. SHA-256 of source is recorded. Raw vendor documentation and actual machine/user configuration are excluded from published evidence. The syntax and original executions were checked by the audit; a later source snapshot can intentionally make a baseline assertion fail because the defect was repaired.
