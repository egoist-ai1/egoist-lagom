var VPN_BACKGROUND_SERVICE_NAME = "EgoistShieldVpn";
var VPN_BACKGROUND_PROXY_PORT = 10838;
var VPN_BACKGROUND_WRAPPER_NAME = "egoistshield-vpn-service.exe";
function validateBackgroundVpnSnapshot(snapshot) {
	const request = { id: "vpn-snapshot", component: "Vpn", method: "installService", args: [snapshot], query: false };
	const value = validateComponentRequest(request).args[0];
	if (Buffer.byteLength(JSON.stringify(request), "utf8") > 60 * 1024) throw new Error("Выбранное подключение и правила превышают лимит фоновой службы. Сократите число правил и повторите установку.");
	if (String(value.settings.runtimePath ?? "").trim()) throw new Error("Фоновая служба использует проверенный встроенный sing-box. Уберите пользовательский путь runtime перед установкой службы.");
	if (value.settings.killSwitch) throw new Error("Фоновый TUN пока не поддерживает отдельный GUI Kill Switch. Отключите эту настройку перед установкой фоновой службы; автоматические TUN-маршруты будут удаляться при остановке runtime.");
	const config = JSON.parse(ConfigBuilder.buildSingBox(value.node, value.domainRules, value.processRules, { ...value.settings, useTunMode: true }, VPN_BACKGROUND_PROXY_PORT));
	config.log = { level: "error", timestamp: true };
	const tun = config.inbounds.find(inbound => inbound.type === "tun");
	if (!tun) throw new Error("ConfigBuilder не создал TUN-конфигурацию фоновой службы.");
	tun.interface_name = "egoist-vpn";
	const content = JSON.stringify(config, null, 2) + "\n";
	if (Buffer.byteLength(content, "utf8") > 256 * 1024) throw new Error("Конфигурация фонового VPN превышает допустимый размер.");
	return { schemaVersion: 1, owner: "EgoistShield", nodeId: value.node.id, nodeName: value.node.name,
		runtimeKind: "sing-box", proxyPort: VPN_BACKGROUND_PROXY_PORT,
		configSha256: createHash("sha256").update(content, "utf8").digest("hex"), config: content };
}
function buildBackgroundVpnWrapperXml(helperPath, logDirectory) {
	const xml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
	return ["<service>", `<id>${VPN_BACKGROUND_SERVICE_NAME}</id>`, "<name>Egoist Lagom VPN</name>",
		"<description>Фоновое TUN-подключение Egoist Lagom</description>", "<startmode>Automatic</startmode>",
		"<delayedAutoStart>false</delayedAutoStart>", "<hidewindow>true</hidewindow>",
		`<executable>${xml(helperPath)}</executable>`, "<arguments>--run-vpn-runtime</arguments>",
		`<workingdirectory>${xml(path.dirname(helperPath))}</workingdirectory>`,
		"<stoptimeout>15 sec</stoptimeout>", "<stopparentprocessfirst>false</stopparentprocessfirst>",
		`<logpath>${xml(logDirectory)}</logpath>`,
		"<log mode=\"roll-by-size\"><sizeThreshold>1024</sizeThreshold><keepFiles>3</keepFiles></log>",
		"<onfailure action=\"restart\" delay=\"5 sec\"/>", "<onfailure action=\"restart\" delay=\"10 sec\"/>",
		"<onfailure action=\"restart\" delay=\"60 sec\"/>", "<resetfailure>1 hour</resetfailure>", "</service>", ""].join("\n");
}
var VpnServiceManager = class {
	constructor(resourcesPath, appPath, userDataDir, protectedComponentRoot, dependencies = {}) {
		this.resourcesPath = path.resolve(resourcesPath); this.appPath = appPath; this.userDataDir = userDataDir;
		this.componentRoot = path.resolve(protectedComponentRoot);
		if (path.basename(this.componentRoot) !== "Vpn" || path.basename(path.dirname(this.componentRoot)) !== "Runtime") throw new Error("Фоновый VPN требует фиксированный защищённый каталог.");
		this.productRoot = path.dirname(path.dirname(this.componentRoot));
		this.stateRoot = path.join(this.productRoot, "Service", "Vpn");
		this.connectionPath = path.join(this.stateRoot, "connection.json");
		this.configPath = path.join(this.componentRoot, "config.json");
		this.wrapperPath = path.join(this.componentRoot, "service-wrapper", VPN_BACKGROUND_WRAPPER_NAME);
		this.helperPath = path.join(this.resourcesPath, "core-service", "win-x64", "EgoistShield.Service.exe");
		this.runtimePath = path.join(this.resourcesPath, "runtime", "sing-box", "sing-box.exe");
		this.command = dependencies.command ?? promisify(execFile);
		this.verifyRuntime = dependencies.verifyRuntime ?? verifyNativeRuntimeForExecution;
		this.checkPrivilege = dependencies.checkPrivilege ?? checkNativeExecutionPrivilege;
		this.clock = dependencies.clock ?? (() => performance.now());
		this.sleep = dependencies.sleep ?? (duration => new Promise(resolve => setTimeout(resolve, duration)));
		this.privateDirectory = dependencies.privateDirectory ?? ((directory, system) => this.protectDirectory(directory, system));
		this.readNativeStatus = dependencies.readNativeStatus ?? (() => this.queryNativeStatus());
		this.queue = Promise.resolve();
	}
	serialize(run) { const result = this.queue.then(run); this.queue = result.catch(() => {}); return result; }
	async authority() {
		if (!await this.checkPrivilege()) throw new Error("Фоновую службу VPN устанавливает защищённый Core, а не обычный процесс приложения.");
		return this.verifyRuntime({ runtimePath: this.runtimePath, runtimeKind: "sing-box", privileged: true, resourcesPath: this.resourcesPath, appRoot: this.resourcesPath });
	}
	async status() {
		try { return await this.readNativeStatus(); }
		catch { return { serviceName: VPN_BACKGROUND_SERVICE_NAME, serviceInstalled: null, serviceState: "unknown", backgroundEnabled: null,
			running: null, activeNodeId: null, proxyPort: VPN_BACKGROUND_PROXY_PORT, socksPort: VPN_BACKGROUND_PROXY_PORT,
			useTunMode: true, routeProtection: "inconclusive", observation: { state: "unknown", at: new Date().toISOString() },
			message: "Не удалось проверить фоновую службу VPN. Действующее подключение сохранено." }; }
	}
	async queryNativeStatus() {
		const result = await this.command(this.helperPath, ["--vpn-service-status"], { windowsHide: true, timeout: 15000, maxBuffer: 32768 });
		const value = JSON.parse(result.stdout.trim());
		if (value?.serviceName !== VPN_BACKGROUND_SERVICE_NAME || !["running", "stopped", "start_pending", "stop_pending", "not-installed", "unknown"].includes(value.serviceState) || ![true, false, null].includes(value.serviceInstalled) || ![true, false, null].includes(value.running)) throw new Error("Некорректный ответ фоновой службы VPN.");
		return value;
	}
	async knownStatus() {
		const status = await this.status({ force: true });
		if (status.serviceInstalled === null || status.serviceState === "unknown" || status.observation?.state === "unknown") throw new Error("Состояние фоновой службы VPN неизвестно. Изменение остановлено до подтверждённой проверки.");
		return status;
	}
	async protectDirectory(directory, system) {
		await promises.mkdir(directory, { recursive: true });
		let current = path.resolve(directory), product = path.resolve(this.productRoot);
		while (current !== product) {
			if ((await promises.lstat(current)).isSymbolicLink()) throw new Error("Защищённый каталог VPN содержит перенаправление.");
			const parent = path.dirname(current); if (parent === current) throw new Error("Каталог VPN вышел за корень продукта."); current = parent;
		}
		const literal = "'" + directory.replace(/'/g, "''") + "'";
		const script = ["$ErrorActionPreference='Stop'", `$vpnRoot=${literal}`, "$vpnItems=@(Get-Item -LiteralPath $vpnRoot -Force -ErrorAction Stop)+@(Get-ChildItem -LiteralPath $vpnRoot -Force -Recurse -ErrorAction Stop)",
			"if($vpnItems.Count -gt 512){throw 'VPN private directory exceeds its bound'}",
			"foreach($vpnItem in $vpnItems){if(($vpnItem.Attributes -band [IO.FileAttributes]::ReparsePoint)-ne 0){throw 'VPN path contains a reparse point'}}",
			"$vpnSystem=New-Object Security.Principal.SecurityIdentifier('S-1-5-18'); $vpnAdmin=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')",
			"foreach($vpnItem in $vpnItems){",
			"$vpnAcl=if($vpnItem.PSIsContainer){New-Object Security.AccessControl.DirectorySecurity}else{New-Object Security.AccessControl.FileSecurity}",
			"$vpnAcl.SetAccessRuleProtection($true,$false); $vpnAcl.SetOwner($vpnSystem)",
			"foreach($vpnSid in @($vpnSystem,$vpnAdmin)){if($vpnItem.PSIsContainer){$vpnRule=New-Object Security.AccessControl.FileSystemAccessRule($vpnSid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{$vpnRule=New-Object Security.AccessControl.FileSystemAccessRule($vpnSid,'FullControl','Allow')}; $vpnAcl.AddAccessRule($vpnRule)}",
			"if($vpnItem.PSIsContainer){[IO.Directory]::SetAccessControl($vpnItem.FullName,$vpnAcl)}else{[IO.File]::SetAccessControl($vpnItem.FullName,$vpnAcl)}",
			"$vpnRead=if($vpnItem.PSIsContainer){[IO.Directory]::GetAccessControl($vpnItem.FullName)}else{[IO.File]::GetAccessControl($vpnItem.FullName)}",
			"if(-not $vpnRead.AreAccessRulesProtected -or $vpnRead.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'VPN private owner/DACL readback failed'}",
			"foreach($vpnRule in $vpnRead.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($vpnRule.AccessControlType -eq 'Allow' -and $vpnRule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'VPN private DACL contains an untrusted allow entry'}}",
			"}", "[Console]::Out.WriteLine('VPN_PRIVATE_ACL_VERIFIED')"].join("; ");
		const result = await this.command(path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
		if (result.stdout.trim() !== "VPN_PRIVATE_ACL_VERIFIED") throw new Error("Не удалось подтвердить закрытые права на конфигурацию VPN.");
	}
	async writeAtomic(file, content) {
		const temporary = path.join(path.dirname(file), ".vpn-" + randomUUID() + ".tmp");
		let handle;
		try { handle = await promises.open(temporary, "wx"); await handle.writeFile(content, "utf8"); await handle.sync(); await handle.close(); handle = null; await promises.rename(temporary, file); }
		finally { await handle?.close().catch(() => {}); await promises.rm(temporary, { force: true }).catch(() => {}); }
	}
	async ensureWrapper(system) {
		const source = path.join(this.resourcesPath, "runtime", "zapret", "service-wrapper", "egoistshield-zapret-service.exe");
		const manifest = JSON.parse(await promises.readFile(path.join(this.resourcesPath, "runtime", "manifest.json"), "utf8"));
		const pins = manifest.components?.filter(component => component.name === "zapret").flatMap(component => component.files ?? []).filter(file => file.path === "zapret/service-wrapper/egoistshield-zapret-service.exe") ?? [];
		if (pins.length !== 1) throw new Error("Проверенный WinSW отсутствует в инвентаре установленного приложения.");
		const bytes = await promises.readFile(source);
		if (bytes.length !== pins[0].size || createHash("sha256").update(bytes).digest("hex") !== pins[0].sha256.toLowerCase()) throw new Error("WinSW не совпадает с проверенным установочным инвентарём.");
		await this.privateDirectory(path.dirname(this.wrapperPath), system);
		await this.writeAtomic(this.wrapperPath, bytes);
		await this.writeAtomic(this.wrapperPath.replace(/\.exe$/i, ".xml"), buildBackgroundVpnWrapperXml(this.helperPath, path.join(this.componentRoot, "logs")));
	}
	async configureAutomatic(system) {
		const commands = [["config", VPN_BACKGROUND_SERVICE_NAME, "start=", "auto", "depend=", "Tcpip/Afd"],
			["failure", VPN_BACKGROUND_SERVICE_NAME, "reset=", "3600", "actions=", "restart/5000/restart/10000/restart/60000"], ["failureflag", VPN_BACKGROUND_SERVICE_NAME, "1"]];
		for (const args of commands) await this.command(path.join(system, "sc.exe"), args, { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
	}
	async stopConfirmed(status, system) {
		if (!status.serviceInstalled) return;
		await this.command(path.join(system, "sc.exe"), ["config", VPN_BACKGROUND_SERVICE_NAME, "start=", "disabled"], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
		if (status.serviceState !== "stopped") {
			try { await this.command(path.join(system, "sc.exe"), ["stop", VPN_BACKGROUND_SERVICE_NAME], { windowsHide: true, timeout: 30000, maxBuffer: 65536 }); }
			catch (error) { if ((await this.knownStatus()).serviceState !== "stopped") throw error; }
		}
		const deadline = this.clock() + 60000;
		do { const current = await this.knownStatus(); if (current.serviceState === "stopped" && current.startType === "disabled" && current.localHealth === "unresponsive") return current;
			if (current.serviceState === "stopped" && ["conflict", "unknown"].includes(current.localHealth)) throw this.unknownOutcome(); await this.sleep(250); } while (this.clock() < deadline);
		throw new Error("Остановка фонового VPN не подтверждена. Новое подключение не запущено.");
	}
	async awaitReady() {
		const deadline = this.clock() + 45000;
		do { const status = await this.knownStatus(); if (status.serviceState === "running" && status.running === true) return status;
			if (status.localHealth === "conflict") throw new Error("Локальный порт фонового VPN занят чужим процессом; автоматическое завершение чужого процесса запрещено.");
			await this.sleep(400);
		} while (this.clock() < deadline);
		throw new Error("Фоновая служба VPN не подтвердила готовность локального прокси. Проверьте выбранный сервер и состояние служб.");
	}
	unknownOutcome() { const error = new Error("Результат изменения фоновой службы VPN не подтверждён. Конфигурация и журнал сохранены; повторный запуск заблокирован до проверки фактического состояния."); error.code = "VPN_SERVICE_ROLLBACK_UNKNOWN"; return error; }
	validationError(error) { const result = new Error(error instanceof Error ? error.message : "Конфигурация фонового VPN не прошла проверку; действующая служба сохранена."); result.code = "VPN_SERVICE_VALIDATION_FAILED"; return result; }
	async restorePreviousService(before, previous, lease) {
		const current = await this.knownStatus();
		await this.stopConfirmed(current, lease.systemDirectory);
		if (!before.serviceInstalled) {
			if (current.serviceInstalled) await this.command(this.wrapperPath, ["uninstall"], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
			const removed = await this.knownStatus(); if (removed.serviceInstalled) throw this.unknownOutcome();
			await promises.rm(this.connectionPath, { force: true }); await promises.rm(this.configPath, { force: true });
			return;
		}
		if (!previous) throw this.unknownOutcome();
		const restored = JSON.parse(previous.toString("utf8"));
		await this.validateConfig(lease, restored.config);
		await this.writeAtomic(this.connectionPath, previous); await this.writeAtomic(this.configPath, restored.config);
		if (!["auto", "demand", "disabled"].includes(before.startType)) throw this.unknownOutcome();
		if (before.startType === "auto") await this.configureAutomatic(lease.systemDirectory);
		else await this.command(path.join(lease.systemDirectory, "sc.exe"), ["config", VPN_BACKGROUND_SERVICE_NAME, "start=", before.startType], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
		if (before.serviceState === "running") { await this.command(this.wrapperPath, ["start"], { windowsHide: true, timeout: 30000, maxBuffer: 65536 }); await this.awaitReady(); }
		else if (before.serviceState !== "stopped" || (await this.knownStatus()).serviceState !== "stopped") throw this.unknownOutcome();
	}
	async validateConfig(lease, content) {
		const validation = path.join(this.componentRoot, ".check-" + randomUUID() + ".json");
		try {
			await this.writeAtomic(validation, content);
			await this.command(lease.runtimePath, ["check", "-c", validation], { windowsHide: true, timeout: 15000, maxBuffer: 65536, cwd: path.dirname(lease.runtimePath), env: runtimeExecutionEnvironment(lease, process.env) });
		} catch { throw new Error("Встроенный sing-box отклонил конфигурацию фонового VPN. Текущая конфигурация сохранена; этот протокол или транспорт нельзя запустить в фоновом режиме."); }
		finally { await promises.rm(validation, { force: true }); }
	}
	installService(snapshot) { return this.serialize(async () => {
		let connection, lease;
		try { connection = validateBackgroundVpnSnapshot(snapshot); lease = await this.authority(); } catch (error) { throw this.validationError(error); }
		try {
			let before, previous;
			try {
				await this.privateDirectory(this.componentRoot, lease.systemDirectory);
				await this.privateDirectory(this.stateRoot, lease.systemDirectory);
				before = await this.knownStatus(); await this.validateConfig(lease, connection.config);
				previous = await promises.readFile(this.connectionPath).catch(error => { if (error.code === "ENOENT") return null; throw error; });
			} catch (error) { throw this.validationError(error); }
			try {
				await this.stopConfirmed(before, lease.systemDirectory);
				await this.ensureWrapper(lease.systemDirectory);
				await this.writeAtomic(this.configPath, connection.config);
				await this.writeAtomic(this.connectionPath, JSON.stringify(connection) + "\n");
				if (!before.serviceInstalled) await this.command(this.wrapperPath, ["install"], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
				await this.configureAutomatic(lease.systemDirectory);
				await this.command(this.wrapperPath, ["start"], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
				return await this.awaitReady();
			} catch (error) {
				try { await this.restorePreviousService(before, previous, lease); } catch { throw this.unknownOutcome(); }
				const rejected = new Error(before.serviceInstalled ? "Новое подключение фонового VPN не запущено. Прежняя конфигурация и подтверждённый режим службы восстановлены." : "Фоновый VPN не запущен. Частично созданная служба удалена; исходное состояние восстановлено."); rejected.code = "VPN_SERVICE_ROLLBACK_VERIFIED"; throw rejected;
			}
		} finally { lease.release(); }
	}); }
	startService() { return this.serialize(async () => {
		let lease; try { lease = await this.authority(); } catch (error) { throw this.validationError(error); }
		try {
			let status, connection;
			try { status = await this.knownStatus(); if (!status.serviceInstalled) throw new Error("Фоновая служба VPN не установлена."); connection = JSON.parse(await promises.readFile(this.connectionPath, "utf8")); await this.validateConfig(lease, connection.config); } catch (error) { throw this.validationError(error); }
			try {
				await this.configureAutomatic(lease.systemDirectory);
				if (status.serviceState !== "running") await this.command(this.wrapperPath, ["start"], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
				return await this.awaitReady();
			} catch {
				try { await this.restorePreviousService(status, Buffer.from(JSON.stringify(connection)), lease); } catch { throw this.unknownOutcome(); }
				const rejected = new Error("Запуск фонового VPN не подтверждён. Прежний подтверждённый режим службы восстановлен."); rejected.code = "VPN_SERVICE_ROLLBACK_VERIFIED"; throw rejected;
			}
		} finally { lease.release(); }
	}); }
	stopService() { return this.serialize(async () => { const lease = await this.authority(); try { const before = await this.knownStatus(); try { return await this.stopConfirmed(before, lease.systemDirectory) ?? await this.knownStatus(); } catch { throw this.unknownOutcome(); } } finally { lease.release(); } }); }
	removeService() { return this.serialize(async () => {
		const lease = await this.authority();
		try {
			const status = await this.knownStatus(); await this.stopConfirmed(status, lease.systemDirectory);
			if (status.serviceInstalled) await this.command(this.wrapperPath, ["uninstall"], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
			const removed = await this.knownStatus(); if (removed.serviceInstalled) throw new Error("Удаление фоновой службы VPN не подтверждено; конфигурация сохранена.");
			await promises.rm(this.connectionPath, { force: true }); await promises.rm(this.configPath, { force: true });
			return removed;
		} finally { lease.release(); }
	}); }
};
