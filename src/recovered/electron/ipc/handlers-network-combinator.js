//#region src/electron/ipc/handlers-network-combinator.ts
var MODULE_IDS = /* @__PURE__ */ new Set([
	"vpn",
	"dns",
	"zapret",
	"telegram-proxy",
	"system-proxy",
	"firewall",
	"updates"
]);
var LOCK_IDS = /* @__PURE__ */ new Set([
	"traffic-route",
	"dns",
	"dns-verify",
	"system-proxy",
	"firewall-kill-switch",
	"packet-interception",
	"windivert",
	"zapret-suspend",
	"telegram-proxy-port",
	"updates"
]);
function registerNetworkCombinatorHandlers(networkCombinatorManager) {
	ipcMain.handle("network:inspect", async () => networkCombinatorManager.inspect());
	ipcMain.handle("network:plan", async (_event, rawIntent) => networkCombinatorManager.plan(parseNetworkPlanIntent(rawIntent)));
	ipcMain.handle("network:approve", (_event, rawPlanId) => networkCombinatorManager.approve(parsePlanId(rawPlanId)));
	ipcMain.handle("network:apply", (_event, rawPlanId) => networkCombinatorManager.apply(parsePlanId(rawPlanId)));
	ipcMain.handle("network:rollback", (_event, rawPlanId) => networkCombinatorManager.rollback(parsePlanId(rawPlanId)));
	ipcMain.handle("network:verify", (_event, rawPlanId) => networkCombinatorManager.verify(parsePlanId(rawPlanId)));
	ipcMain.handle("network:diagnose", async () => networkCombinatorManager.diagnose());
}
function parseNetworkPlanIntent(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Network plan intent must be an object.");
	const input = value;
	const fields = new Set(["module", "action", "summary", "mutatesSystem", "requiredLocks", "conflictsWith", "rollbackRequired"]);
	if (Object.keys(input).some(key => !fields.has(key))) throw new Error("Unknown network plan field.");
	for (const name of ["mutatesSystem", "rollbackRequired"]) {
		if (input[name] !== void 0 && typeof input[name] !== "boolean") throw new Error(`Network ${name} must be a boolean.`);
	}
	return {
		module: parseModuleId(input.module),
		action: parseNonEmptyString(input.action, "action", 64),
		summary: parseNonEmptyString(input.summary, "summary", 1024),
		mutatesSystem: input.mutatesSystem === true,
		requiredLocks: parseLocks(input.requiredLocks),
		conflictsWith: parseLocks(input.conflictsWith),
		rollbackRequired: input.rollbackRequired === true
	};
}
function parsePlanId(value) {
	return parseNonEmptyString(value, "planId", 160);
}
function parseModuleId(value) {
	const text = parseNonEmptyString(value, "module");
	if (!MODULE_IDS.has(text)) throw new Error(`Unknown network module: ${text}`);
	return text;
}
function parseLocks(value) {
	if (value === void 0) return [];
	if (!Array.isArray(value) || value.length > LOCK_IDS.size || new Set(value).size !== value.length) throw new Error("Network locks must be a bounded array of distinct locks.");
	return value.map((item) => {
		const text = parseNonEmptyString(item, "lock");
		if (!LOCK_IDS.has(text)) throw new Error(`Unknown network lock: ${text}`);
		return text;
	});
}
function parseNonEmptyString(value, fieldName, maximum = 128) {
	if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Network ${fieldName} must be a bounded non-empty string.`);
	return value.trim();
}
//#endregion
