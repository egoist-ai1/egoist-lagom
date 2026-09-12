//#region src/electron/ipc/config-builder.ts
var ConfigBuilder;
(function(_ConfigBuilder) {
	function buildXray(node, domainRules, settings, httpPort, socksPort, apiPort, processRules = []) {
		const outbound = buildOutbound(node);
		const outboundStreamSettings = typeof outbound.streamSettings === "object" && outbound.streamSettings !== null ? outbound.streamSettings : null;
		const rules = buildRules(domainRules);
		const xrayProcessRules = settings.useTunMode ? buildXrayProcessRules(processRules) : [];
		const config = {
			log: { loglevel: "warning" },
			stats: {},
			api: {
				tag: "api",
				services: ["StatsService"]
			},
			policy: {
				levels: { "0": {
					statsUserUplink: true,
					statsUserDownlink: true
				} },
				system: {
					statsInboundUplink: true,
					statsInboundDownlink: true,
					statsOutboundUplink: true,
					statsOutboundDownlink: true
				}
			},
			inbounds: [
				{
					tag: "socks-in",
					port: socksPort,
					listen: "127.0.0.1",
					protocol: "socks",
					settings: { udp: true },
					sniffing: {
						enabled: true,
						destOverride: ["http", "tls"]
					},
					streamSettings: { sockopt: {
						tcpFastOpen: true,
						tcpNoDelay: true
					} }
				},
				{
					tag: "http-in",
					port: httpPort,
					listen: "127.0.0.1",
					protocol: "http",
					sniffing: {
						enabled: true,
						destOverride: ["http", "tls"]
					},
					streamSettings: { sockopt: {
						tcpFastOpen: true,
						tcpNoDelay: true
					} }
				},
				{
					listen: "127.0.0.1",
					port: apiPort,
					protocol: "dokodemo-door",
					settings: { address: "127.0.0.1" },
					tag: "api"
				}
			],
			outbounds: [
				{
					...outbound,
					tag: "proxy",
					streamSettings: outboundStreamSettings ? {
						...outboundStreamSettings,
						sockopt: {
							tcpFastOpen: true,
							tcpNoDelay: true
						}
					} : void 0
				},
				{
					tag: "direct",
					protocol: "freedom",
					settings: {}
				},
				{
					tag: "block",
					protocol: "blackhole",
					settings: {}
				}
			],
			routing: {
				domainStrategy: settings.dnsMode === "secure" || settings.dnsMode === "custom" ? "IPOnDemand" : "AsIs",
				rules: [
					{
						inboundTag: ["api"],
						outboundTag: "api",
						type: "field"
					},
					...xrayProcessRules,
					...rules,
					{
						type: "field",
						outboundTag: "direct",
						ip: ["geoip:private", "geoip:cn"]
					},
					{
						type: "field",
						outboundTag: "direct",
						domain: ["geosite:cn"]
					},
					buildDefaultXrayRule(settings.routeMode)
				]
			},
			dns: buildDns(settings.dnsMode, settings.customDnsUrl)
		};
		if (settings.useTunMode) config.inbounds.push({
			tag: "tun-in",
			protocol: "tun",
			settings: {
				name: "egoist-tun",
				mtu: 1500,
				gateway: ["172.19.0.1/30", "fd00:198:18::1/126"],
				dns: ["1.1.1.1"],
				autoSystemRoutingTable: ["0.0.0.0/0", "::/0"],
				autoOutboundsInterface: "auto"
			},
			sniffing: {
				enabled: true,
				destOverride: ["http", "tls", "quic"],
				routeOnly: true
			}
		});
		return JSON.stringify(config, null, 2);
	}
	_ConfigBuilder.buildXray = buildXray;
	function buildSingBox(node, domainRules, processRules, settings, mixedPort) {
		const proxyTag = node.protocol === "wireguard" ? "wg-ep" : "proxy";
		const outbound = node.protocol === "wireguard" ? null : buildSingBoxOutbound(node);
		const userRules = buildSingBoxRules(domainRules, processRules, settings.useTunMode, proxyTag);
		const config = {
			log: {
				level: "info",
				timestamp: true
			},
			dns: buildSingBoxDns(settings.dnsMode, settings.customDnsUrl, proxyTag),
			inbounds: [{
				type: "mixed",
				tag: "mixed-in",
				listen: "127.0.0.1",
				listen_port: mixedPort
			}],
			outbounds: [...outbound ? [{
				...outbound,
				tag: "proxy",
				domain_resolver: {
					server: "bootstrap-dns",
					strategy: "prefer_ipv4"
				}
			}] : [], {
				type: "direct",
				tag: "direct"
			}],
			route: {
				rules: [
					{ action: "sniff" },
					{
						protocol: "dns",
						action: "hijack-dns"
					},
					...userRules,
					{
						ip_is_private: true,
						outbound: "direct"
					}
				],
				final: settings.routeMode === "global" ? proxyTag : "direct",
				auto_detect_interface: true,
				default_domain_resolver: {
					server: "bootstrap-dns",
					strategy: "prefer_ipv4"
				}
			}
		};
		if (node.protocol === "wireguard") config.endpoints = [buildSingBoxWireguardEndpoint(node)];
		if (settings.useTunMode) config.inbounds.push({
			type: "tun",
			tag: "tun-in",
			interface_name: "egoist-tun",
			address: ["172.19.0.1/30"],
			auto_route: true,
			strict_route: true,
			stack: "system"
		});
		return JSON.stringify(config, null, 2);
	}
	_ConfigBuilder.buildSingBox = buildSingBox;
	function normalizeNodeServer(server) {
		return (server || '').replace(/(^|\.)cloudpath\.live$/i, '$1claudpath.com');
	}
	function buildOutbound(node) {
		const m = node.metadata ?? {};
		const profile = getProtocolProfile(node);
		const serverAddress = normalizeNodeServer(node.server);
		if (node.protocol === "vless") return {
			protocol: "vless",
			settings: { vnext: [{
				address: serverAddress,
				port: node.port,
				users: [{
					id: m.id ?? "",
					encryption: "none",
					flow: m.flow || void 0
				}]
			}] },
			streamSettings: {
				network: m.type ?? "tcp",
				security: m.security ?? "none",
				tlsSettings: m.security === "tls" ? {
					serverName: m.sni ? normalizeNodeServer(m.sni) : serverAddress,
					fingerprint: m.fp ?? "chrome",
					alpn: profile.xrayTlsAlpn
				} : void 0,
				realitySettings: m.security === "reality" ? {
					serverName: m.sni ? normalizeNodeServer(m.sni) : serverAddress,
					fingerprint: m.fp ?? "chrome",
					publicKey: m.pbk ?? "",
					shortId: m.sid ?? "",
					spiderX: m.spx ?? "/"
				} : void 0,
				wsSettings: m.type === "ws" ? {
					path: m.path ?? "/",
					headers: m.host ? { Host: m.host } : void 0
				} : void 0,
				grpcSettings: m.type === "grpc" ? { serviceName: m.serviceName ?? "" } : void 0,
				httpSettings: m.type === "h2" ? {
					path: m.path ?? "/",
					host: m.host ? [m.host] : void 0
				} : void 0,
				xhttpSettings: m.type === "xhttp" || m.type === "splithttp" ? {
					path: m.path ?? "/",
					host: m.host ?? "",
					mode: m.mode ?? "auto"
				} : void 0
			}
		};
		if (node.protocol === "vmess") return {
			protocol: "vmess",
			settings: { vnext: [{
				address: node.server,
				port: node.port,
				users: [{
					id: m.id ?? "",
					alterId: Number(m.aid ?? "0"),
					security: m.scy ?? "auto"
				}]
			}] },
			streamSettings: {
				network: m.net ?? "tcp",
				security: m.tls === "tls" ? "tls" : "none",
				tlsSettings: m.tls === "tls" ? {
					serverName: m.sni ?? node.server,
					alpn: profile.xrayTlsAlpn
				} : void 0,
				wsSettings: m.net === "ws" ? {
					path: m.path ?? "/",
					headers: m.host ? { Host: m.host } : void 0
				} : void 0,
				grpcSettings: m.net === "grpc" ? { serviceName: m.serviceName ?? "" } : void 0,
				xhttpSettings: m.net === "xhttp" || m.net === "splithttp" ? {
					path: m.path ?? "/",
					host: m.host ?? "",
					mode: m.mode ?? "auto"
				} : void 0
			}
		};
		if (node.protocol === "trojan") return {
			protocol: "trojan",
			settings: { servers: [{
				address: node.server,
				port: node.port,
				password: m.password ?? ""
			}] },
			streamSettings: {
				network: m.type ?? "tcp",
				security: "tls",
				tlsSettings: {
					serverName: m.sni ?? node.server,
					alpn: profile.xrayTlsAlpn
				},
				wsSettings: m.type === "ws" ? {
					path: m.path ?? "/",
					headers: m.host ? { Host: m.host } : void 0
				} : void 0,
				grpcSettings: m.type === "grpc" ? { serviceName: m.serviceName ?? "" } : void 0,
				xhttpSettings: m.type === "xhttp" || m.type === "splithttp" ? {
					path: m.path ?? "/",
					host: m.host ?? "",
					mode: m.mode ?? "auto"
				} : void 0
			}
		};
		if (node.protocol === "shadowsocks") return {
			protocol: "shadowsocks",
			settings: { servers: [{
				address: node.server,
				port: node.port,
				method: m.method ?? "aes-128-gcm",
				password: m.password ?? ""
			}] }
		};
		if (node.protocol === "socks") return {
			protocol: "socks",
			settings: { servers: [{
				address: node.server,
				port: node.port,
				users: m.username || m.password ? [{
					user: m.username ?? "",
					pass: m.password ?? ""
				}] : void 0
			}] }
		};
		if (node.protocol === "http") return {
			protocol: "http",
			streamSettings: parseBool(m.tls) || m.security === "tls" ? {
				security: "tls",
				tlsSettings: { serverName: m.sni ?? node.server }
			} : void 0,
			settings: { servers: [{
				address: node.server,
				port: node.port,
				users: m.username || m.password ? [{
					user: m.username ?? "",
					pass: m.password ?? ""
				}] : void 0
			}] }
		};
		return {
			protocol: "freedom",
			settings: {}
		};
	}
	function parseNumber(value, fallback) {
		if (!value) return fallback;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	function parseBool(value) {
		if (value === true) return true;
		if (value === false || value === null || value === void 0) return false;
		return value ? [
			"1",
			"true",
			"yes",
			"on"
		].includes(String(value).toLowerCase()) : false;
	}
	function getProtocolProfile(node) {
		if (node.protocol === "hysteria2") return {
			singBoxNetwork: "udp",
			singBoxHopInterval: "30s"
		};
		if (node.protocol === "tuic") return {
			singBoxNetwork: "udp",
			tuicCongestionControl: "bbr",
			tuicHeartbeat: "10s",
			tuicZeroRttHandshake: false,
			tuicUdpRelayMode: "native"
		};
		if (node.protocol === "wireguard") return {
			singBoxNetwork: "udp",
			wireguardMtu: 1408
		};
		if (node.protocol === "vless" || node.protocol === "vmess" || node.protocol === "trojan") {
			const metadata = node.metadata ?? {};
			const network = node.protocol === "vmess" ? metadata.net ?? "tcp" : metadata.type ?? "tcp";
			const alpn = metadata.alpn?.split(",").map((value) => value.trim()).filter(Boolean);
			return { xrayTlsAlpn: alpn && alpn.length > 0 ? alpn : network === "grpc" || network === "h2" || network === "xhttp" || network === "splithttp" ? ["h2", "http/1.1"] : ["http/1.1"] };
		}
		return {};
	}
	function buildSingBoxOutbound(node) {
		const m = node.metadata ?? {};
		const profile = getProtocolProfile(node);
		const serverAddress = normalizeNodeServer(node.server);
		if (node.protocol === "vless") {
			const transport = buildSingBoxTransport(m);
			const tls = buildSingBoxTls(m, serverAddress);
			return {
				type: "vless",
				server: serverAddress,
				server_port: node.port,
				uuid: m.id ?? "",
				flow: m.flow || void 0,
				tls,
				transport
			};
		}
		if (node.protocol === "vmess") {
			const transport = buildSingBoxTransport(m, true);
			const tls = m.tls === "tls" ? {
				enabled: true,
				server_name: m.sni ?? node.server,
				insecure: parseBool(m.insecure)
			} : void 0;
			return {
				type: "vmess",
				server: node.server,
				server_port: node.port,
				uuid: m.id ?? "",
				alter_id: Number(m.aid ?? "0"),
				security: m.scy ?? "auto",
				tls,
				transport
			};
		}
		if (node.protocol === "trojan") {
			const transport = buildSingBoxTransport(m);
			return {
				type: "trojan",
				server: node.server,
				server_port: node.port,
				password: m.password ?? "",
				tls: {
					enabled: true,
					server_name: m.sni ?? node.server,
					insecure: parseBool(m.insecure)
				},
				transport
			};
		}
		if (node.protocol === "shadowsocks") return {
			type: "shadowsocks",
			server: node.server,
			server_port: node.port,
			method: m.method ?? "aes-128-gcm",
			password: m.password ?? ""
		};
		if (node.protocol === "socks") return {
			type: "socks",
			server: node.server,
			server_port: node.port,
			username: m.username || void 0,
			password: m.password || void 0
		};
		if (node.protocol === "http") return {
			type: "http",
			server: node.server,
			server_port: node.port,
			username: m.username || void 0,
			password: m.password || void 0,
			tls: parseBool(m.tls) || m.security === "tls" ? {
				enabled: true,
				server_name: m.sni ?? node.server,
				insecure: parseBool(m.insecure)
			} : void 0
		};
		if (node.protocol === "hysteria2") return {
			type: "hysteria2",
			server: node.server,
			server_port: node.port,
			password: m.password ?? "",
			up_mbps: parseNumber(m.up_mbps ?? m.upmbps ?? m.up, 100),
			down_mbps: parseNumber(m.down_mbps ?? m.downmbps ?? m.down, 100),
			hop_interval: m.hop_interval ?? profile.singBoxHopInterval,
			network: m.network ?? profile.singBoxNetwork,
			tls: {
				enabled: true,
				server_name: m.sni ?? node.server,
				insecure: parseBool(m.insecure)
			},
			obfs: m.obfs ? {
				type: m.obfs,
				password: m.obfs_password ?? m["obfs-password"] ?? ""
			} : void 0
		};
		if (node.protocol === "tuic") return {
			type: "tuic",
			server: node.server,
			server_port: node.port,
			uuid: m.uuid ?? "",
			password: m.password ?? "",
			congestion_control: m.congestion_control ?? profile.tuicCongestionControl ?? "bbr",
			udp_relay_mode: m.udp_relay_mode ?? profile.tuicUdpRelayMode ?? "native",
			zero_rtt_handshake: parseBool(m.zero_rtt_handshake) || profile.tuicZeroRttHandshake === true,
			heartbeat: m.heartbeat ?? profile.tuicHeartbeat,
			network: m.network ?? profile.singBoxNetwork,
			tls: {
				enabled: true,
				server_name: m.sni ?? node.server,
				insecure: parseBool(m.insecure),
				alpn: (m.alpn ?? "").split(",").map((s) => s.trim()).filter(Boolean)
			}
		};
		return { type: "direct" };
	}
	function splitList(value, fallback) {
		if (!value) return fallback;
		const result = value.split(",").map((s) => s.trim()).filter(Boolean);
		return result.length > 0 ? result : fallback;
	}
	function parseReserved(value) {
		if (!value) return void 0;
		const result = value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
		return result.length > 0 ? result : void 0;
	}
	function buildSingBoxWireguardEndpoint(node) {
		const m = node.metadata ?? {};
		const profile = getProtocolProfile(node);
		const preSharedKey = m.pre_shared_key ?? m.preshared_key ?? m.preSharedKey;
		const reserved = parseReserved(m.reserved);
		return {
			type: "wireguard",
			tag: "wg-ep",
			system: false,
			mtu: parseNumber(m.mtu, profile.wireguardMtu ?? 1408),
			address: splitList(m.local_address ?? m.address, ["10.7.0.2/32"]),
			private_key: m.private_key ?? m.privateKey ?? "",
			peers: [{
				address: node.server,
				port: node.port,
				public_key: m.peer_public_key ?? m.public_key ?? m.publicKey ?? "",
				pre_shared_key: preSharedKey || void 0,
				allowed_ips: splitList(m.allowed_ips ?? m.allowedIPs, ["0.0.0.0/0", "::/0"]),
				persistent_keepalive_interval: parseNumber(m.persistent_keepalive_interval ?? m.keepalive, 25),
				reserved
			}]
		};
	}
	function buildSingBoxTls(m, server) {
		const fingerprint = normalizeSingBoxFingerprint(m.fp);
		const alpn = m.alpn ? m.alpn.split(",").map((s) => s.trim()).filter(Boolean) : ["h2", "http/1.1"];
		if (m.security === "reality") return {
			enabled: true,
			server_name: m.sni ?? server,
			alpn,
			utls: {
				enabled: true,
				fingerprint
			},
			reality: {
				enabled: true,
				public_key: m.pbk ?? "",
				short_id: m.sid ?? ""
			}
		};
		if (m.security === "tls") return {
			enabled: true,
			server_name: m.sni ?? server,
			alpn,
			insecure: parseBool(m.insecure),
			utls: {
				enabled: true,
				fingerprint
			}
		};
	}
	function normalizeSingBoxFingerprint(value) {
		const normalized = value?.trim().toLowerCase();
		if (!normalized || normalized === "random" || normalized === "randomized") return "chrome";
		return (/* @__PURE__ */ new Set([
			"chrome",
			"firefox",
			"safari",
			"ios",
			"android",
			"edge",
			"360",
			"qq"
		])).has(normalized) ? normalized : "chrome";
	}
	function buildSingBoxTransport(m, isVmess = false) {
		const network = isVmess ? m.net ?? "tcp" : m.type ?? "tcp";
		if (network === "xhttp" || network === "splithttp") throw new Error(`sing-box does not support ${network} transport; use Xray.`);
		if (network === "ws") return {
			type: "ws",
			path: m.path ?? "/",
			headers: m.host ? { Host: m.host } : void 0
		};
		if (network === "grpc") return {
			type: "grpc",
			service_name: m.serviceName ?? ""
		};
		if (network === "h2") return {
			type: "http",
			host: m.host ? [m.host] : void 0,
			path: m.path ?? "/"
		};
	}
	function buildXrayProcessRules(processRules) {
		return processRules.map((rule) => ({
			type: "field",
			process: [rule.process],
			outboundTag: rule.mode === "vpn" ? "proxy" : rule.mode === "block" ? "block" : "direct"
		}));
	}
	function buildRules(domainRules) {
		const rules = [];
		for (const rule of domainRules) rules.push({
			type: "field",
			domain: [rule.domain],
			outboundTag: rule.mode === "vpn" ? "proxy" : rule.mode === "block" ? "block" : "direct"
		});
		return rules;
	}
	function buildSingBoxRules(domainRules, processRules, useTunMode, proxyTag) {
		const rules = [];
		if (useTunMode) for (const rule of processRules) if (rule.mode === "block") rules.push({
			process_name: [rule.process],
			action: "reject"
		});
		else rules.push({
			process_name: [rule.process],
			outbound: rule.mode === "vpn" ? proxyTag : "direct"
		});
		for (const rule of domainRules) if (rule.mode === "block") rules.push({
			domain_suffix: [rule.domain],
			action: "reject"
		});
		else rules.push({
			domain_suffix: [rule.domain],
			outbound: rule.mode === "vpn" ? proxyTag : "direct"
		});
		return rules;
	}
	function buildDefaultXrayRule(mode) {
		return {
			type: "field",
			network: "tcp,udp",
			outboundTag: mode === "global" ? "proxy" : "direct"
		};
	}
	function buildDns(mode, customDnsUrl) {
		if (mode === "custom") return { servers: [parseCustomDnsUrl(customDnsUrl ?? "").url] };
		if (mode === "secure") return { servers: ["8.8.8.8", "1.1.1.1"] };
	}
	function buildSingBoxDns(mode, customDnsUrl, proxyTag = "proxy") {
		if (mode === "system") return { servers: [{
			tag: "system-dns",
			type: "local"
		}, {
			tag: "bootstrap-dns",
			type: "udp",
			server: "1.1.1.1"
		}] };
		if (mode === "custom") {
			const customDns = parseCustomDnsUrl(customDnsUrl ?? "");
			return {
				servers: [
					{
						tag: "proxy-dns",
						type: "https",
						server: customDns.server,
						server_port: customDns.serverPort,
						path: customDns.path,
						detour: proxyTag,
						domain_resolver: customDns.hostnameRequiresResolver ? {
							server: "bootstrap-dns",
							strategy: "prefer_ipv4"
						} : void 0
					},
					{
						tag: "direct-dns",
						type: "udp",
						server: "8.8.8.8"
					},
					{
						tag: "bootstrap-dns",
						type: "udp",
						server: "1.1.1.1"
					}
				],
				final: "proxy-dns",
				strategy: "prefer_ipv4"
			};
		}
		return {
			servers: [
				{
					tag: "proxy-dns",
					type: "https",
					server: "1.1.1.1",
					server_port: 443,
					detour: proxyTag
				},
				{
					tag: "direct-dns",
					type: "udp",
					server: "8.8.8.8"
				},
				{
					tag: "bootstrap-dns",
					type: "udp",
					server: "1.1.1.1"
				}
			],
			final: "proxy-dns",
			strategy: "prefer_ipv4"
		};
	}
})(ConfigBuilder || (ConfigBuilder = {}));
//#endregion
