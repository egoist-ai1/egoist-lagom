//#region src/electron/ipc/node-parser.ts
/**
* Node Parser — оркестратор.
*
* Этот файл раньше содержал 1197 строк. Теперь он разделён на 4 модуля:
*   parsers/parser-utils.ts  — утилиты (base64, buildNode, dedupe)
*   parsers/uri-parsers.ts   — URI-парсеры (VLESS, VMess, Trojan, SS, ...)
*   parsers/clash-parser.ts  — Clash YAML парсер
*   parsers/json-parser.ts   — JSON конфиг парсеры (Xray, sing-box)
*
* Публичный API переэкспортируется ниже для совместимости.
*/
/**
* Пытается декодировать весь payload как один base64-блок (стандарт v2rayN подписок).
* Если декодированный текст содержит VPN URI — возвращает список URI.
*/
function tryDecodeFullPayloadAsBase64(payload) {
	const trimmed = payload.trim();
	if (trimmed.length < 16) return [];
	const cleaned = trimmed.replace(/[\r\n\s]+/g, "");
	if (!/^[A-Za-z0-9+/=_-]+$/.test(cleaned)) return [];
	try {
		const normalized = cleaned.replace(/-/g, "+").replace(/_/g, "/");
		const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - normalized.length % 4);
		const uris = extractKnownUris(Buffer.from(`${normalized}${padding}`, "base64").toString("utf8"));
		if (uris.length > 0) {
			log.info(`[node-parser] Full base64 decode: found ${uris.length} URIs`);
			return uris;
		}
	} catch {}
	return [];
}
function parseNodesFromText(payload) {
	const lines = payload.split(/\r?\n/g).map((item) => item.trim()).filter(Boolean);
	const nodes = [];
	const issues = [];
	const base64Uris = tryDecodeFullPayloadAsBase64(payload);
	if (base64Uris.length > 0) {
		for (const uri of base64Uris) {
			const detailed = parseNodeUriDetailed(uri);
			if (detailed.node) nodes.push(detailed.node);
			else if (detailed.issue) issues.push(detailed.issue);
		}
		if (nodes.length > 0) {
			log.info(`[node-parser] Parsed ${nodes.length} nodes from full base64 payload`);
			return {
				nodes: dedupeNodes(nodes),
				issues
			};
		}
	}
	const yamlResult = parseNodesFromClashYaml(payload);
	if (yamlResult.matched) {
		nodes.push(...yamlResult.nodes);
		issues.push(...yamlResult.issues);
	}
	const jsonResult = parseNodesFromJson(payload);
	if (jsonResult.matched) {
		nodes.push(...jsonResult.nodes);
		issues.push(...jsonResult.issues);
	}
	const directUris = !yamlResult.matched && !jsonResult.matched ? extractKnownUris(payload) : [];
	const candidates = directUris.length > 0 ? directUris : [...lines];
	if (directUris.length > 0) for (const line of lines) {
		if (/(vless|vmess|trojan|ss|socks5?|https?|hy2|hysteria2|tuic|wireguard|wg):\/\//i.test(line)) continue;
		if (isSubscriptionUrl(line)) issues.push(`Найдена ссылка подписки: ${line.slice(0, 120)}`);
		else issues.push(`Пропущена неподдерживаемая строка: ${line.slice(0, 120)}`);
	}
	for (const line of candidates) {
		const detailed = parseNodeUriDetailed(line);
		if (detailed.node) {
			nodes.push(detailed.node);
			continue;
		}
		if (detailed.issue) {
			issues.push(detailed.issue);
			continue;
		}
		const decodedCandidates = tryDecodeSubscriptionBlock(line);
		if (decodedCandidates.length > 0) {
			for (const decoded of decodedCandidates) {
				const decodedDetailed = parseNodeUriDetailed(decoded);
				if (decodedDetailed.node) nodes.push(decodedDetailed.node);
				else if (decodedDetailed.issue) issues.push(decodedDetailed.issue);
				else issues.push(`Ошибка в строке подписки: ${decoded.slice(0, 120)}`);
			}
			continue;
		}
		if (isSubscriptionUrl(line)) {
			issues.push(`Найдена ссылка подписки: ${line.slice(0, 120)}`);
			continue;
		}
		if (!yamlResult.matched && !jsonResult.matched && lines.length <= 25) issues.push(`Пропущена неподдерживаемая строка: ${line.slice(0, 120)}`);
	}
	log.info(`[node-parser] Final result: ${nodes.length} nodes, ${issues.length} issues`);
	return {
		nodes: dedupeNodes(nodes),
		issues
	};
}
//#endregion
