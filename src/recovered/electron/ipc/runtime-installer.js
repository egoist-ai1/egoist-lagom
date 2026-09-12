//#region src/electron/ipc/runtime-installer.ts
var XRAY_PLAN = {
	runtimeKind: "xray",
	displayName: "Xray",
	runtimeDirName: "xray",
	exeName: "xray.exe",
	releaseApiUrl: "https://api.github.com/repos/XTLS/Xray-core/releases/latest",
	releasePageUrl: "https://github.com/XTLS/Xray-core/releases/latest",
	assetMatchers: [/windows-64.*\.zip$/i, /windows.*amd64.*\.zip$/i],
	fallbackAssetName: () => "Xray-windows-64.zip",
	extraFiles: ["geoip.dat", "geosite.dat", "wintun.dll", "WINTUN-LICENSE.txt"]
};
var SING_BOX_PLAN = {
	runtimeKind: "sing-box",
	displayName: "sing-box",
	runtimeDirName: "sing-box",
	exeName: "sing-box.exe",
	releaseApiUrl: "https://api.github.com/repos/SagerNet/sing-box/releases/latest",
	releasePageUrl: "https://github.com/SagerNet/sing-box/releases/latest",
	assetMatchers: [/windows-amd64\.zip$/i, /windows-amd64.*\.zip$/i],
	assetExcludes: [/legacy-windows-7/i],
	fallbackAssetName: (tagName) => {
		const normalized = normalizeVersionTag(tagName);
		return normalized ? `sing-box-${normalized}-windows-amd64.zip` : null;
	}
};
var RuntimeInstaller = class {
	appRoot;
	userDataDir;
	installQueue = Promise.resolve();
	constructor(appRoot, userDataDir) {
		this.appRoot = appRoot;
		this.userDataDir = userDataDir;
	}
	async installXray() {
		return this.installRuntime(XRAY_PLAN);
	}
	async installSingBox() {
		return this.installRuntime(SING_BOX_PLAN);
	}
	async installAll() {
		const results = [await this.installXray(), await this.installSingBox()];
		const ok = results.every((item) => item.ok);
		const failed = results.filter((item) => !item.ok);
		return {
			ok,
			message: failed.length === 0 ? "Runtime-компоненты готовы." : `Часть runtime не установлена (${failed.length}).`,
			results
		};
	}
	async checkUpdates() {
		return Promise.all([this.checkRuntimePlan(XRAY_PLAN), this.checkRuntimePlan(SING_BOX_PLAN)]);
	}
	installRuntime(plan) {
		const next = this.installQueue.then(() => this.installRuntimeTransaction(plan));
		this.installQueue = next.catch(() => void 0);
		return next;
	}
	async installRuntimeTransaction(plan) {
		const targetDir = path.join(this.userDataDir, "runtime", plan.runtimeDirName);
		await this.recoverRuntimeDirectory(targetDir);
		const runtimePath = path.join(targetDir, plan.exeName);
		const versionPath = path.join(targetDir, "VERSION.txt");
		await promises.mkdir(targetDir, { recursive: true });
		const hadRuntimeBefore = await this.pathExists(runtimePath);
		const installedVersion = await readVersionFile(versionPath);
		const tempRoot = path.join(this.userDataDir, "runtime", "_download", `${plan.runtimeDirName}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		try {
			if (!hadRuntimeBefore) {
				const bundledResult = await this.tryUseBundledRuntime(plan, targetDir, runtimePath, versionPath);
				if (bundledResult) return {
					...bundledResult,
					message: `${plan.displayName} взят из встроенного пакета. Обновление можно проверить позже.`
				};
			}
			if (hadRuntimeBefore) {
				const bundledVersion = await this.readBundledVersion(plan);
				if (bundledVersion !== null && (installedVersion === null || compareLooseVersions(bundledVersion, installedVersion) > 0)) {
					const bundledResult = await this.tryUseBundledRuntime(plan, targetDir, runtimePath, versionPath);
					if (bundledResult) return {
						...bundledResult,
						message: `${plan.displayName} обновлён из встроенного пакета (${bundledVersion}).`
					};
				}
			}
			const resolvedRelease = await resolveLatestGitHubRelease(plan.releaseApiUrl);
			const releaseTag = resolvedRelease.tag_name?.trim() || "latest";
			const asset = resolvedRelease.release ? pickGitHubAsset(resolvedRelease.release, plan.assetMatchers, plan.assetExcludes ?? []) : null;
			const fallbackAssetName = plan.fallbackAssetName?.(releaseTag) ?? null;
			const assetDownloadUrl = asset?.browser_download_url ?? (fallbackAssetName ? buildGitHubAssetDownloadUrl(plan.releaseApiUrl, releaseTag, fallbackAssetName) : null);
			if (!assetDownloadUrl) throw new Error(`Не найден архив ${plan.displayName} для Windows x64.`);
			if (hadRuntimeBefore && installedVersion && compareLooseVersions(installedVersion, releaseTag) >= 0) return {
				ok: true,
				message: `${plan.displayName} уже актуален (${installedVersion}).`,
				runtimePath,
				runtimeKind: plan.runtimeKind,
				version: installedVersion,
				updated: false
			};
			const zipPath = path.join(tempRoot, asset?.name || fallbackAssetName || `${plan.runtimeDirName}.zip`);
			const extractDir = path.join(tempRoot, "extract");
			await promises.mkdir(tempRoot, { recursive: true });
			await downloadFileWithProgress(assetDownloadUrl, zipPath);
			const verification = await verifyGitHubReleaseAssetChecksum({
				filePath: zipPath,
				assetName: path.basename(zipPath),
				releaseApiUrl: plan.releaseApiUrl,
				tagName: releaseTag,
				release: resolvedRelease.release,
				assetDigest: asset?.digest
			});
			if (!verification.verified) throw new Error(verification.verificationMessage);
			await extractZipArchive(zipPath, extractDir);
			const extractedExe = await this.findFirstFileByName(extractDir, plan.exeName);
			if (!extractedExe) throw new Error(`В архиве ${plan.displayName} отсутствует ${plan.exeName}.`);
			const payload = path.join(tempRoot, "candidate");
			await promises.mkdir(payload, { recursive: true });
			await promises.copyFile(extractedExe, path.join(payload, plan.exeName));
			for (const filename of plan.extraFiles ?? []) {
				const source = await this.findFirstFileByName(extractDir, filename);
				if (source) await promises.copyFile(source, path.join(payload, filename));
			}
			await this.commitRuntimeDirectory(plan, payload, targetDir, releaseTag);
			return {
				ok: true,
				message: `${plan.displayName} обновлён до ${releaseTag}.`,
				runtimePath,
				runtimeKind: plan.runtimeKind,
				version: releaseTag,
				updated: true,
				verified: verification.verified,
				verificationMessage: verification.verificationMessage,
				integritySource: verification.integritySource
			};
		} catch (error) {
			const reason = this.errorToMessage(error);
			if (!hadRuntimeBefore) {
				const bundledResult = await this.tryUseBundledRuntime(plan, targetDir, runtimePath, versionPath);
				if (bundledResult) return bundledResult;
			}
			if (await this.pathExists(runtimePath)) return {
				ok: true,
				message: `Не удалось обновить ${plan.displayName}, используется локальная версия: ${reason}`,
				runtimePath,
				runtimeKind: plan.runtimeKind,
				version: installedVersion,
				updated: false
			};
			return {
				ok: false,
				message: `Не удалось установить ${plan.displayName}: ${reason}`,
				runtimePath: null,
				runtimeKind: plan.runtimeKind,
				version: null,
				updated: false
			};
		} finally {
			await promises.rm(tempRoot, {
				recursive: true,
				force: true
			}).catch(() => void 0);
		}
	}
	async checkRuntimePlan(plan) {
		const currentVersion = await this.readInstalledVersion(plan);
		try {
			const resolvedRelease = await resolveLatestGitHubRelease(plan.releaseApiUrl);
			const latestVersion = resolvedRelease.tag_name?.trim() || null;
			const updateAvailable = latestVersion === null ? false : currentVersion === null ? true : compareLooseVersions(latestVersion, currentVersion) > 0;
			return {
				runtimeKind: plan.runtimeKind,
				displayName: plan.displayName,
				currentVersion,
				latestVersion,
				updateAvailable,
				releaseUrl: resolvedRelease.html_url ?? plan.releasePageUrl,
				integritySource: "sha256",
				verificationMessage: "Runtime-архив будет принят только при совпадении опубликованного SHA-256 checksum.",
				message: latestVersion ? updateAvailable ? `Доступно обновление ${plan.displayName}: ${latestVersion}` : `${plan.displayName} уже актуален (${currentVersion ?? latestVersion}).` : `Не удалось определить последнюю версию ${plan.displayName}.`
			};
		} catch (error) {
			return {
				runtimeKind: plan.runtimeKind,
				displayName: plan.displayName,
				currentVersion,
				latestVersion: null,
				updateAvailable: false,
				releaseUrl: plan.releasePageUrl,
				message: `Не удалось проверить ${plan.displayName}: ${this.errorToMessage(error)}`
			};
		}
	}
	async tryUseBundledRuntime(plan, targetDir, runtimePath, versionPath) {
		const bundledDir = await this.findBundledRuntimeDir(plan);
		if (!bundledDir) return null;
		const bundledVersion = await readVersionFile(path.join(bundledDir, "VERSION.txt"));
		await this.commitRuntimeDirectory(plan, bundledDir, targetDir, bundledVersion ?? "bundled");
		return {
			ok: true,
			message: `${plan.displayName} взят из встроенного пакета.`,
			runtimePath,
			runtimeKind: plan.runtimeKind,
			version: bundledVersion ?? "bundled",
			updated: true
		};
	}
	async recoverRuntimeDirectory(targetDir) {
		const previous = `${targetDir}.previous`;
		if (!await this.pathExists(previous)) return;
		if (!await this.pathExists(targetDir)) await promises.rename(previous, targetDir);
		else await promises.rm(previous, { recursive: true, force: true });
	}
	async commitRuntimeDirectory(plan, sourceDir, targetDir, version) {
		await this.recoverRuntimeDirectory(targetDir);
		const candidate = `${targetDir}.candidate-${randomUUID()}`;
		const previous = `${targetDir}.previous`;
		let movedPrevious = false;
		try {
			await promises.mkdir(candidate, { recursive: true });
			const bundledDir = plan.extraFiles?.length ? await this.findBundledRuntimeDir(plan) : null;
			for (const filename of [plan.exeName, ...(plan.extraFiles ?? [])]) {
				const incoming = path.join(sourceDir, filename);
				const existing = path.join(targetDir, filename);
				const bundled = filename !== plan.exeName && bundledDir ? path.join(bundledDir, filename) : null;
				const source = await this.pathExists(incoming) ? incoming : await this.pathExists(existing) ? existing : bundled && await this.pathExists(bundled) ? bundled : null;
				if (!source) throw new Error(`${plan.displayName}: отсутствует обязательный файл ${filename}.`);
				await promises.copyFile(source, path.join(candidate, filename));
			}
			await promises.writeFile(path.join(candidate, "VERSION.txt"), `${version}\n`, "utf8");
			await this.validateRuntimeExecutable(path.join(candidate, plan.exeName));
			if (await this.pathExists(targetDir)) {
				await promises.rename(targetDir, previous);
				movedPrevious = true;
			}
			try { await promises.rename(candidate, targetDir); }
			catch (error) {
				if (movedPrevious) await promises.rename(previous, targetDir);
				throw error;
			}
			// A leftover backup after a sharing violation is harmless and recovered later.
			await promises.rm(previous, { recursive: true, force: true }).catch(() => void 0);
		} finally {
			await promises.rm(candidate, { recursive: true, force: true }).catch(() => void 0);
		}
	}
	async validateRuntimeExecutable(executable) {
		await promisify(execFile)(executable, ["version"], { windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024 });
	}
	async findFirstFileByName(rootDir, filename) {
		const stack = [rootDir];
		const lowerName = filename.toLowerCase();
		while (stack.length > 0) {
			const dir = stack.pop();
			if (!dir) break;
			let entries;
			try {
				entries = await promises.readdir(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					stack.push(fullPath);
					continue;
				}
				if (entry.isFile() && entry.name.toLowerCase() === lowerName) return fullPath;
			}
		}
		return null;
	}
	async readInstalledVersion(plan) {
		const versionPaths = [path.join(this.userDataDir, "runtime", plan.runtimeDirName, "VERSION.txt")];
		for (const bundledDir of this.getBundledRuntimeDirCandidates(plan)) versionPaths.push(path.join(bundledDir, "VERSION.txt"));
		for (const versionPath of versionPaths) {
			const version = await readVersionFile(versionPath);
			if (version) return version;
		}
		return null;
	}
	async readBundledVersion(plan) {
		for (const bundledDir of this.getBundledRuntimeDirCandidates(plan)) {
			const version = await readVersionFile(path.join(bundledDir, "VERSION.txt"));
			if (version) return version;
		}
		return null;
	}
	async findBundledRuntimeDir(plan) {
		for (const bundledDir of this.getBundledRuntimeDirCandidates(plan)) if (await this.pathExists(path.join(bundledDir, plan.exeName))) return bundledDir;
		return null;
	}
	getBundledRuntimeDirCandidates(plan) {
		const execResourcesPath = path.join(path.dirname(process.execPath), "resources");
		return Array.from(/* @__PURE__ */ new Set([
			path.join(this.appRoot, "runtime", plan.runtimeDirName),
			path.join(this.appRoot, "resources", "runtime", plan.runtimeDirName),
			path.join(execResourcesPath, "runtime", plan.runtimeDirName),
			path.join(execResourcesPath, "resources", "runtime", plan.runtimeDirName),
			path.join(process.cwd(), "runtime", plan.runtimeDirName),
			path.join(process.cwd(), "resources", "runtime", plan.runtimeDirName)
		]));
	}
	async pathExists(filePath) {
		try {
			await promises.access(filePath);
			return true;
		} catch {
			return false;
		}
	}
	errorToMessage(error) {
		if (error instanceof Error) return error.message;
		return String(error);
	}
};
//#endregion
