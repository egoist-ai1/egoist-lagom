var RELEASE_MANIFEST_NAME = "release-manifest.json";
var RELEASE_MANIFEST_SIGNATURE_NAME = "release-manifest.json.sig";
var RELEASE_KEY_REGISTRY_NAME = "release-key-registry.json";
var RELEASE_KEY_REGISTRY_SIGNATURE_NAME = "release-key-registry.json.sig";
var RELEASE_ROOT_PUBLIC_KEY_NAME = "root-public-key.pem";
function getBundledReleaseDirectoryCandidates() {
  const resourcesPath = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
  if (resourcesPath.length > 0 && !/[\\/]node_modules[\\/]electron[\\/]/i.test(resourcesPath)) return [path.resolve(resourcesPath, "release")];
  return [path.resolve(process.cwd(), "resources", "release"), path.resolve(__dirname, "..", "..", "..", "resources", "release")];
}
async function readBundledReleaseFile(name) {
  for (const directory of getBundledReleaseDirectoryCandidates()) try {
    return await promises.readFile(path.join(directory, name));
  } catch {
  }
  throw new Error(`\u0412 \u0441\u0431\u043E\u0440\u043A\u0435 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 ${name}.`);
}
function decodeUtf8Json(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} \u043D\u0435 \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u043C UTF-8.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 JSON.`);
  }
}
function decodeDetachedSignature(bytes, label) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  if (!/^[A-Za-z0-9+/]{80,100}={0,2}$/.test(text)) throw new Error(`${label} \u0438\u043C\u0435\u0435\u0442 \u043D\u0435\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442.`);
  return Buffer.from(text, "base64");
}
function assertIsoDate(value, field) {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) throw new Error(`\u041F\u043E\u043B\u0435 ${field} \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0443\u044E \u0434\u0430\u0442\u0443.`);
  return value;
}
function assertDigest(value, algorithm, field) {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${algorithm === "sha256" ? 64 : 128}}$`, "i").test(value)) throw new Error(`\u041F\u043E\u043B\u0435 ${field} \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 ${algorithm.toUpperCase()}.`);
  return value.toLowerCase();
}
function validateKeyRegistry(value) {
  const registry = value;
  if (!registry || typeof registry !== "object" || registry.schemaVersion !== 1) throw new Error("\u0421\u0445\u0435\u043C\u0430 registry \u043A\u043B\u044E\u0447\u0435\u0439 \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F.");
  assertIsoDate(registry.generatedAt, "generatedAt");
  if (!Array.isArray(registry.keys) || registry.keys.length === 0) throw new Error("Registry \u043D\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 release keys.");
  const ids = /* @__PURE__ */ new Set();
  for (const key of registry.keys) {
    if (!key || typeof key !== "object" || typeof key.id !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(key.id)) throw new Error("Registry \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 key ID.");
    if (ids.has(key.id)) throw new Error("Registry \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043F\u043E\u0432\u0442\u043E\u0440\u044F\u044E\u0449\u0438\u0439\u0441\u044F key ID.");
    ids.add(key.id);
    if (key.algorithm !== "Ed25519" || key.status !== "trusted" && key.status !== "revoked") throw new Error(`Registry \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043D\u0435\u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C\u044B\u0439 \u043A\u043B\u044E\u0447 ${key.id}.`);
    if (typeof key.publicKeyPem !== "string" || !key.publicKeyPem.includes("BEGIN PUBLIC KEY")) throw new Error(`Registry \u043D\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 public key ${key.id}.`);
    assertIsoDate(key.notBefore, `${key.id}.notBefore`);
    assertIsoDate(key.notAfter, `${key.id}.notAfter`);
  }
  return registry;
}
function validateManifest(value) {
  const manifest = value;
  if (!manifest || typeof manifest !== "object" || manifest.schemaVersion !== 2) throw new Error("\u0421\u0445\u0435\u043C\u0430 release manifest \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F.");
  if (manifest.channel !== "stable") throw new Error("\u0420\u0430\u0437\u0440\u0435\u0448\u0451\u043D \u0442\u043E\u043B\u044C\u043A\u043E stable release channel.");
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("\u0412\u0435\u0440\u0441\u0438\u044F release manifest \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430.");
  if (manifest.tag !== `v${manifest.version}`) throw new Error("Tag \u0438 version release manifest \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u044E\u0442.");
  if (manifest.installerName !== `EgoistShield-Setup-${manifest.version}.exe`) throw new Error("\u0418\u043C\u044F Setup \u0432 release manifest \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E.");
  if (typeof manifest.canonicalDownloadUrl !== "string") throw new Error("\u041E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 canonicalDownloadUrl.");
  const canonicalUrl = new URL(manifest.canonicalDownloadUrl);
  if (canonicalUrl.protocol !== "https:" || canonicalUrl.hostname.toLowerCase() !== "github.com" || canonicalUrl.pathname !== `/egoist-ai1/egoist-lagom/releases/download/${manifest.tag}/${manifest.installerName}` || canonicalUrl.search || canonicalUrl.hash) throw new Error("Canonical download URL \u043D\u0435 \u043F\u0440\u0438\u043D\u0430\u0434\u043B\u0435\u0436\u0438\u0442 release channel Egoist Lagom.");
  if (!Number.isSafeInteger(manifest.size) || Number(manifest.size) <= 0 || Number(manifest.size) > 1024 * 1024 * 1024) throw new Error("\u0420\u0430\u0437\u043C\u0435\u0440 Setup \u0432 release manifest \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0435\u043D.");
  manifest.sha256 = assertDigest(manifest.sha256, "sha256", "sha256");
  manifest.sha512 = assertDigest(manifest.sha512, "sha512", "sha512");
  if (manifest.githubDigest !== `sha256:${manifest.sha256}`) throw new Error("GitHub digest \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u0435\u0442 \u0441 SHA-256 release manifest.");
  if (typeof manifest.minimumAppVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.minimumAppVersion)) throw new Error("minimumAppVersion \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430.");
  if (typeof manifest.keyId !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(manifest.keyId)) throw new Error("keyId release manifest \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0435\u043D.");
  if (manifest.authenticodeStatus !== "valid" && manifest.authenticodeStatus !== "not-signed") throw new Error("Authenticode status release manifest \u043D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0435\u043D.");
  if (typeof manifest.licenseVersion !== "string" || !manifest.licenseVersion.trim()) throw new Error("licenseVersion release manifest \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442.");
  assertIsoDate(manifest.publishedAt, "publishedAt");
  return manifest;
}
async function loadTrustedKeyRegistry() {
  const [registryBytes, signatureBytes, rootPublicKeyBytes] = await Promise.all([
    readBundledReleaseFile(RELEASE_KEY_REGISTRY_NAME),
    readBundledReleaseFile(RELEASE_KEY_REGISTRY_SIGNATURE_NAME),
    readBundledReleaseFile(RELEASE_ROOT_PUBLIC_KEY_NAME)
  ]);
  if (!verify(null, registryBytes, createPublicKey(rootPublicKeyBytes), decodeDetachedSignature(signatureBytes, "release-key-registry.json.sig"))) throw new Error("\u041F\u043E\u0434\u043F\u0438\u0441\u044C registry release keys \u043D\u0435 \u043F\u0440\u043E\u0448\u043B\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443.");
  return validateKeyRegistry(decodeUtf8Json(registryBytes, RELEASE_KEY_REGISTRY_NAME));
}
function pickAssetUrl(release, releaseApiUrl, tagName, assetName) {
  return (Array.isArray(release?.assets) ? release.assets.find((item) => item.name === assetName) : null)?.browser_download_url ?? buildGitHubAssetDownloadUrl(releaseApiUrl, tagName, assetName);
}
async function verifyRemoteReleaseTrust(options) {
  const manifestUrl = pickAssetUrl(options.release, options.releaseApiUrl, options.tagName, RELEASE_MANIFEST_NAME);
  const signatureUrl = pickAssetUrl(options.release, options.releaseApiUrl, options.tagName, RELEASE_MANIFEST_SIGNATURE_NAME);
  if (!manifestUrl || !signatureUrl) return {
    trustStatus: "missing-manifest",
    manifest: null,
    manifestVerified: false,
    releaseChannel: null,
    installerSigned: false,
    sha256: null,
    manifestDigest: null,
    keyId: null,
    warnings: ["\u0420\u0435\u043B\u0438\u0437 \u043D\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u0439 manifest schema v2."]
  };
  try {
    const [manifestResult, signatureResult, registry] = await Promise.all([
      fetchBufferWithRetry(manifestUrl, {
        headers: options.headers,
        timeoutMs: 2e4,
        retries: 2,
        maxBytes: 128 * 1024
      }),
      fetchBufferWithRetry(signatureUrl, {
        headers: options.headers,
        timeoutMs: 2e4,
        retries: 2,
        maxBytes: 1024
      }),
      loadTrustedKeyRegistry()
    ]);
    const manifestBytes = manifestResult.bytes;
    const manifest = validateManifest(decodeUtf8Json(manifestBytes, RELEASE_MANIFEST_NAME));
    const key = registry.keys.find((item) => item.id === manifest.keyId);
    if (!key) throw new Error(`Release key ${manifest.keyId} \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0432 \u0434\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u043E\u043C registry.`);
    if (key.status === "revoked") throw new Error(`Release key ${manifest.keyId} \u043E\u0442\u043E\u0437\u0432\u0430\u043D.`);
    const publishedAt = Date.parse(manifest.publishedAt);
    if (publishedAt < Date.parse(key.notBefore) || publishedAt > Date.parse(key.notAfter)) throw new Error("Manifest \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D \u0432\u043D\u0435 \u0441\u0440\u043E\u043A\u0430 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F release key.");
    if (publishedAt > Date.now() + 900 * 1e3) throw new Error("\u0412\u0440\u0435\u043C\u044F \u043F\u0443\u0431\u043B\u0438\u043A\u0430\u0446\u0438\u0438 manifest \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u0432 \u0431\u0443\u0434\u0443\u0449\u0435\u043C.");
    if (!verify(null, manifestBytes, createPublicKey(key.publicKeyPem), decodeDetachedSignature(signatureResult.bytes, "release-manifest.json.sig"))) throw new Error("\u041F\u043E\u0434\u043F\u0438\u0441\u044C release manifest \u043D\u0435 \u043F\u0440\u043E\u0448\u043B\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443.");
    if (manifest.version !== options.expectedVersion || manifest.tag !== options.tagName || manifest.installerName !== options.expectedInstallerName || manifest.canonicalDownloadUrl !== options.expectedInstallerUrl) throw new Error("Release candidate \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u0435\u0442 \u0441 \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u043C manifest.");
    const installerAsset = options.release?.assets?.find((item) => item.name === manifest.installerName) ?? null;
    if (installerAsset) {
      const githubSha256 = extractSha256FromGitHubAssetDigest(installerAsset.digest);
      if (!githubSha256 || githubSha256 !== manifest.sha256) throw new Error("GitHub asset digest \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u0435\u0442 \u0441 \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u043C manifest.");
    }
    return {
      trustStatus: "trusted",
      manifest,
      manifestVerified: true,
      releaseChannel: "stable",
      installerSigned: manifest.authenticodeStatus === "valid",
      sha256: manifest.sha256,
      manifestDigest: createHash("sha256").update(manifestBytes).digest("hex"),
      keyId: manifest.keyId,
      warnings: manifest.authenticodeStatus === "not-signed" ? ["Setup \u043D\u0435 \u0438\u043C\u0435\u0435\u0442 Authenticode-\u043F\u043E\u0434\u043F\u0438\u0441\u0438; Windows \u043C\u043E\u0436\u0435\u0442 \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C SmartScreen/UAC."] : []
    };
  } catch (error) {
    return {
      trustStatus: "untrusted",
      manifest: null,
      manifestVerified: false,
      releaseChannel: null,
      installerSigned: false,
      sha256: null,
      manifestDigest: null,
      keyId: null,
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }
}
async function verifyStableChannelTrust(options) {
  try {
    const [manifestResult, signatureResult, registry] = await Promise.all([
      fetchBufferWithRetry(options.manifestUrl, {
        headers: options.headers,
        timeoutMs: 2e4,
        retries: 2,
        maxBytes: 128 * 1024
      }),
      fetchBufferWithRetry(options.signatureUrl, {
        headers: options.headers,
        timeoutMs: 2e4,
        retries: 2,
        maxBytes: 1024
      }),
      loadTrustedKeyRegistry()
    ]);
    const manifestBytes = manifestResult.bytes;
    const manifest = validateManifest(decodeUtf8Json(manifestBytes, "stable-channel.json"));
    const key = registry.keys.find((item) => item.id === manifest.keyId);
    if (!key) throw new Error(`Release key ${manifest.keyId} \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0432 \u0434\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u043E\u043C registry.`);
    if (key.status === "revoked") throw new Error(`Release key ${manifest.keyId} \u043E\u0442\u043E\u0437\u0432\u0430\u043D.`);
    const publishedAt = Date.parse(manifest.publishedAt);
    if (publishedAt < Date.parse(key.notBefore) || publishedAt > Date.parse(key.notAfter)) throw new Error("Stable channel \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D \u0432\u043D\u0435 \u0441\u0440\u043E\u043A\u0430 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F release key.");
    if (publishedAt > Date.now() + 900 * 1e3) throw new Error("\u0412\u0440\u0435\u043C\u044F stable channel \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u0432 \u0431\u0443\u0434\u0443\u0449\u0435\u043C.");
    if (!verify(null, manifestBytes, createPublicKey(key.publicKeyPem), decodeDetachedSignature(signatureResult.bytes, "stable-channel.json.sig"))) throw new Error("\u041F\u043E\u0434\u043F\u0438\u0441\u044C stable channel \u043D\u0435 \u043F\u0440\u043E\u0448\u043B\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443.");
    return {
      trustStatus: "trusted",
      manifest,
      manifestVerified: true,
      releaseChannel: "stable",
      installerSigned: manifest.authenticodeStatus === "valid",
      sha256: manifest.sha256,
      manifestDigest: createHash("sha256").update(manifestBytes).digest("hex"),
      keyId: manifest.keyId,
      warnings: ["GitHub REST API \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D; \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u0439 stable channel.", ...manifest.authenticodeStatus === "not-signed" ? ["Setup \u043D\u0435 \u0438\u043C\u0435\u0435\u0442 Authenticode-\u043F\u043E\u0434\u043F\u0438\u0441\u0438; Windows \u043C\u043E\u0436\u0435\u0442 \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C SmartScreen/UAC."] : []]
    };
  } catch (error) {
    return {
      trustStatus: "untrusted",
      manifest: null,
      manifestVerified: false,
      releaseChannel: null,
      installerSigned: false,
      sha256: null,
      manifestDigest: null,
      keyId: null,
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }
}
