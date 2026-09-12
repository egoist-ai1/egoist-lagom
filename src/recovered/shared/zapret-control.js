//#region src/shared/zapret-control.ts
var ZAPRET_CONFLICT_MATRIX = [
	{
		id: "adguard-wfp",
		label: "AdGuard",
		patterns: ["adguard", "adguardsvc"],
		severity: "warn",
		reason: "AdGuard can already own filtering, DNS, HTTPS filtering, or WFP hooks."
	},
	{
		id: "goodbyedpi",
		label: "GoodbyeDPI",
		patterns: ["goodbyedpi", "windivert"],
		severity: "block",
		reason: "GoodbyeDPI and Zapret both rely on packet interception and can fight over WinDivert."
	},
	{
		id: "cloudflare-warp",
		label: "Cloudflare WARP",
		patterns: ["warp", "cloudflare warp"],
		severity: "warn",
		reason: "WARP can own routing, DNS, and Wintun adapters."
	},
	{
		id: "wireguard-wintun",
		label: "WireGuard / Wintun",
		patterns: ["wireguard", "wintun"],
		severity: "warn",
		reason: "WireGuard/Wintun adapters can overlap with VPN TUN routing."
	},
	{
		id: "npcap",
		label: "Npcap",
		patterns: ["npcap", "packet capture"],
		severity: "info",
		reason: "Npcap is usually passive, but packet capture drivers should be visible in diagnostics."
	},
	{
		id: "external-zapret",
		label: "External Zapret / winws",
		patterns: [
			"zapret",
			"zapret_discord",
			"winws"
		],
		severity: "block",
		reason: "A second Zapret/winws instance can duplicate filters and break cleanup ownership."
	}
];
function findZapretConflicts(items) {
	const conflicts = [];
	for (const item of items) {
		const haystack = `${item.name} ${item.path ?? ""}`.toLowerCase();
		for (const rule of ZAPRET_CONFLICT_MATRIX) if (rule.patterns.some((pattern) => haystack.includes(pattern.toLowerCase()))) conflicts.push({
			ruleId: rule.id,
			label: rule.label,
			severity: rule.severity,
			item,
			reason: rule.reason
		});
	}
	return conflicts;
}
function buildZapretSuspensionState(mode, profile) {
	return {
		active: mode !== "none",
		mode,
		profile,
		visibleLabel: mode === "none" ? "Zapret active policy normal" : `Zapret suspended by VPN (${mode}${profile ? `: ${profile}` : ""})`
	};
}
function buildZapretRecoveryPlan(input) {
	const actions = [];
	if (input.suspendedByVpn && !input.serviceRunning && !input.standaloneRunning) actions.push("restore-suspended-zapret-profile");
	if ((input.staleIntegratedProcesses ?? 0) > 0) actions.push("stop-stale-owned-winws-processes");
	if (input.serviceInstalled && !input.serviceRunning && input.suspendedByVpn) actions.push("repair-owned-service-after-reboot");
	return {
		required: actions.length > 0,
		actions,
		reason: actions.length > 0 ? "Zapret state needs post-crash or post-VPN recovery." : null
	};
}
function buildZapretDryRunProfile(profileName, args) {
	return {
		profileName,
		commandPreview: `winws.exe ${args.trim()}`.trim(),
		mutatesSystem: false,
		requiresAdmin: false
	};
}
var package_default = {
	name: "egoistshield-desktop-electron",
	version: "1.0.0",
	recoveredFrom: "../recovered/analysis/asar-package.json"
};
//#endregion
