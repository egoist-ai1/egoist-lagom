//#region src/electron/ipc/state-store.ts
var DEFAULT_STATE = {
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
	const sanitizedNodes = (state.nodes ?? []).map((node) => {
		if (typeof node.server === "string" && /\.cloudpath\.live$/i.test(node.server)) {
			const server = node.server.replace(/(^|\.)cloudpath\.live$/i, "$1claudpath.com");
			const uri = typeof node.uri === "string" ? node.uri.replace(/(^|@|\.)cloudpath\.live/gi, "$1claudpath.com") : node.uri;
			return { ...node, server, uri };
		}
		return node;
	});
	return normalizePersistedDisplayText({
		...state,
		nodes: sanitizedNodes,
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
	/** Очередь сериализации записи на диск. */
	saveQueue = Promise.resolve();
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
	async load() {
		try {
			this.state = await this.readStateFile(this.filePath);
		} catch (primaryError) {
			try {
				this.state = await this.readStateFile(this.backupPath);
				logger.warn("[state-store] Primary state is unreadable; recovered from backup.", primaryError);
				await this.save();
			} catch (backupError) {
				this.state = structuredClone(DEFAULT_STATE);
				const primaryMissing = primaryError?.code === "ENOENT";
				const backupMissing = backupError?.code === "ENOENT";
				if (primaryMissing && backupMissing) {
					logger.info("[state-store] Initializing a new state profile.");
					await this.save();
				} else logger.warn("[state-store] State is unreadable; falling back to defaults.", {
					primaryError,
					backupError
				});
			}
		}
		const displayStateBeforeSanitize = JSON.stringify({
			nodes: this.state.nodes,
			subscriptions: this.state.subscriptions
		});
		this.state = sanitizeState(this.state);
		const displayTextChanged = displayStateBeforeSanitize !== JSON.stringify({
			nodes: this.state.nodes,
			subscriptions: this.state.subscriptions
		});
		const migration = await this.migrateLegacyState(this.state);
		if (migration.changed) this.state = sanitizeState(migration.state);
		if (migration.changed || displayTextChanged) {
			await this.save();
			logger.info(migration.changed ? "[state-store] Migrated legacy EgoistShield VPN subscriptions/nodes into current state." : "[state-store] Repaired persisted display text encoding.");
		}
		await this.applyInstallationDefaults();
		return this.get();
	}
	async applyInstallationDefaults() {
		if (!this.installationPath) return;
		const installation = JSON.parse(await promises.readFile(this.installationPath, "utf8"));
		if (typeof installation.id !== "string" || !/^[a-f0-9-]{36}$/i.test(installation.id)) throw new Error("Invalid installation identity.");
		let previous;
		try { previous = JSON.parse(await promises.readFile(this.activationMarkerPath, "utf8")); } catch { previous = null; }
		if (previous?.id === installation.id) return;
		this.state.settings = { ...this.state.settings, autoStart: false, autoConnect: false, systemDohEnabled: false, systemDnsServers: "", systemDohUrl: "https://cloudflare-dns.com/dns-query", systemDohLocalAddress: "", customDnsUrl: "", useTunMode: false, killSwitch: false };
		await this.save();
		await promises.writeFile(this.activationMarkerPath, JSON.stringify({ id: installation.id }), "utf8");
	}
	get() {
		return structuredClone(this.state);
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
	* Дополнительно все мутации проходят через единую очередь: параллельный
	* полный `set` больше не может затереть изменение, сделанное между чтением
	* и записью (lost update).
	*/
	async set(next) {
		return this.runMutation(() => sanitizeState(structuredClone(next)));
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
	async patchSettings(settings, expectedRevision) {
		const conflict = new Error("Settings revision conflict");
		try {
			const state = await this.runMutation((current) => {
				if (expectedRevision !== void 0 && expectedRevision !== this.revision) throw conflict;
				return sanitizeState({
				...current,
				settings: {
					...current.settings,
					...settings
				}
				});
			});
			return {
				ok: true,
				conflict: false,
				revision: this.revision,
				state
			};
		} catch (error) {
			if (error === conflict) return {
				ok: false,
				conflict: true,
				revision: this.revision,
				state: this.get()
			};
			logger.error("[state-store] settings patch failed; in-memory state kept unchanged:", error);
			return {
				ok: false,
				conflict: false,
				revision: this.revision,
				state: this.get()
			};
		}
	}
	/**
	* Единственный путь мутации: очередь + запись до публикации в памяти.
	*
	* Очередь исключает lost update между параллельными вызовами, а порядок
	* «сериализовать -> записать -> опубликовать» гарантирует, что память и диск
	* не разъезжаются при ошибке записи.
	*/
	async runMutation(mutate) {
		const run = this.mutationQueue.then(() => this.commitMutation(mutate), () => this.commitMutation(mutate));
		this.mutationQueue = run.then(() => void 0, () => void 0);
		await run;
		return this.get();
	}
	async commitMutation(mutate) {
		const previous = this.state;
		const next = mutate(structuredClone(this.state));
		const serialized = JSON.stringify(next, null, 2);
		try {
			await this.writeStateFile(serialized);
		} catch (error) {
			this.state = previous;
			throw error;
		}
		this.state = next;
		this.revision += 1;
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
	/**
	* Сериализация записи: конкурирующие save() выстраиваются в очередь.
	* Без неё два вызова в одну миллисекунду получали одинаковый временный путь
	* (pid + Date.now()), и второй rename падал с ENOENT — запись терялась.
	*/
	async save() {
		const serialized = JSON.stringify(this.state, null, 2);
		const run = this.saveQueue.then(() => this.writeStateFile(serialized), () => this.writeStateFile(serialized));
		this.saveQueue = run.catch(() => void 0);
		await run;
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
	async writeStateFile(serialized) {
		const dir = path.dirname(this.filePath);
		const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
		await promises.mkdir(dir, { recursive: true });
		try {
			// Do not replace a good recovery copy with the unreadable primary.
			await this.readStateFile(this.filePath);
			await promises.copyFile(this.filePath, this.backupPath);
		} catch {}
		try {
			const handle = await promises.open(tempPath, "w");
			try {
				await handle.writeFile(serialized, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			await promises.rename(tempPath, this.filePath);
			const dirHandle = await promises.open(dir, "r").catch(() => null);
			if (dirHandle) {
				await dirHandle.sync().catch(() => void 0);
				await dirHandle.close().catch(() => void 0);
			}
		} catch (error) {
			await promises.rm(tempPath, { force: true }).catch(() => void 0);
			throw error;
		}
	}
	async readStateFile(filePath) {
		const raw = (await promises.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid saved state object");
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
	async readLegacyState() {
		const currentDir = path.resolve(path.dirname(this.filePath));
		const legacyPath = path.join(path.dirname(currentDir), "EgoistShield", "egoistshield-state.json");
		if (path.resolve(legacyPath).toLowerCase() === path.resolve(this.filePath).toLowerCase()) return null;
		try {
			return sanitizeState(await this.readStateFile(legacyPath));
		} catch {
			return null;
		}
	}
	async migrateLegacyState(current) {
		const legacy = await this.readLegacyState();
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
