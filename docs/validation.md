# Egoist Lagom — validation record

This release was built from the maintained workspace on Windows 11 Pro x64, build 26200.

| Check | Result |
| --- | --- |
| JavaScript test suite | 304 / 304 passed |
| Production dependency audit | 0 vulnerabilities |
| Core release build | passed |
| Packaged Core self-test | passed |
| DNS ownership and mixed-address restore | passed |
| JSON locking regression | passed |
| Installer PowerShell self-test | passed |
| NSIS installer execution checks | 5 / 5 passed |
| UI layout and keyboard checks | passed |
| Package integrity | 9 required payload files, 183 ASAR entries |
| NSIS build | exit code 0 |

The installer uses the normal administrator elevation requested by Windows. It releases only application-owned processes, services and files under its canonical paths. The release asset is distributed with a SHA-256 file.

Final public asset: `Egoist-Lagom-Setup.exe`  
SHA-256: `E44DD4454132ADB51AE858FBBA724ED99B6E1A02932C353F13AEE697F72A7843`

The local host was not replaced or altered during these checks. A disposable Windows 10 acceptance image was not available, so Windows 10 compatibility is covered by API, path, service, localized-output and configuration tests rather than a guest install receipt. The local EXE is unsigned Authenticode; SmartScreen publisher trust therefore needs a signing certificate for public distribution.
