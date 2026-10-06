//#region src/electron/ipc/state-store.ts
var DEFAULT_STATE = {
	stateRevision: 0,
	nodes: [],
	activeNodeId: null,
	subscriptions: [],
	processRules: [],
	domainRules: [],
	settings: {
		autoStart: false,
		startMinimized: false,
		minimizeToTray: false,
		autoUpdate: true,
		useTunMode: false,
		killSwitch: false,
		autoConnect: false,
		notifications: true,
		soundNotifications: false,
		reconnectOnDrop: true,
		allowTelemetry: false,
		allowExternalGeoLookups: false,
		logLevel: "info",
		keepLogsDays: 7,
		dnsMode: "auto",
		systemDnsServers: "",
		customDnsUrl: "",
		systemDohEnabled: false,
		systemDohUrl: "https://cloudflare-dns.com/dns-query",
		systemDohLocalAddress: "",
		subscriptionUserAgent: "auto",
		sendSubscriptionHwid: false,
		privacyConsentVersion: 1,
		runtimePath: "",
		routeMode: "global",
		zapretProfile: "General",
		zapretSuspendDuringVpn: true
	},
	usageHistory: []
};
function sanitizeState(state) {
	const hasCurrentPrivacyConsent = state.settings.privacyConsentVersion === 1;
	return normalizePersistedDisplayText({
		...state,
		nodes: state.nodes ?? [],
		processRules: state.processRules ?? [],
		settings: {
			...state.settings,
			killSwitch: false,
			minimizeToTray: state.settings.minimizeToTray ?? state.settings.startMinimized ?? false,
			useTunMode: state.settings.useTunMode ?? false,
			systemDnsServers: state.settings.systemDnsServers ?? "",
			customDnsUrl: normalizeCustomDnsUrl(state.settings.customDnsUrl, ""),
			systemDohEnabled: state.settings.systemDohEnabled ?? false,
			systemDohUrl: normalizeSystemDohUrl(state.settings.systemDohUrl, "https://cloudflare-dns.com/dns-query"),
			systemDohLocalAddress: normalizeSystemDohLocalAddress(state.settings.systemDohLocalAddress, ""),
			soundNotifications: state.settings.soundNotifications ?? false,
			allowExternalGeoLookups: state.settings.allowExternalGeoLookups === true,
			reconnectOnDrop: state.settings.reconnectOnDrop ?? true,
			logLevel: [
				"error",
				"warn",
				"info",
				"debug"
			].includes(String(state.settings.logLevel)) ? String(state.settings.logLevel) : "info",
			keepLogsDays: [
				7,
				30,
				90
			].includes(Number(state.settings.keepLogsDays)) ? Number(state.settings.keepLogsDays) : 7,
			sendSubscriptionHwid: hasCurrentPrivacyConsent ? state.settings.sendSubscriptionHwid === true : false,
			privacyConsentVersion: 1,
			zapretProfile: state.settings.zapretProfile?.trim() || "General",
			zapretSuspendDuringVpn: state.settings.zapretSuspendDuringVpn ?? true
		}
	});
}
function nodeFingerprint(node) {
	const metadata = node.metadata ?? {};
	const authKey = String(metadata.id ?? metadata.password ?? metadata.username ?? "");
	return `${node.protocol}|${node.server}|${node.port}|${authKey}`;
}
function subscriptionHost(url) {
	if (!url) return null;
	try {
		return new URL(url).host.toLowerCase();
	} catch {
		return null;
	}
}
var StateStore = class {
	filePath;
	backupPath;
	installationPath;
	activationMarkerPath;
	state = structuredClone(DEFAULT_STATE);
	hasConfirmedState = false;
	storageSequence = 0;
	confirmedDisk = null;
	loadPromise = null;
	loadInProgress = false;
	recoveryCopy = null;
	preservedCorruptFingerprint = null;
	storage = { status: "loading", writable: false, hasConfirmedState: false, source: "none", checkedAt: null, error: "STATE_STORAGE_UNAVAILABLE", systemCode: null, recoveryCopy: null };
	/** Очередь атомарных read-modify-write мутаций. */
	mutationQueue = Promise.resolve();
	/**
	* Ревизия подтверждённого состояния.
	*
	* Растёт ТОЛЬКО после успешной записи на диск, поэтому её можно использовать
	* как ожидаемую версию в патчах: конфликт обнаруживается, а не приводит к
	* молчаливой перезаписи чужого изменения (MED-13).
	*/
	revision = 0;
	constructor(baseDir, installationPath) {
		this.filePath = path.join(baseDir, "egoistshield-state.json");
		this.backupPath = `${this.filePath}.bak`;
		this.installationPath = installationPath;
		this.activationMarkerPath = path.join(baseDir, "installation-activation.json");
	}
	getStorageStatus() {
		// Valid bytes are readable during activation; public readiness waits for its whole transaction.
		const storage = this.loadInProgress && this.storage.writable
			? { ...this.storage, status: "loading", writable: false, error: "STATE_STORAGE_UNAVAILABLE" }
			: this.storage;
		return structuredClone(storage);
	}
	getSnapshot() {
		return { state: this.hasConfirmedState ? this.get() : null, storage: this.getStorageStatus() };
	}
	storageError(code = this.storage.error || "STATE_STORAGE_UNAVAILABLE") {
		const error = new Error(code);
		error.code = code;
		return error;
	}
	assertStorageWritable() {
		if (!this.storage.writable) throw this.storageError();
	}
	setStorage(status, source, systemCode = null) {
		this.storage = {
			status, sequence: ++this.storageSequence, writable: status === "ready", hasConfirmedState: this.hasConfirmedState,
			source, checkedAt: new Date().toISOString(),
			error: status === "ready" ? null : status === "corrupt" ? "STATE_STORAGE_CORRUPT" : "STATE_STORAGE_UNAVAILABLE",
			systemCode: typeof systemCode === "string" ? systemCode : null,
			recoveryCopy: this.recoveryCopy
		};
		try { this.onStorageChange?.(this.getStorageStatus()); } catch (error) { logger.warn("[state-store] Storage observer failed.", error); }
	}
	publishConfirmed(state, source) {
		this.state = sanitizeState(state);
		this.revision = state.stateRevision;
		this.hasConfirmedState = true;
		this.confirmedDisk = JSON.stringify(state);
		this.setStorage("ready", source);
	}
	async load() {
		if (this.loadPromise) return this.loadPromise;
		this.loadInProgress = true;
		this.setStorage("loading", this.hasConfirmedState ? "memory" : "none");
		// The whole activation occupies one queue entry. Public mutations and native admission
		// cannot interleave between verified profile bytes and installation/DNS activation.
		const activate = async () => {
			await this.loadProfile();
			if (this.storage.writable) {
				// These writes already own the queue; calling the public updater here would deadlock.
				const commit = mutate => this.commitMutation(current => sanitizeState(mutate(current)));
				try {
					await this.applyInstallationDefaults(commit);
					await this.reconcileOwnedSystemDohPreferences(commit);
				} catch (error) {
					this.setStorage("unavailable", this.storage.source, error?.code);
					logger.warn("[state-store] Profile activation is unavailable; saved data retained.", error);
				}
			}
			return this.get();
		};
		const run = this.mutationQueue.then(activate, activate);
		this.loadPromise = run.finally(() => {
			this.loadInProgress = false;
			this.loadPromise = null;
			this.setStorage(this.storage.status, this.storage.source, this.storage.systemCode);
		});
		this.mutationQueue = this.loadPromise.then(() => void 0, () => void 0);
		return this.loadPromise;
	}
	async retryLoad() {
		await this.load();
		return this.getSnapshot();
	}
	async readCandidate(filePath) {
		let raw;
		try { raw = await promises.readFile(filePath); }
		catch (error) { return { kind: error?.code === "ENOENT" ? "missing" : "unavailable", error }; }
		const fingerprint = typeof raw === "string" ? raw : raw.toString("base64");
		try {
			const state = this.parseStateContents(raw);
			return { kind: "valid", state, raw, fingerprint, signature: JSON.stringify(state) };
		} catch (error) { return { kind: "corrupt", raw, fingerprint, error }; }
	}
	async loadProfile() {
		const primary = await this.readCandidate(this.filePath);
		if (primary.kind === "valid") {
			this.publishConfirmed(primary.state, "primary");
			const repaired = { ...this.state, legacyMigrationVersion: 1 };
			// A current profile is authoritative. Mark that decision atomically, without merging legacy data.
			if (JSON.stringify(repaired) !== JSON.stringify(primary.state)) {
				try { await this.commitLoadedState(repaired, primary, "primary"); }
				catch (error) { this.setStorage("unavailable", "primary", error?.code); }
			}
			return;
		}
		const backup = await this.readCandidate(this.backupPath);
		if (backup.kind === "valid") {
			if (!this.hasConfirmedState) {
				this.state = sanitizeState(backup.state);
				this.revision = backup.state.stateRevision;
				this.hasConfirmedState = true;
			}
			// A lock/ACL error never authorizes overwriting the primary.
			if (primary.kind === "unavailable") {
				this.setStorage("unavailable", this.confirmedDisk ? "memory" : "backup", primary.error?.code);
				return;
			}
			try {
				if (primary.kind === "corrupt") await this.preserveCorruptPrimary(primary);
				await this.commitLoadedState({ ...sanitizeState(backup.state), legacyMigrationVersion: 1 }, primary, "backup", false);
				logger.warn("[state-store] Restored verified backup; original corrupt bytes retained.");
			} catch (error) {
				this.setStorage("unavailable", this.confirmedDisk ? "memory" : "backup", error?.code);
			}
			return;
		}
		if (primary.kind === "missing" && backup.kind === "missing") {
			if (this.hasConfirmedState) {
				this.setStorage("unavailable", "memory", "ENOENT");
				return;
			}
			try {
				const migration = await this.migrateLegacyState(structuredClone(DEFAULT_STATE), { strict: true });
				await this.commitLoadedState({ ...sanitizeState(migration.state), legacyMigrationVersion: 1 }, primary, migration.changed ? "legacy" : "new", false);
			} catch (error) {
				this.setStorage(error instanceof SyntaxError || error instanceof TypeError ? "corrupt" : "unavailable", "none", error?.code);
			}
			return;
		}
		const unavailable = [primary, backup].find(candidate => candidate.kind === "unavailable");
		this.setStorage(unavailable ? "unavailable" : "corrupt", this.hasConfirmedState ? "memory" : "none", unavailable?.error?.code);
		logger.warn("[state-store] Saved profile unavailable; writes and preference side effects are blocked.");
	}
	async preserveCorruptPrimary(candidate) {
		if (this.preservedCorruptFingerprint === candidate.fingerprint) return;
		const file = this.filePath + ".corrupt-" + randomUUID();
		const handle = await promises.open(file, "wx");
		try { await handle.writeFile(candidate.raw); await handle.sync(); }
		finally { await handle.close(); }
		this.preservedCorruptFingerprint = candidate.fingerprint;
		this.recoveryCopy = path.basename(file);
	}
	async commitLoadedState(state, expectedPrimary, source, preserveBackup = true) {
		const next = { ...state, stateRevision: Math.max(this.revision, state.stateRevision) + 1 };
		if (!Number.isSafeInteger(next.stateRevision)) throw new Error("State revision limit reached");
		await this.writeStateFile(JSON.stringify(next, null, 2), { expectedPrimary, preserveBackup });
		this.publishConfirmed(next, source);
	}
	async checkStorageWritable() {
		const run = this.mutationQueue.then(() => this.probeStorageWritable(), () => this.probeStorageWritable());
		this.mutationQueue = run.then(() => void 0, () => void 0);
		await run;
	}
	async withWritableState(effect) {
		// A native preference effect shares the commit queue without rewriting data/revision.
		// The callback must not enqueue another StateStore mutation of its own.
		const apply = async () => {
			await this.probeStorageWritable();
			return await effect(this.get());
		};
		const run = this.mutationQueue.then(apply, apply);
		this.mutationQueue = run.then(() => void 0, () => void 0);
		return await run;
	}
	async probeStorageWritable() {
		const primary = await this.verifyWritableState();
		const probes = [];
		try {
			// Admission for native actions checks real payload/backup writes, without replacing either file.
			for (const destination of [this.filePath, this.backupPath]) {
				const probe = await this.stageFile(destination, primary.raw);
				probes.push(probe);
				const readback = await this.readCandidate(probe);
				if (readback.kind !== "valid" || readback.fingerprint !== primary.fingerprint) {
					throw readback.error ?? Object.assign(new Error("Storage probe readback failed"), { code: "EIO" });
				}
			}
			await this.assertExpectedPrimary(primary);
			// A failed cleanup is a failed probe too; do not leave an admission result behind it.
			for (const probe of probes) await promises.rm(probe, { force: true });
		} catch (error) {
			if (error?.code === "STATE_REVISION_CONFLICT") {
				await this.verifyWritableState();
				throw error;
			}
			this.setStorage(error?.code === "STATE_STORAGE_CORRUPT" ? "corrupt" : "unavailable", "memory", error?.code);
			throw this.storageError();
		} finally {
			for (const probe of probes) await promises.rm(probe, { force: true }).catch(() => void 0);
		}
	}
	async verifyWritableState() {
		this.assertStorageWritable();
		const primary = await this.readCandidate(this.filePath);
		if (primary.kind !== "valid") {
			this.setStorage(primary.kind === "corrupt" ? "corrupt" : "unavailable", this.hasConfirmedState ? "memory" : "none", primary.error?.code);
			throw this.storageError();
		}
		if (primary.signature !== this.confirmedDisk) {
			this.publishConfirmed(primary.state, "primary");
			throw this.storageError("STATE_REVISION_CONFLICT");
		}
		return primary;
	}
	async assertExpectedPrimary(expected) {
		const actual = await this.readCandidate(this.filePath);
		if (actual.kind === expected.kind && (actual.kind === "missing" || actual.fingerprint === expected.fingerprint)) return;
		if (actual.kind === "unavailable") throw this.storageError("STATE_STORAGE_UNAVAILABLE");
		if (actual.kind === "corrupt" && expected.kind !== "corrupt") throw this.storageError("STATE_STORAGE_CORRUPT");
		throw this.storageError("STATE_REVISION_CONFLICT");
	}
	async applyInstallationDefaults(commit = mutate => this.update(mutate)) {
		if (!this.installationPath) return;
		const installation = JSON.parse(await promises.readFile(this.installationPath, "utf8"));
		if (typeof installation.id !== "string" || !/^[a-f0-9-]{36}$/i.test(installation.id)) throw new Error("Invalid installation identity.");
		let previous;
		try { previous = JSON.parse(await promises.readFile(this.activationMarkerPath, "utf8")); } catch { previous = null; }
		if (previous?.id === installation.id) return;
		await commit((current) => {
			const preferredUrl = this.validSystemDohPreferenceUrl(current.settings.systemDohUrl);
			return {
				...current,
				settings: {
					...current.settings,
					autoStart: false, autoConnect: false, useTunMode: false, killSwitch: false,
					systemDohEnabled: preferredUrl ? current.settings.systemDohEnabled : false,
					systemDohUrl: preferredUrl || DEFAULT_STATE.settings.systemDohUrl,
					systemDohLocalAddress: preferredUrl ? current.settings.systemDohLocalAddress : ""
				}
			};
		});
		await promises.writeFile(this.activationMarkerPath, JSON.stringify({ id: installation.id }), "utf8");
	}
	validSystemDohPreferenceUrl(value) {
		const normalized = normalizeSystemDohUrl(value, "");
		try {
			const parsed = new URL(normalized);
			return parsed.protocol === "https:" && parsed.hostname && !parsed.username && !parsed.password && !parsed.hash ? normalized : "";
		} catch { return ""; }
	}
	canRestoreOwnedSystemDohPreference(settings) {
		return settings.systemDohEnabled === false && !String(settings.systemDnsServers ?? "").trim()
			&& !String(settings.customDnsUrl ?? "").trim()
			&& normalizeSystemDohUrl(settings.systemDohUrl, "") === DEFAULT_STATE.settings.systemDohUrl;
	}
	async reconcileOwnedSystemDohPreferences(commit = mutate => this.update(mutate)) {
		if (typeof this.readOwnedSystemDohStatus !== "function" || !this.canRestoreOwnedSystemDohPreference(this.get().settings)) return false;
		let status;
		try { status = await this.readOwnedSystemDohStatus(); }
		catch {
			logger.warn("[state-store] Owned DNS preferences were not reconciled because status inspection failed.");
			return false;
		}
		if (!status || status.available !== true || status.enabled !== true || status.running !== true
			|| status.verified !== true || status.encrypted !== true
			|| ["unknown", "unavailable"].includes(status.serviceState)
			|| status.ownerInspectionErrors?.length) return false;
		const ownedHealthy = status.nativeManaged === true
			? status.fallbackToUdp === false
			: status.nativeManaged === false && status.serviceInstalled === true && status.serviceRunning === true && status.serviceState === "running";
		const url = this.validSystemDohPreferenceUrl(status.currentUrl);
		if (!ownedHealthy || !url) return false;
		let restored = false;
		await commit((current) => {
			if (!this.canRestoreOwnedSystemDohPreference(current.settings)) return current;
			restored = true;
			return {
				...current,
				settings: {
					...current.settings,
					systemDohEnabled: true,
					systemDohUrl: url,
					systemDohLocalAddress: status.nativeManaged ? "" : normalizeSystemDohLocalAddress(status.localAddress, "")
				}
			};
		});
		if (restored) logger.info("[state-store] Restored preferences for the verified owned DNS resolver.");
		return restored;
	}
	get() {
		return structuredClone({ ...this.state, stateRevision: this.revision });
	}
	/** Текущая ревизия состояния. Растёт только при подтверждённой записи. */
	getRevision() {
		return this.revision;
	}
	/**
	* Полная замена состояния.
	*
	* ЧТО БЫЛО НЕ ТАК (HIGH-08)
	*
	* `this.state` менялся ДО записи на диск. Если запись падала (нет места,
	* read-only, ACL), память оставалась новой, а диск — старым: приложение
	* работало с состоянием, которого не существует, и следующий запуск
	* незаметно откатывал изменения пользователя.
	*
	* Теперь новое состояние сначала сериализуется и фиксируется на диске, и
	* только после подтверждённого commit публикуется в памяти. При ошибке
	* память остаётся ТОЧНО такой, какой была.
	*
	* Полная замена требует ревизию исходного снимка. Очередь сама по себе
	* не защищает от устаревшего get()+set(): конфликт проверяется внутри неё.
	*/
	async set(next, expectedRevision = next?.stateRevision, options = {}) {
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
			const error = new Error("STATE_REVISION_REQUIRED");
			error.code = "STATE_REVISION_REQUIRED";
			throw error;
		}
		return this.runMutation(() => sanitizeState(structuredClone(next)), { ...options, expectedRevision });
	}
	/**
	* Атомарное read-modify-write поверх актуального состояния.
	* Обычная пара `get()` + `set()` теряет обновления при параллельных вызовах
	* (классический lost update): каждый вызывающий пишет свою копию снимка.
	* mutate получает свежее состояние в момент записи и его результат
	* сохраняется без промежуточного окна.
	*/
	async update(mutate) {
		return this.runMutation((current) => sanitizeState(mutate(current)));
	}
	async patch(next) {
		return this.runMutation((current) => sanitizeState({
			...current,
			...next,
			settings: {
				...current.settings,
				...next.settings ?? {}
			}
		}));
	}
	/**
	* Поле-ориентированный патч с проверкой ожидаемой ревизии (MED-13).
	*
	* Передача всего объекта состояния из экрана «Настройки» затирала
	* параллельные изменения узлов и подписок. Здесь вызывающий сообщает, какую
	* ревизию он видел; если состояние успело измениться, возвращается конфликт,
	* а не молчаливая перезапись.
	*/
	async patchSettings(settings, expectedRevision, options = {}) {
		try {
			const state = await this.runMutation((current) => {
				return sanitizeState({
				...current,
				settings: {
					...current.settings,
					...settings
				}
				});
			}, { ...options, expectedRevision });
			return {
				ok: true,
				conflict: false,
				revision: state.stateRevision,
				state
			};
		} catch (error) {
			if (error?.code === "STATE_REVISION_CONFLICT") return {
				ok: false,
				conflict: true,
				revision: this.revision,
				state: this.get(),
				error: "STATE_REVISION_CONFLICT"
			};
			logger.error("[state-store] settings patch failed; in-memory state kept unchanged:", error);
			return {
				ok: false,
				conflict: false,
				revision: this.revision,
				state: this.get(),
				error: ["STATE_STORAGE_UNAVAILABLE", "STATE_STORAGE_CORRUPT"].includes(error?.code) ? error.code : "STATE_WRITE_FAILED"
			};
		}
	}
	async patchRules(patch, expectedRevision) {
		try {
			if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
				const error = new Error("STATE_REVISION_REQUIRED");
				error.code = "STATE_REVISION_REQUIRED";
				throw error;
			}
			const keys = patch && typeof patch === "object" && !Array.isArray(patch) ? Object.keys(patch) : [];
			if (keys.length === 0 || keys.some((key) => !["domainRules", "processRules"].includes(key) || !Array.isArray(patch[key]) || patch[key].length > 256)) {
				const error = new Error("STATE_RULES_INVALID");
				error.code = "STATE_RULES_INVALID";
				throw error;
			}
			// Capture caller-owned arrays before joining the shared mutation queue.
			const rules = Object.fromEntries(keys.map((key) => [key, structuredClone(patch[key])]));
			const state = await this.runMutation((current) => ({ ...current, ...rules }), { expectedRevision });
			return { ok: true, conflict: false, revision: state.stateRevision, state };
		} catch (error) {
			const conflict = error?.code === "STATE_REVISION_CONFLICT";
			const known = ["STATE_REVISION_REQUIRED", "STATE_RULES_INVALID", "STATE_REVISION_CONFLICT", "STATE_STORAGE_UNAVAILABLE", "STATE_STORAGE_CORRUPT"].includes(error?.code);
			if (!known) logger.error("[state-store] rules patch failed; in-memory state kept unchanged:", error);
			return { ok: false, conflict, revision: this.revision, state: this.get(), error: known ? error.code : "STATE_WRITE_FAILED" };
		}
	}
	/**
	* Единственный путь мутации: очередь + запись до публикации в памяти.
	*
	* Очередь исключает lost update между параллельными вызовами, а порядок
	* «сериализовать -> записать -> опубликовать» гарантирует, что память и диск
	* не разъезжаются при ошибке записи.
	*/
	async runMutation(mutate, options = {}) {
		const run = this.mutationQueue.then(() => this.commitMutation(mutate, options), () => this.commitMutation(mutate, options));
		this.mutationQueue = run.then(() => void 0, () => void 0);
		await run;
		return this.get();
	}
	async commitMutation(mutate, { expectedRevision, beforeCommit, rollback } = {}) {
		const expectedPrimary = await this.verifyWritableState();
		if (expectedRevision !== void 0 && expectedRevision !== this.revision) {
			const error = new Error("STATE_REVISION_CONFLICT");
			error.code = "STATE_REVISION_CONFLICT";
			throw error;
		}
		if (this.revision >= Number.MAX_SAFE_INTEGER) throw new Error("State revision limit reached");
		const previous = this.state;
		const next = { ...mutate(structuredClone(this.state)), legacyMigrationVersion: 1, stateRevision: this.revision + 1 };
		const serialized = JSON.stringify(next, null, 2);
		let sideEffectsAttempted = false;
		try {
			await this.writeStateFile(serialized, {
				expectedPrimary,
				beforeCommit: beforeCommit ? async () => {
					sideEffectsAttempted = true;
					await beforeCommit(structuredClone(next), structuredClone(previous));
				} : null
			});
		} catch (error) {
			if (sideEffectsAttempted && rollback) try { await rollback(structuredClone(previous)); } catch (rollbackError) {
				logger.error("[state-store] Failed to restore settings side effects:", rollbackError);
			}
			this.state = previous;
			this.setStorage(error?.code === "STATE_STORAGE_CORRUPT" ? "corrupt" : "unavailable", "memory", error?.code);
			throw error;
		}
		this.publishConfirmed(next, "primary");
	}
	async findLegacySubscriptionFallback(url) {
		const legacy = await this.readLegacyState();
		if (!legacy || legacy.nodes.length === 0) return null;
		const requestedHost = subscriptionHost(url);
		const legacySub = legacy.subscriptions.find((item) => String(item.url ?? "") === url) ?? (requestedHost ? legacy.subscriptions.find((item) => subscriptionHost(String(item.url ?? "")) === requestedHost) : null);
		if (!legacySub) return null;
		let nodes = legacy.nodes.filter((node) => !legacySub.id || node.subscriptionId === legacySub.id);
		if (nodes.length === 0 && legacy.subscriptions.length === 1) nodes = legacy.nodes;
		if (nodes.length === 0) return null;
		return {
			name: typeof legacySub.name === "string" ? legacySub.name : null,
			userinfo: {
				...Number.isFinite(Number(legacySub.upload)) ? { upload: Number(legacySub.upload) } : {},
				...Number.isFinite(Number(legacySub.download)) ? { download: Number(legacySub.download) } : {},
				...Number.isFinite(Number(legacySub.total)) ? { total: Number(legacySub.total) } : {},
				...Number.isFinite(Number(legacySub.expire)) ? { expire: Number(legacySub.expire) } : {}
			},
			nodes: nodes.map((node) => ({
				...node,
				subscriptionId: void 0
			}))
		};
	}
	/** save() uses the same mutation queue as all other acknowledged writes. */
	async save() {
		return this.runMutation((current) => current);
	}
	/**
	* Атомарная запись КОНКРЕТНОГО снимка.
	*
	* Раньше метод сериализовал текущий глобальный `this.state`, поэтому запись,
	* начатая для одной ревизии, могла сохранить на диск уже другую — с
	* изменениями, которые ещё не подтверждены. Снимок передаётся аргументом.
	*
	* Порядок: temp -> fsync файла -> rename -> fsync каталога. Без fsync
	* каталога переименование могло не дожить до перезагрузки после сбоя
	* питания, и файл состояния исчез бы целиком.
	*/
	async stageFile(destination, bytes) {
		const tempPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
		try {
			const handle = await promises.open(tempPath, "wx");
			try { await handle.writeFile(bytes); await handle.sync(); }
			finally { await handle.close(); }
			return tempPath;
		} catch (error) {
			await promises.rm(tempPath, { force: true }).catch(() => void 0);
			throw error;
		}
	}
	async writeStateFile(serialized, { expectedPrimary, preserveBackup = true, beforeCommit } = {}) {
		const dir = path.dirname(this.filePath);
		await promises.mkdir(dir, { recursive: true });
		let tempPath = null, backupTemp = null;
		try {
			if (expectedPrimary) await this.assertExpectedPrimary(expectedPrimary);
			// Prove payload writes and backup replacement before any preference side effects.
			tempPath = await this.stageFile(this.filePath, serialized);
			if (preserveBackup && expectedPrimary?.kind === "valid") {
				// The verified bytes are immutable; re-reading a changing primary can corrupt the backup.
				backupTemp = await this.stageFile(this.backupPath, expectedPrimary.raw);
				await this.assertExpectedPrimary(expectedPrimary);
				await promises.rename(backupTemp, this.backupPath);
				backupTemp = null;
			}
			if (expectedPrimary) await this.assertExpectedPrimary(expectedPrimary);
			if (beforeCommit) await beforeCommit();
			if (expectedPrimary) await this.assertExpectedPrimary(expectedPrimary);
			await promises.rename(tempPath, this.filePath);
			tempPath = null;
			const dirHandle = await promises.open(dir, "r").catch(() => null);
			if (dirHandle) {
				await dirHandle.sync().catch(() => void 0);
				await dirHandle.close().catch(() => void 0);
			}
		} finally {
			if (tempPath) await promises.rm(tempPath, { force: true }).catch(() => void 0);
			if (backupTemp) await promises.rm(backupTemp, { force: true }).catch(() => void 0);
		}
	}
	async readStateFile(filePath) {
		return this.parseStateContents(await promises.readFile(filePath));
	}
	parseStateContents(bytes) {
		const text = typeof bytes === "string" ? bytes : bytes.toString("utf8");
		if (typeof bytes !== "string" && !Buffer.from(text, "utf8").equals(bytes)) throw new TypeError("Invalid saved UTF-8");
		const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid saved state object");
		if (parsed.stateRevision !== void 0 && (!Number.isSafeInteger(parsed.stateRevision) || parsed.stateRevision < 0)) throw new TypeError("Invalid saved state revision");
		if (parsed.settings !== void 0 && (!parsed.settings || typeof parsed.settings !== "object" || Array.isArray(parsed.settings))) throw new TypeError("Invalid saved settings");
		const state = {
			...DEFAULT_STATE,
			...parsed,
			settings: {
				...DEFAULT_STATE.settings,
				...parsed.settings ?? {}
			}
		};
		for (const name of ["nodes", "subscriptions", "processRules", "domainRules", "usageHistory"]) {
			if (!Array.isArray(state[name]) || state[name].some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new TypeError(`Invalid saved ${name}`);
		}
		for (const [name, fallback] of Object.entries(DEFAULT_STATE.settings)) {
			if (typeof state.settings[name] !== typeof fallback) throw new TypeError(`Invalid saved setting ${name}`);
		}
		return state;
	}
	async readLegacyState({ strict = false } = {}) {
		const currentDir = path.resolve(path.dirname(this.filePath));
		const legacyPath = path.join(path.dirname(currentDir), "EgoistShield", "egoistshield-state.json");
		if (path.resolve(legacyPath).toLowerCase() === path.resolve(this.filePath).toLowerCase()) return null;
		try {
			return sanitizeState(await this.readStateFile(legacyPath));
		} catch (error) {
			if (strict && error?.code !== "ENOENT") throw error;
			return null;
		}
	}
	async migrateLegacyState(current, options) {
		const legacy = await this.readLegacyState(options);
		if (!legacy) return {
			state: current,
			changed: false
		};
		if (legacy.nodes.length === 0 && legacy.subscriptions.length === 0) return {
			state: current,
			changed: false
		};
		const next = {
			...current,
			nodes: [...current.nodes],
			subscriptions: [...current.subscriptions]
		};
		const existingNodeKeys = new Set(next.nodes.map(nodeFingerprint));
		let changed = false;
		for (const legacySub of legacy.subscriptions) {
			const legacyUrl = String(legacySub.url ?? "");
			const legacyHost = subscriptionHost(legacyUrl);
			let existingIndex = next.subscriptions.findIndex((item) => String(item.url ?? "") === legacyUrl);
			if (existingIndex < 0 && next.subscriptions.length <= 1 && legacy.subscriptions.length === 1 && legacyHost !== null) existingIndex = next.subscriptions.findIndex((item) => subscriptionHost(String(item.url ?? "")) === legacyHost);
			const subscription = existingIndex >= 0 ? {
				...next.subscriptions[existingIndex],
				...legacySub,
				id: next.subscriptions[existingIndex].id
			} : legacySub;
			if (existingIndex >= 0) next.subscriptions[existingIndex] = subscription;
			else {
				next.subscriptions.push(subscription);
				changed = true;
			}
			let legacyNodes = legacy.nodes.filter((node) => !legacySub.id || node.subscriptionId === legacySub.id);
			if (legacyNodes.length === 0 && legacy.subscriptions.length === 1 && legacyUrl) legacyNodes = legacy.nodes;
			for (const legacyNode of legacyNodes) {
				const migratedNode = {
					...legacyNode,
					subscriptionId: subscription.id
				};
				const key = nodeFingerprint(migratedNode);
				if (existingNodeKeys.has(key)) continue;
				next.nodes.push(migratedNode);
				existingNodeKeys.add(key);
				changed = true;
			}
		}
		if (!next.activeNodeId && next.nodes.length > 0) {
			next.activeNodeId = next.nodes[0].id;
			changed = true;
		}
		return {
			state: next,
			changed
		};
	}
};
//#endregion
