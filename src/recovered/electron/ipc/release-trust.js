//#region src/electron/ipc/release-trust.ts
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
	} catch {}
	throw new Error(`В сборке отсутствует ${name}.`);
}
function decodeUtf8Json(bytes, label) {
	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error(`${label} не является корректным UTF-8.`);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${label} содержит некорректный JSON.`);
	}
}
function decodeDetachedSignature(bytes, label) {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
	if (!/^[A-Za-z0-9+/]{80,100}={0,2}$/.test(text)) throw new Error(`${label} имеет недопустимый формат.`);
	return Buffer.from(text, "base64");
}
function assertIsoDate(value, field) {
	if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) throw new Error(`Поле ${field} содержит некорректную дату.`);
	return value;
}
function assertDigest(value, algorithm, field) {
	if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${algorithm === "sha256" ? 64 : 128}}$`, "i").test(value)) throw new Error(`Поле ${field} содержит некорректный ${algorithm.toUpperCase()}.`);
	return value.toLowerCase();
}
function validateKeyRegistry(value) {
	const registry = value;
	if (!registry || typeof registry !== "object" || registry.schemaVersion !== 1) throw new Error("Схема registry ключей не поддерживается.");
	assertIsoDate(registry.generatedAt, "generatedAt");
	if (!Array.isArray(registry.keys) || registry.keys.length === 0) throw new Error("Registry не содержит release keys.");
	const ids = /* @__PURE__ */ new Set();
	for (const key of registry.keys) {
		if (!key || typeof key !== "object" || typeof key.id !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(key.id)) throw new Error("Registry содержит некорректный key ID.");
		if (ids.has(key.id)) throw new Error("Registry содержит повторяющийся key ID.");
		ids.add(key.id);
		if (key.algorithm !== "Ed25519" || key.status !== "trusted" && key.status !== "revoked") throw new Error(`Registry содержит неподдерживаемый ключ ${key.id}.`);
		if (typeof key.publicKeyPem !== "string" || !key.publicKeyPem.includes("BEGIN PUBLIC KEY")) throw new Error(`Registry не содержит public key ${key.id}.`);
		assertIsoDate(key.notBefore, `${key.id}.notBefore`);
		assertIsoDate(key.notAfter, `${key.id}.notAfter`);
	}
	return registry;
}
function validateManifest(value) {
	const manifest = value;
	if (!manifest || typeof manifest !== "object" || manifest.schemaVersion !== 2) throw new Error("Схема release manifest не поддерживается.");
	if (manifest.channel !== "stable") throw new Error("Разрешён только stable release channel.");
	if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Версия release manifest некорректна.");
	if (manifest.tag !== `v${manifest.version}`) throw new Error("Tag и version release manifest не совпадают.");
	if (manifest.installerName !== "Egoist-Lagom-Setup.exe" && manifest.installerName !== `EgoistShield-Setup-${manifest.version}.exe`) throw new Error("Имя Setup в release manifest некорректно.");
	if (typeof manifest.canonicalDownloadUrl !== "string") throw new Error("Отсутствует canonicalDownloadUrl.");
	const canonicalUrl = new URL(manifest.canonicalDownloadUrl);
	if (canonicalUrl.protocol !== "https:" || canonicalUrl.hostname.toLowerCase() !== "github.com" || canonicalUrl.pathname !== `/egoist-ai1/egoist-lagom/releases/download/${manifest.tag}/${manifest.installerName}` || canonicalUrl.search || canonicalUrl.hash) throw new Error("Canonical download URL не принадлежит release channel Egoist Lagom.");
	if (!Number.isSafeInteger(manifest.size) || Number(manifest.size) <= 0 || Number(manifest.size) > 1024 * 1024 * 1024) throw new Error("Размер Setup в release manifest некорректен.");
	manifest.sha256 = assertDigest(manifest.sha256, "sha256", "sha256");
	manifest.sha512 = assertDigest(manifest.sha512, "sha512", "sha512");
	if (manifest.githubDigest !== `sha256:${manifest.sha256}`) throw new Error("GitHub digest не совпадает с SHA-256 release manifest.");
	if (typeof manifest.minimumAppVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.minimumAppVersion)) throw new Error("minimumAppVersion некорректна.");
	if (typeof manifest.keyId !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(manifest.keyId)) throw new Error("keyId release manifest некорректен.");
	if (manifest.authenticodeStatus !== "valid" && manifest.authenticodeStatus !== "not-signed") throw new Error("Authenticode status release manifest некорректен.");
	if (typeof manifest.licenseVersion !== "string" || !manifest.licenseVersion.trim()) throw new Error("licenseVersion release manifest отсутствует.");
	assertIsoDate(manifest.publishedAt, "publishedAt");
	return manifest;
}
async function loadTrustedKeyRegistry() {
	const [registryBytes, signatureBytes, rootPublicKeyBytes] = await Promise.all([
		readBundledReleaseFile(RELEASE_KEY_REGISTRY_NAME),
		readBundledReleaseFile(RELEASE_KEY_REGISTRY_SIGNATURE_NAME),
		readBundledReleaseFile(RELEASE_ROOT_PUBLIC_KEY_NAME)
	]);
	if (!verify(null, registryBytes, createPublicKey(rootPublicKeyBytes), decodeDetachedSignature(signatureBytes, "release-key-registry.json.sig"))) throw new Error("Подпись registry release keys не прошла проверку.");
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
		warnings: ["Релиз не содержит подписанный manifest schema v2."]
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
		if (!key) throw new Error(`Release key ${manifest.keyId} отсутствует в доверенном registry.`);
		if (key.status === "revoked") throw new Error(`Release key ${manifest.keyId} отозван.`);
		const publishedAt = Date.parse(manifest.publishedAt);
		if (publishedAt < Date.parse(key.notBefore) || publishedAt > Date.parse(key.notAfter)) throw new Error("Manifest опубликован вне срока действия release key.");
		if (publishedAt > Date.now() + 900 * 1e3) throw new Error("Время публикации manifest находится в будущем.");
		if (!verify(null, manifestBytes, createPublicKey(key.publicKeyPem), decodeDetachedSignature(signatureResult.bytes, "release-manifest.json.sig"))) throw new Error("Подпись release manifest не прошла проверку.");
		if (manifest.version !== options.expectedVersion || manifest.tag !== options.tagName || manifest.installerName !== options.expectedInstallerName || manifest.canonicalDownloadUrl !== options.expectedInstallerUrl) throw new Error("Release candidate не совпадает с подписанным manifest.");
		const installerAsset = options.release?.assets?.find((item) => item.name === manifest.installerName) ?? null;
		if (installerAsset) {
			const githubSha256 = extractSha256FromGitHubAssetDigest(installerAsset.digest);
			if (!githubSha256 || githubSha256 !== manifest.sha256) throw new Error("GitHub asset digest не совпадает с подписанным manifest.");
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
			warnings: manifest.authenticodeStatus === "not-signed" ? ["Setup не имеет Authenticode-подписи; Windows может показать SmartScreen/UAC."] : []
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
		if (!key) throw new Error(`Release key ${manifest.keyId} отсутствует в доверенном registry.`);
		if (key.status === "revoked") throw new Error(`Release key ${manifest.keyId} отозван.`);
		const publishedAt = Date.parse(manifest.publishedAt);
		if (publishedAt < Date.parse(key.notBefore) || publishedAt > Date.parse(key.notAfter)) throw new Error("Stable channel опубликован вне срока действия release key.");
		if (publishedAt > Date.now() + 900 * 1e3) throw new Error("Время stable channel находится в будущем.");
		if (!verify(null, manifestBytes, createPublicKey(key.publicKeyPem), decodeDetachedSignature(signatureResult.bytes, "stable-channel.json.sig"))) throw new Error("Подпись stable channel не прошла проверку.");
		return {
			trustStatus: "trusted",
			manifest,
			manifestVerified: true,
			releaseChannel: "stable",
			installerSigned: manifest.authenticodeStatus === "valid",
			sha256: manifest.sha256,
			manifestDigest: createHash("sha256").update(manifestBytes).digest("hex"),
			keyId: manifest.keyId,
			warnings: ["GitHub REST API временно недоступен; использован подписанный stable channel.", ...manifest.authenticodeStatus === "not-signed" ? ["Setup не имеет Authenticode-подписи; Windows может показать SmartScreen/UAC."] : []]
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
//#endregion
