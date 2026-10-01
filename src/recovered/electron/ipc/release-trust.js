//#region src/electron/ipc/release-trust.ts
var RELEASE_MANIFEST_NAME = "release-manifest.json";
var RELEASE_MANIFEST_SIGNATURE_NAME = "release-manifest.json.sig";
var RELEASE_KEY_REGISTRY_NAME = "release-key-registry.json";
var RELEASE_KEY_REGISTRY_SIGNATURE_NAME = "release-key-registry.json.sig";
var RELEASE_ROOT_PUBLIC_KEY_NAME = "root-public-key.pem";
var RELEASE_REGISTRY_URL = "https://github.com/egoist-ai1/egoist-lagom/releases/latest/download/release-key-registry.json";
var RELEASE_REGISTRY_CACHE_NAME = "release-key-registry-cache.json";
var RELEASE_REGISTRY_MAX_BYTES = 256 * 1024;
var RELEASE_REGISTRY_TIMEOUT_MS = 5e3;
var RELEASE_REGISTRY_REDIRECT_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "objects-origin.githubusercontent.com", "github-releases.githubusercontent.com", "release-assets.githubusercontent.com"]);
var releaseRegistryLoads = new Map();
var ReleaseRegistryError = class extends Error {
	constructor(code, message) {
		super(message);
		this.name = "ReleaseRegistryError";
		this.code = code;
	}
};
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
	if (!Array.isArray(registry.keys) || registry.keys.length === 0 || registry.keys.length > 128) throw new Error("Registry должен содержать от 1 до 128 release keys.");
	const ids = /* @__PURE__ */ new Set();
	for (const key of registry.keys) {
		if (!key || typeof key !== "object" || typeof key.id !== "string" || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(key.id)) throw new Error("Registry содержит некорректный key ID.");
		if (ids.has(key.id)) throw new Error("Registry содержит повторяющийся key ID.");
		ids.add(key.id);
		if (key.algorithm !== "Ed25519" || key.status !== "trusted" && key.status !== "revoked") throw new Error(`Registry содержит неподдерживаемый ключ ${key.id}.`);
		if (typeof key.publicKeyPem !== "string" || !key.publicKeyPem.includes("BEGIN PUBLIC KEY")) throw new Error(`Registry не содержит public key ${key.id}.`);
		assertIsoDate(key.notBefore, `${key.id}.notBefore`);
		assertIsoDate(key.notAfter, `${key.id}.notAfter`);
		if (Date.parse(key.notBefore) >= Date.parse(key.notAfter)) throw new Error(`Срок действия release key ${key.id} некорректен.`);
		if (createPublicKey(key.publicKeyPem).asymmetricKeyType !== "ed25519") throw new Error(`Release key ${key.id} не является Ed25519.`);
	}
	return registry;
}
function validateManifest(value) {
	const manifest = value;
	if (!manifest || typeof manifest !== "object" || manifest.schemaVersion !== 2) throw new Error("Схема release manifest не поддерживается.");
	if (manifest.channel !== "stable") throw new Error("Разрешён только stable release channel.");
	if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Версия release manifest некорректна.");
	if (manifest.tag !== `v${manifest.version}`) throw new Error("Tag и version release manifest не совпадают.");
	if (manifest.installerName !== `EgoistShield-Setup-${manifest.version}.exe`) throw new Error("Имя Setup в release manifest некорректно.");
	if (typeof manifest.canonicalDownloadUrl !== "string") throw new Error("Отсутствует canonicalDownloadUrl.");
	const canonicalUrl = `https://github.com/egoist-ai1/egoist-lagom/releases/download/${manifest.tag}/${manifest.installerName}`;
	if (manifest.canonicalDownloadUrl !== canonicalUrl) throw new Error("Canonical download URL не принадлежит release channel Egoist Lagom.");
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
function authenticateReleaseRegistry(registryBytes, signatureBytes, rootPublicKey) {
	if (registryBytes.length > RELEASE_REGISTRY_MAX_BYTES || signatureBytes.length > 1024) throw new ReleaseRegistryError("signature-invalid", "Registry release keys превышает допустимый размер.");
	if (rootPublicKey.asymmetricKeyType !== "ed25519" || !verify(null, registryBytes, rootPublicKey, decodeDetachedSignature(signatureBytes, RELEASE_KEY_REGISTRY_SIGNATURE_NAME))) throw new ReleaseRegistryError("signature-invalid", "Подпись registry release keys не прошла проверку закреплённым корневым ключом.");
	const registry = validateKeyRegistry(decodeUtf8Json(registryBytes, RELEASE_KEY_REGISTRY_NAME));
	if (Date.parse(registry.generatedAt) > Date.now() + 900e3) throw new ReleaseRegistryError("signature-invalid", "Время registry release keys находится в будущем. Проверьте часы Windows.");
	return { registry, registryBytes, signatureBytes, digest: createHash("sha256").update(registryBytes).digest("hex") };
}
function assertReleaseRegistrySuccessor(previous, next) {
	const generation = Date.parse(next.registry.generatedAt) - Date.parse(previous.registry.generatedAt);
	if (generation < 0) throw new ReleaseRegistryError("anti-rollback", "Повтор более старого registry release keys заблокирован.");
	if (generation === 0 && next.digest !== previous.digest) throw new ReleaseRegistryError("anti-rollback", "Registry release keys изменён без новой подписанной даты generatedAt.");
	for (const oldKey of previous.registry.keys) {
		const newKey = next.registry.keys.find((key) => key.id === oldKey.id);
		if (!newKey) throw new ReleaseRegistryError("anti-rollback", `Registry удаляет прежний release key ${oldKey.id}; требуется явная запись revoked.`);
		const oldMaterial = createPublicKey(oldKey.publicKeyPem).export({ type: "spki", format: "der" });
		const newMaterial = createPublicKey(newKey.publicKeyPem).export({ type: "spki", format: "der" });
		if (!oldMaterial.equals(newMaterial)) throw new ReleaseRegistryError("anti-rollback", `Registry заменяет материал прежнего release key ${oldKey.id}; новому ключу требуется новый ID.`);
		if (oldKey.status === "revoked" && newKey.status !== "revoked") throw new ReleaseRegistryError("key-revoked", `Отзыв release key ${oldKey.id} нельзя отменить.`);
	}
}
async function readReleaseRegistryCache(cachePath, rootPublicKey, rootFingerprint) {
	let file;
	try {
		const info = await promises.lstat(cachePath);
		if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024) throw new Error("Недопустимый файл кэша registry.");
		file = await promises.open(cachePath, "r");
		const bytes = Buffer.alloc(512 * 1024 + 1);
		let count = 0;
		while (count < bytes.length) {
			const result = await file.read(bytes, count, bytes.length - count, null);
			if (!result.bytesRead) break;
			count += result.bytesRead;
		}
		if (count > 512 * 1024) throw new Error("Кэш registry превышает допустимый размер.");
		const envelope = decodeUtf8Json(bytes.subarray(0, count), "Кэш registry release keys");
		if (envelope?.schemaVersion !== 1 || envelope.rootFingerprint !== rootFingerprint || typeof envelope.registryBytes !== "string" || typeof envelope.signatureBytes !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.registryBytes) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.signatureBytes)) throw new Error("Формат кэша registry некорректен.");
		return authenticateReleaseRegistry(Buffer.from(envelope.registryBytes, "base64"), Buffer.from(envelope.signatureBytes, "base64"), rootPublicKey);
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw new ReleaseRegistryError(error instanceof ReleaseRegistryError ? error.code : "signature-invalid", `Кэш registry release keys не прошёл проверку: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		await file?.close();
	}
}
async function persistReleaseRegistry(cachePath, snapshot, rootFingerprint) {
	const temporaryPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
	let file;
	try {
		await promises.mkdir(path.dirname(cachePath), { recursive: true });
		file = await promises.open(temporaryPath, "wx", 384);
		await file.writeFile(`${JSON.stringify({ schemaVersion: 1, rootFingerprint, registryBytes: snapshot.registryBytes.toString("base64"), signatureBytes: snapshot.signatureBytes.toString("base64") })}\n`, "utf8");
		await file.sync();
		await file.close();
		file = null;
		await promises.rename(temporaryPath, cachePath);
	} catch (error) {
		throw new ReleaseRegistryError("signature-invalid", `Не удалось сохранить проверенный registry release keys; обновление заблокировано: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		await file?.close().catch(() => void 0);
		await promises.unlink(temporaryPath).catch(() => void 0);
	}
}
async function fetchReleaseRegistryAsset(url, options, maxBytes) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), RELEASE_REGISTRY_TIMEOUT_MS);
	let response, reader;
	try {
		let nextUrl = new URL(url);
		for (let redirects = 0; redirects <= 4; redirects += 1) {
			if (nextUrl.protocol !== "https:" || !RELEASE_REGISTRY_REDIRECT_HOSTS.has(nextUrl.hostname.toLowerCase()) || nextUrl.username || nextUrl.password || nextUrl.port && nextUrl.port !== "443") throw new ReleaseRegistryError("signature-invalid", "Registry перенаправлен за пределы разрешённого HTTPS-канала.");
			response = await fetch(nextUrl.href, { headers: options.headers, redirect: "manual", signal: controller.signal });
			if (![301, 302, 303, 307, 308].includes(response.status)) break;
			const location = response.headers.get("location");
			await response.body?.cancel().catch(() => void 0);
			response = null;
			if (!location || redirects === 4) throw new ReleaseRegistryError("signature-invalid", "Registry содержит некорректную цепочку перенаправлений.");
			nextUrl = new URL(location, nextUrl);
		}
		if (!response.ok) throw new SafeHttpError(response.status, response.statusText);
		const length = response.headers.get("content-length");
		if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new ReleaseRegistryError("signature-invalid", "Registry release keys превышает допустимый размер.");
		if (!response.body) throw new ReleaseRegistryError("signature-invalid", "Registry release keys не содержит тела ответа.");
		reader = response.body.getReader();
		const chunks = [];
		let total = 0;
		while (true) {
			if (controller.signal.aborted) throw controller.signal.reason;
			const chunk = await new Promise((resolve, reject) => {
				const abort = () => reject(controller.signal.reason);
				controller.signal.addEventListener("abort", abort, { once: true });
				reader.read().then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", abort));
			});
			if (chunk.done) break;
			total += chunk.value.byteLength;
			if (total > maxBytes) throw new ReleaseRegistryError("signature-invalid", "Registry release keys превышает допустимый размер.");
			chunks.push(Buffer.from(chunk.value));
		}
		return { bytes: Buffer.concat(chunks) };
	} finally {
		clearTimeout(timer);
		if (reader) {
			await reader.cancel().catch(() => void 0);
			reader.releaseLock();
		} else await response?.body?.cancel().catch(() => void 0);
	}
}
function releaseRegistryFetchIsOffline(error) {
	const details = getNetworkErrorDetails(error);
	return details.kind === "timeout" || details.kind === "network" || details.kind === "offline" || details.kind === "http" && [404, 408, 425, 429].includes(details.status) || details.kind === "http" && details.status >= 500;
}
async function loadTrustedKeyRegistryInternal(options, cachePath) {
	const [registryBytes, signatureBytes, rootPublicKeyBytes] = await Promise.all([
		readBundledReleaseFile(RELEASE_KEY_REGISTRY_NAME), readBundledReleaseFile(RELEASE_KEY_REGISTRY_SIGNATURE_NAME), readBundledReleaseFile(RELEASE_ROOT_PUBLIC_KEY_NAME)
	]);
	const rootPublicKey = createPublicKey(rootPublicKeyBytes);
	const rootFingerprint = createHash("sha256").update(rootPublicKey.export({ type: "spki", format: "der" })).digest("hex");
	const bundled = authenticateReleaseRegistry(registryBytes, signatureBytes, rootPublicKey);
	const cached = await readReleaseRegistryCache(cachePath, rootPublicKey, rootFingerprint);
	let selected = bundled;
	if (cached) {
		if (Date.parse(cached.registry.generatedAt) >= Date.parse(bundled.registry.generatedAt)) {
			assertReleaseRegistrySuccessor(bundled, cached);
			selected = cached;
		} else assertReleaseRegistrySuccessor(cached, bundled);
	}
	let remoteResults;
	try {
		remoteResults = await Promise.allSettled([
			fetchReleaseRegistryAsset(RELEASE_REGISTRY_URL, options, RELEASE_REGISTRY_MAX_BYTES),
			fetchReleaseRegistryAsset(`${RELEASE_REGISTRY_URL}.sig`, options, 1024)
		]);
		const failures = remoteResults.filter((result) => result.status === "rejected");
		const fatal = failures.find((result) => !releaseRegistryFetchIsOffline(result.reason));
		if (fatal) throw fatal.reason;
		if (failures.length) {
			// A newly bundled registry can advance an older cache even while offline.
			if (cached && selected.digest !== cached.digest) await persistReleaseRegistry(cachePath, selected, rootFingerprint);
			return { registry: selected.registry, source: selected === cached ? "cache" : "bundled", freshness: "unavailable", warnings: ["Не удалось получить свежий registry release keys. Использован проверенный локальный registry; новые отзывы ключей могут быть неизвестны."] };
		}
		const remote = authenticateReleaseRegistry(remoteResults[0].value.bytes, remoteResults[1].value.bytes, rootPublicKey);
		assertReleaseRegistrySuccessor(selected, remote);
		if (!cached || remote.digest !== cached.digest) await persistReleaseRegistry(cachePath, remote, rootFingerprint);
		return { registry: remote.registry, source: "remote", freshness: "checked", warnings: [] };
	} catch (error) {
		if (error instanceof ReleaseRegistryError) throw error;
		throw new ReleaseRegistryError("signature-invalid", error instanceof Error ? error.message : String(error));
	}
}
async function loadTrustedKeyRegistry(options = {}) {
	if (typeof options.userDataDir !== "string" || !path.isAbsolute(options.userDataDir)) throw new ReleaseRegistryError("signature-invalid", "Не задан профиль для безопасного кэша registry release keys.");
	const cachePath = path.join(options.userDataDir, "updates", RELEASE_REGISTRY_CACHE_NAME);
	if (releaseRegistryLoads.has(cachePath)) return releaseRegistryLoads.get(cachePath);
	const pending = loadTrustedKeyRegistryInternal(options, cachePath).finally(() => releaseRegistryLoads.delete(cachePath));
	releaseRegistryLoads.set(cachePath, pending);
	return pending;
}
function pickAssetUrl(release, releaseApiUrl, tagName, assetName) {
	return (Array.isArray(release?.assets) ? release.assets.find((item) => item.name === assetName) : null)?.browser_download_url ?? buildGitHubAssetDownloadUrl(releaseApiUrl, tagName, assetName);
}
function releaseTrustFailureMetadata(error) {
	if (error instanceof ReleaseRegistryError) return { failureCode: error.code, retryable: false };
	const network = getNetworkErrorDetails(error);
	if (network.kind === "timeout") return { failureCode: "timeout", retryable: true };
	if (network.kind === "network" || network.kind === "offline") return { failureCode: "offline", retryable: true };
	if (network.kind === "http" && network.status === 404) return { failureCode: "release-not-found", retryable: true };
	if (network.kind === "http" && (network.status === 408 || network.status === 425 || network.status === 429 || network.status >= 500)) return { failureCode: "offline", retryable: true };
	return { failureCode: "signature-invalid", retryable: false };
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
		failureCode: "manifest-missing",
		retryable: false,
		warnings: ["Релиз не содержит подписанный manifest schema v2."]
	};
	try {
		const [manifestResult, signatureResult, registryState] = await Promise.all([
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
			loadTrustedKeyRegistry(options)
		]);
		const registry = registryState.registry;
		const manifestBytes = manifestResult.bytes;
		const manifest = validateManifest(decodeUtf8Json(manifestBytes, RELEASE_MANIFEST_NAME));
		const key = registry.keys.find((item) => item.id === manifest.keyId);
		if (!key) throw new ReleaseRegistryError("key-unknown", `Release key ${manifest.keyId} отсутствует в доверенном registry.`);
		if (key.status === "revoked") throw new ReleaseRegistryError("key-revoked", `Release key ${manifest.keyId} отозван.`);
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
			registrySource: registryState.source,
			registryFreshness: registryState.freshness,
			registryGeneratedAt: registry.generatedAt,
			warnings: [...registryState.warnings, ...manifest.authenticodeStatus === "not-signed" ? ["Setup не имеет Authenticode-подписи; Windows может показать SmartScreen/UAC."] : []]
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
			...releaseTrustFailureMetadata(error),
			warnings: [error instanceof Error ? error.message : String(error)]
		};
	}
}
async function verifyStableChannelTrust(options) {
	try {
		const [manifestResult, signatureResult, registryState] = await Promise.all([
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
			loadTrustedKeyRegistry(options)
		]);
		const registry = registryState.registry;
		const manifestBytes = manifestResult.bytes;
		const manifest = validateManifest(decodeUtf8Json(manifestBytes, "stable-channel.json"));
		const key = registry.keys.find((item) => item.id === manifest.keyId);
		if (!key) throw new ReleaseRegistryError("key-unknown", `Release key ${manifest.keyId} отсутствует в доверенном registry.`);
		if (key.status === "revoked") throw new ReleaseRegistryError("key-revoked", `Release key ${manifest.keyId} отозван.`);
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
			registrySource: registryState.source,
			registryFreshness: registryState.freshness,
			registryGeneratedAt: registry.generatedAt,
			warnings: ["GitHub REST API временно недоступен; использован подписанный stable channel.", ...registryState.warnings, ...manifest.authenticodeStatus === "not-signed" ? ["Setup не имеет Authenticode-подписи; Windows может показать SmartScreen/UAC."] : []]
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
			...releaseTrustFailureMetadata(error),
			warnings: [error instanceof Error ? error.message : String(error)]
		};
	}
}
//#endregion
