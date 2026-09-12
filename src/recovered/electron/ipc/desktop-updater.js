//#region src/electron/ipc/desktop-updater.ts
var APP_RELEASE_OWNER = "egoist-ai1";
var APP_RELEASE_REPOSITORY = "egoist-lagom";
var APP_RELEASE_API_URL = `https://api.github.com/repos/${APP_RELEASE_OWNER}/${APP_RELEASE_REPOSITORY}/releases/latest`;
var APP_RELEASE_PAGE_URL = `https://github.com/${APP_RELEASE_OWNER}/${APP_RELEASE_REPOSITORY}/releases/latest`;
var STABLE_CHANNEL_URL = `https://github.com/${APP_RELEASE_OWNER}/${APP_RELEASE_REPOSITORY}/releases/latest/download/stable-channel.json`;
var STABLE_CHANNEL_SIGNATURE_URL = `${STABLE_CHANNEL_URL}.sig`;
var UPDATE_MAX_BYTES = 1024 * 1024 * 1024;
var DOWNLOAD_TIMEOUT_MS = 1200 * 1e3;
var ALLOWED_REDIRECT_HOSTS = /* @__PURE__ */ new Set([
	"github.com",
	"objects.githubusercontent.com",
	"objects-origin.githubusercontent.com",
	"github-releases.githubusercontent.com",
	"release-assets.githubusercontent.com"
]);
var UpdaterError = class extends Error {
	code;
	retryable;
	constructor(code, message, retryable = false) {
		super(message);
		this.code = code;
		this.retryable = retryable;
		this.name = "UpdaterError";
	}
};
function emit(options, progress) {
	options.onProgress?.(progress);
}
function mapUnknownError(error) {
	if (error instanceof UpdaterError) return error;
	const network = getNetworkErrorDetails(error);
	if (network.kind === "timeout") return new UpdaterError("timeout", "Сервер обновлений не ответил вовремя. Повторите позже.", true);
	if (network.kind === "network" || network.kind === "offline") return new UpdaterError("offline", "Не удалось подключиться к каналу обновлений. Проверьте интернет, DNS и proxy.", true);
	if (network.kind === "http" && network.status === 404) return new UpdaterError("release-not-found", "Публичный stable-релиз пока недоступен.", true);
	return new UpdaterError("unknown", "Не удалось проверить обновление. Повторите попытку или откройте журнал.", true);
}
function failureResult(currentVersion, error) {
	const mapped = mapUnknownError(error);
	return {
		ok: false,
		phase: [
			"manifest-missing",
			"manifest-invalid",
			"signature-invalid",
			"key-unknown",
			"key-revoked",
			"anti-rollback",
			"candidate-mismatch",
			"redirect-blocked",
			"integrity-failed"
		].includes(mapped.code) ? "blocked" : "failed",
		currentVersion,
		message: mapped.message,
		failureCode: mapped.code,
		retryable: mapped.retryable
	};
}
function candidateEquals(left, right) {
	return left.version === right.version && left.tag === right.tag && left.assetName === right.assetName && left.assetUrl === right.assetUrl && left.size === right.size && left.sha256 === right.sha256 && left.sha512 === right.sha512 && left.githubDigest === right.githubDigest && left.manifestDigest === right.manifestDigest && left.keyId === right.keyId;
}
function buildCandidate(trust, releaseUrl) {
	const manifest = trust.manifest;
	if (trust.trustStatus !== "trusted" || !trust.manifestVerified || !manifest || !trust.manifestDigest || !trust.keyId) throw new UpdaterError("signature-invalid", "Релиз не прошёл проверку Ed25519 и заблокирован.");
	return {
		version: manifest.version,
		tag: manifest.tag,
		assetName: manifest.installerName,
		assetUrl: manifest.canonicalDownloadUrl,
		size: manifest.size,
		sha256: manifest.sha256,
		sha512: manifest.sha512,
		githubDigest: manifest.githubDigest,
		manifestDigest: trust.manifestDigest,
		channel: "stable",
		keyId: manifest.keyId,
		authenticodeStatus: manifest.authenticodeStatus,
		publishedAt: manifest.publishedAt,
		releaseUrl
	};
}
async function computeFileDigest(filePath, algorithm) {
	const hash = createHash(algorithm);
	await new Promise((resolve, reject) => {
		const stream = createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("error", reject);
		stream.on("end", resolve);
	});
	return hash.digest("hex");
}
function assertCanonicalCandidateUrl(candidate) {
	const url = new URL(candidate.assetUrl);
	const expectedPath = `/${APP_RELEASE_OWNER}/${APP_RELEASE_REPOSITORY}/releases/download/${candidate.tag}/${candidate.assetName}`;
	if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expectedPath || url.search || url.hash) throw new UpdaterError("candidate-mismatch", "Адрес Setup не совпадает с доверенным release channel.");
}
async function readJsonFile(filePath) {
	try {
		return JSON.parse(await promises.readFile(filePath, "utf8"));
	} catch {
		return null;
	}
}
async function writeJsonAtomic(filePath, value) {
	await promises.mkdir(path.dirname(filePath), { recursive: true });
	const temporaryPath = `${filePath}.${process.pid}.tmp`;
	await promises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		mode: 384
	});
	await promises.rename(temporaryPath, filePath);
}
var DesktopUpdater = class {
	options;
	headers;
	checkPromise = null;
	installPromise = null;
	constructor(options) {
		this.options = options;
		this.headers = {
			"User-Agent": `EgoistShield/${options.currentVersion}`,
			Accept: "application/vnd.github+json"
		};
	}
	async check() {
		if (this.checkPromise) return this.checkPromise;
		this.checkPromise = this.checkInternal().finally(() => {
			this.checkPromise = null;
		});
		return this.checkPromise;
	}
	async checkAndInstall() {
		if (this.installPromise) return {
			ok: false,
			phase: "blocked",
			currentVersion: this.options.currentVersion,
			message: "Обновление уже выполняется.",
			failureCode: "busy",
			retryable: true
		};
		this.installPromise = this.checkAndInstallInternal().finally(() => {
			this.installPromise = null;
		});
		return this.installPromise;
	}
	async fetchReleaseHistory() {
		try {
			return (await fetchGitHubReleases(APP_RELEASE_API_URL, this.headers, 20)).filter((release) => !release.draft && !release.prerelease).map((release) => ({
				version: normalizeVersionTag(release.tag_name) ?? release.tag_name ?? "",
				name: release.name?.trim() || null,
				publishedAt: release.published_at ?? release.created_at ?? null,
				releaseNotes: release.body?.trim() || null,
				releaseUrl: release.html_url?.trim() || null
			})).filter((item) => Boolean(item.version));
		} catch {
			return [];
		}
	}
	async resolveTrustedCandidate() {
		let apiError = null;
		try {
			const release = await fetchLatestGitHubRelease(APP_RELEASE_API_URL, this.headers);
			const version = normalizeVersionTag(release.tag_name);
			if (!version || !release.tag_name) throw new UpdaterError("release-not-found", "Stable-релиз не содержит корректную версию.");
			const tag = `v${version}`;
			if (release.tag_name !== tag || release.draft || release.prerelease) throw new UpdaterError("unsupported-channel", "Latest release не является stable-кандидатом.");
			const assetName = release.assets?.some(item => item.name === "Egoist-Lagom-Setup.exe") ? "Egoist-Lagom-Setup.exe" : `EgoistShield-Setup-${version}.exe`;
			const asset = release.assets?.find((item) => item.name === assetName);
			if (!asset) throw new UpdaterError("release-not-found", `Stable-релиз ${tag} не содержит Setup.`);
			const canonicalUrl = `https://github.com/${APP_RELEASE_OWNER}/${APP_RELEASE_REPOSITORY}/releases/download/${tag}/${assetName}`;
			if (asset.browser_download_url !== canonicalUrl) throw new UpdaterError("candidate-mismatch", "GitHub вернул неожиданный адрес release asset.");
			const trust = await verifyRemoteReleaseTrust({
				release,
				releaseApiUrl: APP_RELEASE_API_URL,
				tagName: tag,
				expectedVersion: version,
				expectedInstallerName: assetName,
				expectedInstallerUrl: canonicalUrl,
				headers: this.headers
			});
			return {
				candidate: buildCandidate(trust, release.html_url ?? APP_RELEASE_PAGE_URL),
				release,
				warnings: trust.warnings
			};
		} catch (error) {
			apiError = error;
		}
		const fallbackTrust = await verifyStableChannelTrust({
			manifestUrl: STABLE_CHANNEL_URL,
			signatureUrl: STABLE_CHANNEL_SIGNATURE_URL,
			headers: this.headers
		});
		if (fallbackTrust.trustStatus !== "trusted") throw mapUnknownError(apiError ?? new Error(fallbackTrust.warnings.join(" ")));
		return {
			candidate: buildCandidate(fallbackTrust, APP_RELEASE_PAGE_URL),
			release: null,
			warnings: fallbackTrust.warnings
		};
	}
	async enforceAntiRollback(candidate) {
		if (compareLooseVersions(candidate.version, this.options.currentVersion) < 0) throw new UpdaterError("anti-rollback", "Установка более старой версии заблокирована.");
		const state = await readJsonFile(this.trustStatePath());
		if (!state || state.schemaVersion !== 1) return;
		const compared = compareLooseVersions(candidate.version, state.highestVersion);
		if (compared < 0) throw new UpdaterError("anti-rollback", "Повтор старого release manifest заблокирован.");
		if (compared === 0 && candidate.manifestDigest !== state.manifestDigest) throw new UpdaterError("anti-rollback", "Asset опубликован заново под прежней версией и заблокирован.");
	}
	async checkInternal() {
		emit(this.options, {
			phase: "checking",
			message: "Проверяем подписанный stable-канал…"
		});
		try {
			const resolution = await this.resolveTrustedCandidate();
			const { candidate } = resolution;
			const compared = compareLooseVersions(candidate.version, this.options.currentVersion);
			if (compared <= 0) {
				const message = compared === 0 ? `Установлена последняя версия ${this.options.currentVersion}.` : `Локальная версия ${this.options.currentVersion} новее stable-канала.`;
				emit(this.options, {
					phase: "up-to-date",
					message,
					version: candidate.version,
					percent: 100
				});
				return {
					ok: true,
					phase: "up-to-date",
					currentVersion: this.options.currentVersion,
					latestVersion: candidate.version,
					releaseHistory: await this.fetchReleaseHistory(),
					message
				};
			}
			await this.enforceAntiRollback(candidate);
			emit(this.options, {
				phase: "available",
				message: `Доступна доверенная версия ${candidate.version}.`,
				version: candidate.version,
				percent: 0
			});
			return {
				ok: true,
				phase: "available",
				currentVersion: this.options.currentVersion,
				latestVersion: candidate.version,
				candidate,
				releaseHistory: await this.fetchReleaseHistory(),
				message: resolution.warnings.length > 0 ? `Версия ${candidate.version} проверена. Windows может показать SmartScreen/UAC.` : `Версия ${candidate.version} проверена и готова к установке.`
			};
		} catch (error) {
			const result = failureResult(this.options.currentVersion, error);
			emit(this.options, {
				phase: result.phase,
				message: result.message
			});
			return result;
		}
	}
	async checkAndInstallInternal() {
		const checked = await this.check();
		if (!checked.ok || checked.phase !== "available" || !checked.candidate) return checked;
		const candidate = checked.candidate;
		try {
			assertCanonicalCandidateUrl(candidate);
			const partialPath = path.join(this.updatesDirectory(), `${candidate.assetName}.partial`);
			const finalPath = path.join(this.updatesDirectory(), candidate.assetName);
			emit(this.options, {
				phase: "downloading",
				message: `Загружаем ${candidate.version}…`,
				version: candidate.version,
				percent: 0,
				transferred: 0,
				total: candidate.size
			});
			await this.downloadCandidate(candidate, partialPath);
			emit(this.options, {
				phase: "verifying",
				message: "Проверяем Ed25519, SHA-256, SHA-512 и размер…",
				version: candidate.version,
				percent: 100
			});
			if ((await promises.stat(partialPath)).size !== candidate.size) throw new UpdaterError("integrity-failed", "Размер загруженного Setup не совпал.");
			const [sha256, sha512] = await Promise.all([computeFileDigest(partialPath, "sha256"), computeFileDigest(partialPath, "sha512")]);
			if (sha256 !== candidate.sha256 || sha512 !== candidate.sha512) throw new UpdaterError("integrity-failed", "Контрольная сумма Setup не совпала; файл удалён.");
			const rechecked = await this.check();
			if (!rechecked.ok || rechecked.phase !== "available" || !rechecked.candidate || !candidateEquals(candidate, rechecked.candidate)) throw new UpdaterError("candidate-mismatch", "Release candidate изменился во время загрузки; запуск заблокирован.");
			await promises.rm(finalPath, { force: true });
			await promises.rename(partialPath, finalPath);
			await promises.rm(`${partialPath}.json`, { force: true });
			await writeJsonAtomic(this.trustStatePath(), {
				schemaVersion: 1,
				highestVersion: candidate.version,
				manifestDigest: candidate.manifestDigest,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			emit(this.options, {
				phase: "installing",
				message: "Запускаем проверенный мастер обновления…",
				version: candidate.version,
				percent: 100
			});
			const child = spawn(finalPath, [
				"/S",
				"--updater-mode",
				`--from-version=${this.options.currentVersion}`
			], {
				detached: true,
				stdio: "ignore",
				windowsHide: true
			});
			await new Promise((resolve, reject) => {
				child.once("spawn", resolve);
				child.once("error", () => reject(new UpdaterError("installer-launch-failed", "Не удалось запустить мастер обновления. Повторите попытку или откройте журнал.", true)));
			});
			child.unref();
			emit(this.options, {
				phase: "restarting",
				message: "Мастер запущен. Egoist Lagom перезапустится после обновления.",
				version: candidate.version,
				percent: 100
			});
			return {
				ok: true,
				phase: "restarting",
				currentVersion: this.options.currentVersion,
				latestVersion: candidate.version,
				candidate,
				message: "Проверенный мастер обновления запущен."
			};
		} catch (error) {
			const mapped = mapUnknownError(error);
			if (![
				"download-failed",
				"timeout",
				"offline"
			].includes(mapped.code)) await this.removeCandidateFiles(candidate).catch(() => void 0);
			const result = failureResult(this.options.currentVersion, mapped);
			emit(this.options, {
				phase: result.phase,
				message: result.message,
				version: candidate.version
			});
			return result;
		}
	}
	async downloadCandidate(candidate, partialPath) {
		await promises.mkdir(this.updatesDirectory(), { recursive: true });
		const metadataPath = `${partialPath}.json`;
		let metadata = await readJsonFile(metadataPath);
		let existingSize = 0;
		try {
			existingSize = (await promises.stat(partialPath)).size;
		} catch {
			existingSize = 0;
		}
		if (!(metadata?.schemaVersion === 1 && metadata.version === candidate.version && metadata.assetUrl === candidate.assetUrl && metadata.expectedSize === candidate.size && existingSize > 0 && existingSize < candidate.size)) {
			await promises.rm(partialPath, { force: true });
			await promises.rm(metadataPath, { force: true });
			existingSize = 0;
			metadata = null;
		}
		const headers = {
			...this.headers,
			Accept: "application/octet-stream"
		};
		if (existingSize > 0) {
			headers.Range = `bytes=${existingSize}-`;
			if (metadata?.etag) headers["If-Range"] = metadata.etag;
		}
		const { response } = await fetchWithRetry(candidate.assetUrl, {
			headers,
			redirect: "follow",
			timeoutMs: 6e4,
			retries: 2,
			retryBaseDelayMs: 1e3
		});
		const finalUrl = new URL(response.url || candidate.assetUrl);
		if (finalUrl.protocol !== "https:" || !ALLOWED_REDIRECT_HOSTS.has(finalUrl.hostname.toLowerCase())) throw new UpdaterError("redirect-blocked", "GitHub перенаправил загрузку на недоверенный адрес.");
		const append = existingSize > 0 && response.status === 206;
		if (existingSize > 0 && !append) {
			existingSize = 0;
			await promises.rm(partialPath, { force: true });
		}
		const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10) || 0;
		const expectedTransferred = append ? existingSize + contentLength : contentLength;
		if (contentLength > 0 && expectedTransferred > candidate.size) throw new UpdaterError("integrity-failed", "Сервер сообщил размер больше подписанного manifest.");
		const etag = response.headers.get("etag");
		await writeJsonAtomic(metadataPath, {
			schemaVersion: 1,
			version: candidate.version,
			assetUrl: candidate.assetUrl,
			expectedSize: candidate.size,
			etag
		});
		if (!response.body) throw new UpdaterError("download-failed", "Сервер не вернул содержимое Setup.", true);
		const file = await promises.open(partialPath, append ? "a" : "w");
		const reader = response.body.getReader();
		let transferred = existingSize;
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			reader.cancel().catch(() => void 0);
		}, DOWNLOAD_TIMEOUT_MS);
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;
				transferred += value.byteLength;
				if (transferred > candidate.size || transferred > UPDATE_MAX_BYTES) {
					await reader.cancel().catch(() => void 0);
					throw new UpdaterError("integrity-failed", "Загрузка превысила подписанный размер Setup.");
				}
				await file.write(Buffer.from(value));
				emit(this.options, {
					phase: "downloading",
					message: `Загружаем ${candidate.version}…`,
					version: candidate.version,
					percent: Math.min(99, Math.floor(transferred / candidate.size * 100)),
					transferred,
					total: candidate.size
				});
			}
			if (timedOut) throw new UpdaterError("timeout", "Загрузка обновления не завершилась вовремя.", true);
			if (transferred !== candidate.size) throw new UpdaterError("download-failed", "Загрузка прервана; повторный запуск продолжит её.", true);
		} finally {
			clearTimeout(timeout);
			await file.close();
		}
	}
	updatesDirectory() {
		return path.join(this.options.userDataDir, "updates");
	}
	trustStatePath() {
		return path.join(this.updatesDirectory(), "trust-state.json");
	}
	async removeCandidateFiles(candidate) {
		const partialPath = path.join(this.updatesDirectory(), `${candidate.assetName}.partial`);
		await Promise.all([
			promises.rm(partialPath, { force: true }),
			promises.rm(`${partialPath}.json`, { force: true }),
			promises.rm(path.join(this.updatesDirectory(), candidate.assetName), { force: true })
		]);
	}
};
//#endregion
