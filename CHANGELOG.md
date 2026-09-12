# Changelog

## Egoist Lagom — final 3.7.0

- Reframed the public product identity around the compact black-and-white Lagom interface.
- Replaced public copy with concise, neutral language for connection profiles, DNS/DoH, local relay services and diagnostics.
- Fixed DNS preparation before profile selection, affirmative readback after apply, cancellation and UTF-8 result-size limits.
- Made installation phases silent, transactional and recoverable. The installer now releases only processes and services under its own canonical paths.
- Added atomic runtime recovery, retry handling for busy files, deterministic rollback and an installation mutex.
- Corrected narrow settings layouts, log-row wrapping, keyboard dialogs and reduced-motion behavior.
- Added executable Windows installer regressions and a generated package-integrity manifest.

The technical service identifiers remain stable for existing installations.
