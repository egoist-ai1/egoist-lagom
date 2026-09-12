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
	if (!value || typeof value !== "object") throw new Error("Network plan intent must be an object.");
	const input = value;
	return {
		module: parseModuleId(input.module),
		action: parseNonEmptyString(input.action, "action"),
		summary: parseNonEmptyString(input.summary, "summary"),
		mutatesSystem: input.mutatesSystem === true,
		requiredLocks: parseLocks(input.requiredLocks),
		conflictsWith: parseLocks(input.conflictsWith),
		rollbackRequired: input.rollbackRequired === true
	};
}
function parsePlanId(value) {
	return parseNonEmptyString(value, "planId");
}
function parseModuleId(value) {
	const text = parseNonEmptyString(value, "module");
	if (!MODULE_IDS.has(text)) throw new Error(`Unknown network module: ${text}`);
	return text;
}
function parseLocks(value) {
	if (value === void 0) return [];
	if (!Array.isArray(value)) throw new Error("Network locks must be an array.");
	return value.map((item) => {
		const text = parseNonEmptyString(item, "lock");
		if (!LOCK_IDS.has(text)) throw new Error(`Unknown network lock: ${text}`);
		return text;
	});
}
function parseNonEmptyString(value, fieldName) {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Network ${fieldName} must be a non-empty string.`);
	return value.trim();
}
//#endregion
