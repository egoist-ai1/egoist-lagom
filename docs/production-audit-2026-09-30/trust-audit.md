# Release-key registry lifecycle audit — 2026-09-30

Baseline: published `3.7.9`, commit `d56eb9327fa75a88e91fae62b8d7ea3ed095dcf2`. This change belongs to the new production candidate. The existing public release, installed application, service configuration and private signing keys were not changed by this audit.

## Reproduced defect

Hosted acceptance later exposed a test-lifecycle race: manifest timeout returns before the concurrent authenticated cache writer finishes. Test cleanup now waits for already-started registry work before removing its own directory. A controlled delayed-write regression proves both the old failure and the corrected wait without extra fetches. This changes only the fixture; production trust policy is unchanged.

The previous `loadTrustedKeyRegistry()` authenticated only the bundled registry. An otherwise valid release signed by a key subsequently revoked in a newer root-signed remote registry was still accepted. The same logical fixture against the exact baseline source failed with `actual: trusted`, `expected: untrusted`. The fixture uses newly generated in-memory keys and signed public test metadata; it does not access any product private key or publish a revocation.

## Implemented policy

The application keeps the root public key embedded in its validated package. It never downloads, adopts or persists a remote root. Both remote registry files come from the fixed `egoist-ai1/egoist-lagom` latest-release asset paths. The exact registry bytes and detached signature must pass Ed25519 verification with the bundled root before JSON validation, key selection or cache persistence.

Registry schema remains version 1. Its root-signed `generatedAt` timestamp acts as the monotonic generation. This preserves the existing public registry format. A successor must satisfy all of these conditions:

- Its generation is at least the highest authenticated bundled/cached generation. A lower generation is blocked.
- Equal generations must contain identical bytes, as established by SHA-256. A changed registry needs a new signed `generatedAt`.
- Every previous key ID remains present. To retire a key, publish an explicit `revoked` entry instead of deleting it.
- An existing key ID keeps the same public-key material. A rotated key needs a new ID. Equivalent PEM formatting is permitted because SPKI DER is compared.
- A revoked key stays revoked, including after application upgrades and subsequent offline reads.
- The registry is not dated more than 15 minutes ahead of the local clock. The failure tells the user to check Windows time.
- All keys use Ed25519, have unique supported IDs and a nonempty validity interval. Registry count and byte size are bounded.

Revocation takes priority over the signed manifest's publication time. Key expiry continues to use the manifest's signed publication time: a legitimately signed historical release remains verifiable after its signing key expires, provided the currently selected authenticated registry has not revoked that key. This deliberately preserves the established archive policy; it is not a claim that a retired private key remains safe indefinitely.

## Refresh, offline behavior and persistence

Every release trust verification attempts a fresh registry read. Concurrent verifications for the same explicit user profile share one in-flight request pair; the next operation rereads and reauthenticates the cache and attempts the network again. The updater passes `userDataDir` explicitly. The trust loader does not guess an Electron worker profile or use another application's data.

Each registry asset has a 5-second budget covering redirects and body consumption, with no retries in this refresh. A registry is at most 256 KiB and its signature at most 1 KiB. HTTPS redirects are limited to four and the existing GitHub release-asset hosts. Unsafe destinations, credentials, unexpected ports, bad sizes, missing bodies and malformed metadata are blocked. Every acquired response body or reader is cancelled on success or failure; acquired readers also release their locks. The deadline remains active after response headers arrive.

The cache is `updates/release-key-registry-cache.json` inside the explicit profile. It contains only public signed bytes, their detached signature and a fingerprint of the packaged root. It is limited to 512 KiB and cryptographically reauthenticated on every new read. A unique temporary file is written, flushed and atomically renamed; a persistence failure blocks adopting a new generation. Temporary bytes are removed on failure. A newly packaged newer registry advances an older cache even if the network is unavailable.

An ordinary network timeout, connection failure, temporary HTTP error or absent remote asset can use the highest authentic local registry. The result visibly warns: `Не удалось получить свежий registry release keys. Использован проверенный локальный registry; новые отзывы ключей могут быть неизвестны.` No offline maximum age is invented. An invalid signature, corrupt local cache, rollback, generation conflict, key substitution or revoked-key resurrection fails closed. The application does not silently fall back to older bundled keys.

The updater preserves the trust failure code and explanatory message. A REST candidate failing signature or registry trust cannot be retried through the stable channel to hide that failure. Ordinary manifest network failures retain `offline`, `timeout` or `release-not-found` and remain retryable; they can try an independently authenticated stable manifest. When REST itself is unavailable, a stable-channel trust failure is likewise returned directly. Its previous generic SmartScreen message also discarded registry freshness warnings: a new regression reproduced that failure before the updater was corrected. Actual warnings now appear in the available result and progress messages and remain present during installation. This coupling is tested using the combined production source.

## Verification

The targeted run passed **30 of 30 tests**, with no skips: 24 registry lifecycle regressions plus 6 existing release regressions. New cases include remote revocation on both manifest paths, rotation, foreign-root signatures, authenticated offline revocation, bundled offline operation, cache tampering on a subsequent read, older/equal conflicting generations, retained IDs, replaced key material, revoked-key resurrection, future clock handling, persistence failure, redirect rejection, oversized headers, coalesced requests, missing profile, historical expiry, updater error propagation, visible offline warnings and truthful transport fallback handling.

Two body-stall checks exercised the 5-second boundary. One used a controlled reader that never resolves, proving the explicit read deadline independently of transport behavior. Another used native Node `fetch` against a task-local HTTP server that sent headers and partial bytes but never completed its response. Both returned an explicit offline freshness warning and cleaned the owned stream. The native fetch fixture took approximately 5.03 seconds. These are transport regressions, not a claim that a production TLS outage was induced.

A separate read-only check used the production trust source and real native HTTPS against the public `3.7.9` assets in an isolated task profile. The root-signed registry was accepted with generation `2026-09-29T12:02:01.705Z` and three keys. The public stable manifest was accepted under `release-2026-09-recovery`, with installer SHA-256 `eb8db40e80201f5e9bf153368da8131325c0253bbc13a842c95f3f2725e04cc6`. Redirect URLs in the published receipt omit query strings. The stable verification helper was invoked directly; its standard REST fallback warning is not evidence that the REST API was unavailable during this check.

Evidence:

- [Baseline regression](trust/baseline-regression.json)
- [Targeted regressions](trust/targeted-regressions.json)
- [Public signature verification](trust/public-verification.json)

## Remaining practical limits

Existing `3.7.8` and `3.7.9` clients still contain the previous bundled-only loader; they acquire this refresh behavior after installing the new application build. Versions `3.7.7` and earlier retain the documented manual migration requirement. Nothing bypasses the prior trusted key or changes the published `3.7.9` assets.

An owner can delete or replace their local profile. The authenticated cache protects against tampering and rollback while its state remains present; it does not provide a hardware-backed monotonic floor. Deleting it resets the local floor to the bundled registry. A signed generation is not a signed freshness deadline: a network response marked `checked` means that the received registry authenticated successfully, not that the server cannot be withholding a newer one. Offline clients cannot know a revocation they have never received. The currently public registry contains no newly revoked key, so an actual public remote revocation remains untested; its behavior is established by ephemeral-key logical fixtures.

The pinned root cannot rotate through this channel. Root replacement requires a separately authorized application trust migration. No new private key, signing event, public registry update, installed-client automatic upgrade or month-long runtime claim is part of these results.
