//#region src/electron/ipc/kill-switch.ts
/**
* Kill Switch — блокировка всего исходящего трафика через Windows Firewall
* при разрыве VPN-соединения. Требует прав администратора.
*/
var execFileAsync$12 = promisify(execFile);
var RULE_PREFIX = "EgoistShield-KS";
var KillSwitch = class {
	active = false;
	/**
	* Включить Kill Switch: блокировать весь трафик кроме localhost и runtime
	*/
	async enable(_proxyPort, runtimePath) {
		if (process.platform !== "win32") return;
		if (this.active) return;
		try {
			await this.disable();
			await execFileAsync$12(resolveWindowsExecutable("netsh"), [
				"advfirewall",
				"firewall",
				"add",
				"rule",
				`name=${RULE_PREFIX}-Block`,
				"dir=out",
				"action=block",
				"enable=yes",
				"profile=any",
				"localip=any",
				"remoteip=any"
			]);
			await execFileAsync$12(resolveWindowsExecutable("netsh"), [
				"advfirewall",
				"firewall",
				"add",
				"rule",
				`name=${RULE_PREFIX}-AllowLoopback`,
				"dir=out",
				"action=allow",
				"enable=yes",
				"remoteip=127.0.0.0/8"
			]);
			await execFileAsync$12(resolveWindowsExecutable("netsh"), [
				"advfirewall",
				"firewall",
				"add",
				"rule",
				`name=${RULE_PREFIX}-AllowRuntime`,
				"dir=out",
				"action=allow",
				"enable=yes",
				`program=${runtimePath}`
			]);
			await execFileAsync$12(resolveWindowsExecutable("netsh"), [
				"advfirewall",
				"firewall",
				"add",
				"rule",
				`name=${RULE_PREFIX}-AllowDNS`,
				"dir=out",
				"action=allow",
				"enable=yes",
				"protocol=udp",
				"remoteport=53",
				`remoteip=1.1.1.1,8.8.8.8,8.8.4.4,1.0.0.1`
			]);
			await execFileAsync$12(resolveWindowsExecutable("netsh"), [
				"advfirewall",
				"firewall",
				"add",
				"rule",
				`name=${RULE_PREFIX}-AllowDHCP`,
				"dir=out",
				"action=allow",
				"enable=yes",
				"protocol=udp",
				"localport=68",
				"remoteport=67"
			]);
			this.active = true;
		} catch (err) {
			await this.disable().catch(() => {});
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`Kill Switch enable failed: ${msg}`);
		}
	}
	/**
	* Выключить Kill Switch: удалить все правила firewall
	*/
	async disable() {
		if (process.platform !== "win32") return;
		const ruleNames = [
			`${RULE_PREFIX}-Block`,
			`${RULE_PREFIX}-AllowLoopback`,
			`${RULE_PREFIX}-AllowRuntime`,
			`${RULE_PREFIX}-AllowDNS`,
			`${RULE_PREFIX}-AllowDHCP`
		];
		for (const name of ruleNames) try {
			await execFileAsync$12(resolveWindowsExecutable("netsh"), [
				"advfirewall",
				"firewall",
				"delete",
				"rule",
				`name=${name}`
			]);
		} catch {}
		this.active = false;
	}
	isActive() {
		return this.active;
	}
};
//#endregion
