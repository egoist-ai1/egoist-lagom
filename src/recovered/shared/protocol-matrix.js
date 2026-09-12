//#region src/shared/protocol-matrix.ts
var CORE_PROTOCOLS = [
	"vless",
	"vmess",
	"trojan",
	"shadowsocks",
	"socks",
	"http",
	"hysteria2",
	"tuic",
	"wireguard"
];
var PROTOCOL_RUNTIME_MATRIX = [
	{
		protocol: "vless",
		preferredRuntime: "xray",
		fallbackRuntime: "sing-box",
		requiresRuntime: null,
		supportsTun: true,
		supportsProcessRules: true,
		degradedRisk: "medium",
		notes: ["Reality and XTLS variants are usually strongest on Xray."]
	},
	{
		protocol: "vmess",
		preferredRuntime: "xray",
		fallbackRuntime: "sing-box",
		requiresRuntime: null,
		supportsTun: true,
		supportsProcessRules: true,
		degradedRisk: "medium",
		notes: ["Legacy VMess remains available through both runtimes."]
	},
	{
		protocol: "trojan",
		preferredRuntime: "xray",
		fallbackRuntime: "sing-box",
		requiresRuntime: null,
		supportsTun: true,
		supportsProcessRules: true,
		degradedRisk: "low",
		notes: ["TLS settings should stay visible when fallback is used."]
	},
	{
		protocol: "shadowsocks",
		preferredRuntime: "xray",
		fallbackRuntime: "sing-box",
		requiresRuntime: null,
		supportsTun: true,
		supportsProcessRules: true,
		degradedRisk: "low",
		notes: ["Plugin metadata can limit runtime compatibility."]
	},
	{
		protocol: "socks",
		preferredRuntime: "xray",
		fallbackRuntime: "sing-box",
		requiresRuntime: null,
		supportsTun: true,
		supportsProcessRules: true,
		degradedRisk: "low",
		notes: ["Simple proxy transport; fallback is mostly a local runtime choice."]
	},
	{
		protocol: "http",
		preferredRuntime: "xray",
		fallbackRuntime: "sing-box",
		requiresRuntime: null,
		supportsTun: true,
		supportsProcessRules: true,
		degradedRisk: "low",
		notes: ["Simple proxy transport; fallback is mostly a local runtime choice."]
	},
	{
		protocol: "hysteria2",
		preferredRuntime: "sing-box",
		fallbackRuntime: null,
		requiresRuntime: "sing-box",
		supportsTun: true,
		supportsProcessRules: true,
		degradedRisk: "high",
		notes: ["Hysteria2 is sing-box-only in this app."]
	},
	{
		protocol: "tuic",
		preferredRuntime: "sing-box",
		fallbackRuntime: null,
		requiresRuntime: "sing-box",
		supportsTun: true,
		supportsProcessRules: true,
		degradedRisk: "high",
		notes: ["TUIC is sing-box-only in this app."]
	},
	{
		protocol: "wireguard",
		preferredRuntime: "sing-box",
		fallbackRuntime: null,
		requiresRuntime: "sing-box",
		supportsTun: true,
		supportsProcessRules: true,
		degradedRisk: "high",
		notes: ["WireGuard is implemented through sing-box endpoint/TUN handling."]
	}
];
function isKnownVpnProtocol(protocol) {
	return CORE_PROTOCOLS.includes(protocol);
}
function getProtocolRuntimeCapability(protocol) {
	const normalized = isKnownVpnProtocol(protocol) ? protocol : "vless";
	return PROTOCOL_RUNTIME_MATRIX.find((item) => item.protocol === normalized) ?? PROTOCOL_RUNTIME_MATRIX[0];
}
function buildProtocolRuntimePlan(input) {
	const capability = getProtocolRuntimeCapability(input.protocol);
	const useTunMode = input.useTunMode === true;
	const processRuleCount = Math.max(0, Math.trunc(input.processRuleCount ?? 0));
	const learnedRuntime = input.learnedRuntimePreference;
	const transportType = String(input.transportType ?? "").trim().toLowerCase();
	const requiresXrayTransport = transportType === "xhttp" || transportType === "splithttp";
	let preferredRuntime = capability.preferredRuntime;
	let reason = "default";
	if (requiresXrayTransport) {
		preferredRuntime = "xray";
		reason = "transport-required";
	} else if (capability.requiresRuntime) {
		preferredRuntime = capability.requiresRuntime;
		reason = "protocol-required";
	} else if (useTunMode) {
		preferredRuntime = "sing-box";
		reason = "tun-required";
	} else if (learnedRuntime) {
		preferredRuntime = learnedRuntime;
		reason = "learned-node-health";
	}
	const fallbackRuntime = requiresXrayTransport || capability.requiresRuntime ? null : preferredRuntime === capability.preferredRuntime ? capability.fallbackRuntime : capability.preferredRuntime;
	const processRulesEffective = useTunMode && processRuleCount > 0;
	const processRulesReason = processRulesEffective ? "Process rules are active because TUN mode is enabled." : processRuleCount > 0 ? "Process rules are configured but only work in TUN mode." : "No process rules are configured.";
	const visibleWarnings = [
		...capability.notes,
		...processRuleCount > 0 && !useTunMode ? [processRulesReason] : [],
		...capability.degradedRisk === "high" ? ["No automatic runtime fallback is available for this protocol."] : []
	];
	return {
		protocol: capability.protocol,
		preferredRuntime,
		fallbackRuntime,
		reason,
		processRulesEffective,
		processRulesReason,
		tunRequired: useTunMode || capability.requiresRuntime === "sing-box",
		visibleWarnings
	};
}
//#endregion
