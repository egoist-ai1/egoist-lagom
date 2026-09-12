# Egoist Lagom — final release

Egoist Lagom is the compact black-and-white Windows workspace for local network settings, connection profiles, encrypted DNS, Telegram Relay and service maintenance.

This release includes the polished Lagom interface, neutral public copy, corrected narrow layouts, readable event rows, hidden background PowerShell tasks and the transactional installer fixes validated in the project test suite.

The installer requests normal administrator elevation because Windows service and adapter configuration require it. It releases only application-owned paths and preserves external user settings. Optional components remain off after a clean install until the user enables them.

Validation: 304/304 project tests passed, production dependency audit reported no vulnerabilities, the packaged Core self-test passed, and the NSIS execution suite passed 5/5.

The local installer is unsigned Authenticode. Verify the SHA-256 asset before running it. Use Egoist Lagom only on computers and services you own or are authorized to administer.
