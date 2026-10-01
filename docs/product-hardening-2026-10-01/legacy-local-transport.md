# Original local 3.7.8 transport for CI

The 3.7.8 matrix job can use the preserved, signed local generation without claiming that a public `v3.7.8` release exists. This transporter authenticates files and stages a fresh directory; it never runs an installer, launches a GUI, changes services, DNS, tasks or registry, or publishes assets.

Root's workflow downloads these exact temporary sidecars from the candidate transport draft:

* `legacy-local-EgoistShield-Setup-3.7.8.exe`
* `legacy-local-3.7.8-release-manifest.json`
* `legacy-local-3.7.8-release-manifest.json.sig`

The same candidate directory supplies `release-key-registry.json` and its signature. Both must equal the preserved original 3.7.8 registry bytes. The original manifest and signature must also equal their project records. Existing `authenticateLegacyRegistry` / `authenticateOfficialLegacyManifest(..., '3.7.8')` perform real Ed25519 verification against the project pinned root. There is no caller-supplied root, replacement signature, version override or bypass.

The actual Setup must be **194405835 bytes**, SHA256 **`34136729f0924e95af65b7fefd2792763c29694056b8ff76a79c9fe0e325f927`**, and match the original manifest SHA512. Its unchanged bytes are copied under the canonical name; signed metadata is copied unchanged under its original names.

## Integration

Run from the checked-out project using its Node runtime. Inputs must be ordinary directories below actual `RUNNER_TEMP`; `oldAssets` must be absent and its ordinary parent must already exist. Do not pre-create it. The sidecar and registry directories may be the same candidate directory.

```powershell
node tests/windows-legacy-local-transport.mjs stage `
  --sidecars "$env:RUNNER_TEMP/candidate" `
  --candidate-registry "$env:RUNNER_TEMP/candidate" `
  --old-assets "$env:RUNNER_TEMP/lagom-legacy-old" `
  --source-release-id $candidateReleaseId
```

`sourceReleaseId` is the positive integer ID of the **transport draft**; root's workflow must verify that draft and its assets through GitHub. This module does not assert API status. The CLI first requires actual hosted Windows Actions context, repository `egoist-ai1/egoist-lagom`, canonical run/attempt IDs and a 40-hex `GITHUB_SHA`. File transport itself needs no elevation. It records observed `GITHUB_SHA` as `harnessSourceCommit`, never as the old generation's source commit.

The importable `verifyLegacyLocalTransport` and `stageLegacyLocalTransport` accept `{ownedRoot, sidecarDirectory, candidateRegistryDirectory, oldAssetsDirectory, sourceReleaseId}`; the explicit owned root supports harmless own-directory tests. `verify` is read-only. `stage` authenticates all sources before creating the fresh destination, rejects junction/symlink ancestors and hardlinked files, bounds reads, uses exclusive copies, and rechecks size/SHA256/SHA512 on every output. Existing destinations, source overlap, escaped paths, Windows aliases, extra prefixed sidecars and unknown options fail. A post-copy failure leaves only the fresh owned partial directory for inspection, without a success provenance receipt; it never recursively deletes paths.

Successful `oldAssets` contains canonical Setup, manifest/signature, registry/signature and `provenance.json`. Provenance explicitly records `transport='original-signed-local-generation'`, `publishedOriginVerified=false`, `sourceReleaseIdRole='transport-draft'`, `draftApiStatusVerifiedByTransporter=false`, `installerExecuted=false` and `publicFeedDiscoveryTested=false`. Root owns temporary sidecar uploads and exact asset-ID cleanup before candidate publication.

## Verified scope

Node 24.19.0: **13/13 tests PASS, zero skips**, and both JavaScript syntax checks PASS. Tests authenticate the actual preserved metadata and copy the actual original 194 MB installer in this task's isolated work directory without execution. They also reject corruption of that installer while preserving its size, altered metadata, missing/extra/case-substituted names, hardlinks/junctions, foreign paths and non-fresh destinations. Both actual CLI commands refuse this physical non-hosted process before reading inputs or writing paths.

The bounded TAP log, original-file provenance receipt, exact source hashes and observed baseline HEAD are in `legacy-local-transport.json`. Native installation, old-helper handoff, public feed discovery, reboot and long-duration operation are **not** proved by these file-only checks. The original 3.7.8 `minimizedAfter`-absent state compatibility is handled by the separately tested production reader; this transporter imports no state.
