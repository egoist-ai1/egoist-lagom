# Security

Egoist Lagom is a Windows desktop application for managing local network settings and owned background services. The installer requests administrator access because Windows service and adapter configuration require it.

Release files include SHA-256 metadata. Verify the hash before running an installer. Authenticode signing may be unavailable for a local build, so the Windows publisher identity and SmartScreen reputation must be checked separately.

Installation and removal operate on the application's canonical directories and service paths. A process or service with the same name outside those paths is not treated as part of Egoist Lagom.

To report a vulnerability, use a private GitHub Security Advisory. Do not include credentials, private endpoint URLs or unredacted logs in a public issue. Include the release, Windows build, reproducible steps and a minimal sanitized trace.
