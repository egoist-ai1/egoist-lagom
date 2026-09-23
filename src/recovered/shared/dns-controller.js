//#region src/shared/dns-controller.ts
var MUTATING_MODES = /* @__PURE__ */ new Set([
	"manual-dns",
	"native-windows-encrypted-dns",
	"system-doh",
	"gravityless-dns"
]);
var PORT_53_MODES = /* @__PURE__ */ new Set(["gravityless-dns"]);
var MODE_TITLES = {
	"system-default": "System default DNS",
	"manual-dns": "Manual DNS",
	"native-windows-encrypted-dns": "Windows encrypted DNS",
	"system-doh": "System DoH",
	"gravityless-dns": "Gravityless DNS"
};
function buildDnsControllerState(input) {
	const adapterExclusionReport = buildAdapterExclusionReport(input.adapters ?? []);
	const mutatesSystem = MUTATING_MODES.has(input.mode);
	const port53CheckRequired = PORT_53_MODES.has(input.mode);
	const rollbackSnapshotRequired = mutatesSystem;
	const rollbackSnapshotReady = !rollbackSnapshotRequired || input.hasRollbackSnapshot === true;
	const port53Available = port53CheckRequired ? input.port53?.available ?? null : null;
	const leakStatus = input.leakStatus ?? {
		checked: false,
		leaking: null,
		resolverIp: null,
		vpnIp: null,
		message: "DNS leak status has not been checked yet."
	};
	const visibleReasons = [];
	if (rollbackSnapshotRequired && !rollbackSnapshotReady) visibleReasons.push("DNS mutation is blocked until a rollback snapshot is captured.");
	if (port53CheckRequired && port53Available === false) visibleReasons.push(`Port 53 is already used by ${input.port53?.owner ?? "another local service"}.`);
	if (adapterExclusionReport.excluded.length > 0) visibleReasons.push("VPN and tunnel adapters are excluded from system DNS mutation.");
	if (leakStatus.checked && leakStatus.leaking === true) visibleReasons.push("DNS leak test indicates resolver mismatch.");
	const blocked = visibleReasons.some((reason) => reason.includes("blocked") || reason.includes("Port 53"));
	const warning = leakStatus.checked && leakStatus.leaking === true;
	const severity = blocked ? "blocked" : warning ? "warn" : "ok";
	return {
		mode: input.mode,
		title: MODE_TITLES[input.mode],
		severity,
		requiresAdmin: mutatesSystem,
		mutatesSystem,
		rollbackSnapshotRequired,
		rollbackSnapshotReady,
		port53CheckRequired,
		port53Available,
		adapterReportRequired: mutatesSystem,
		adapterExclusionReport,
		dnsLeakStatus: leakStatus,
		visibleReasons
	};
}
function buildAdapterExclusionReport(adapters) {
	const included = [];
	const excluded = [];
	for (const adapter of adapters) {
		const haystack = `${adapter.name} ${adapter.description ?? ""} ${adapter.type ?? ""}`.toLowerCase();
		if (/wireguard|wintun|cloudflare\s+warp|vpn|loopback|isatap|teredo|pseudo|npcap|bluetooth|(^|[\s_-])(tap|tun)([\s_-]|$)/.test(haystack)) {
			excluded.push({
				...adapter,
				reason: "vpn-or-tunnel-adapter"
			});
			continue;
		}
		if (adapter.status && !/^up|connected$/i.test(adapter.status)) {
			excluded.push({
				...adapter,
				reason: "adapter-not-up"
			});
			continue;
		}
		included.push(adapter);
	}
	return {
		included,
		excluded
	};
}
/** Replaced with the actual date when scripts/build.mjs creates the release. */
var EGOIST_SHIELD_BUILD_DATE = "__EGOIST_BUILD_DATE__";
function buildNetworkCombinatorInspection(input) {
	const modules = input.modules.map((module) => ({
		id: module.id,
		status: module.status,
		health: module.health,
		ownedLocks: [...module.ownedLocks ?? []],
		activeMutations: [...module.activeMutations ?? []],
		rollbackReady: module.rollbackReady ?? false,
		blockers: [...module.blockers ?? []],
		sidecar: module.sidecar ?? false
	}));
	return {
		productVersion: input.productVersion ?? "3.5.4",
		mode: "diagnostics-first",
		modules,
		activeLocks: unique(modules.flatMap((module) => module.ownedLocks)),
		activeMutations: unique(modules.flatMap((module) => module.activeMutations)),
		admin: {
			...input.admin,
			canApplyMutations: input.admin.isElevated
		}
	};
}
function buildNetworkCombinatorPlan(inspection, intent) {
	const blockers = intent.conflictsWith.filter((lock) => inspection.activeLocks.includes(lock)).map((lock) => ({
		code: "lock-conflict",
		message: `Requested action conflicts with active ${lock} ownership.`
	}));
	const module = inspection.modules.find((item) => item.id === intent.module);
	if (intent.rollbackRequired && module && module.rollbackReady === false && intent.module === "dns") blockers.push({
		code: "rollback-required",
		message: "DNS mutation requires a rollback snapshot before apply."
	});
	const approvalRequired = intent.mutatesSystem;
	if (approvalRequired && !inspection.admin.canApplyMutations) blockers.push({
		code: "elevation-required",
		message: "System mutation requires an elevated Egoist Lagom process."
	});
	const status = blockers.some((blocker) => blocker.code === "lock-conflict" || blocker.code === "rollback-required") ? "blocked" : "ready";
	const operation = {
		id: `${intent.module}:${intent.action}:0`,
		module: intent.module,
		action: intent.action,
		risk: intent.mutatesSystem ? "requires-admin" : "read-only",
		requiredLocks: [...intent.requiredLocks],
		rollbackRequired: intent.rollbackRequired,
		approved: false,
		summary: intent.summary
	};
	return {
		planId: `${intent.module}:${intent.action}`,
		module: intent.module,
		action: intent.action,
		status,
		summary: intent.summary,
		blockers,
		operations: [operation],
		approval: {
			required: approvalRequired,
			state: approvalRequired ? "required" : "not-required",
			reason: approvalRequired ? "Plan mutates Windows network/service state." : "Read-only diagnostics do not require approval."
		}
	};
}
function approveNetworkCombinatorPlan(plan) {
	if (plan.status === "blocked") return {
		...plan,
		approval: {
			...plan.approval,
			state: "denied",
			reason: "Blocked plans cannot be approved."
		}
	};
	return {
		...plan,
		operations: plan.operations.map((operation) => ({
			...operation,
			approved: true
		})),
		approval: {
			...plan.approval,
			state: plan.approval.required ? "granted" : "not-required"
		}
	};
}
function buildNetworkVerificationReport(input) {
	const hasFailure = input.checks.some((check) => check.status === "failed");
	const hasPass = input.checks.some((check) => check.status === "passed");
	return {
		planId: input.plan.planId,
		overall: hasFailure ? "failed" : hasPass ? "passed" : "skipped",
		checks: input.checks.map((check) => ({ ...check }))
	};
}
function unique(values) {
	return [...new Set(values)];
}
//#endregion
