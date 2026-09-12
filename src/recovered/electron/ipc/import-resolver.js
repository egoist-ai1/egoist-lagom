//#region src/electron/ipc/import-resolver.ts
function extractSubscriptionUrls(payload) {
	const unique = /* @__PURE__ */ new Set();
	const lines = payload.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
	for (const line of lines) if (isSubscriptionUrl(line)) unique.add(line);
	return [...unique];
}
function toErrorMessage(error) {
	if (error instanceof Error && error.message) return error.message;
	return String(error);
}
function withSourcePrefix(source, issue) {
	return `[${source}] ${issue}`;
}
function toSafeSubscriptionError(url, error) {
	return toErrorMessage(error).split(url).join(redactSubscriptionUrl(url));
}
async function resolveImportPayload(payload, readUrlText, readLegacySubscription) {
	const parsed = parseNodesFromText(payload);
	const urls = extractSubscriptionUrls(payload);
	log.info(`[import-resolver] Direct parse: ${parsed.nodes.length} nodes, ${urls.length} subscription URLs found`);
	if (urls.length === 0) return {
		...parsed,
		subscriptions: []
	};
	const nodes = [...parsed.nodes];
	const issues = parsed.issues.filter((issue) => !issue.startsWith("Найдена ссылка подписки"));
	const subscriptions = [];
	for (const url of urls) try {
		log.info(`[import-resolver] Fetching subscription: ${redactSubscriptionUrl(url)}`);
		const response = await readUrlText(url);
		log.info(`[import-resolver] Subscription response received: ${response.text.length} bytes, name="${response.name}"`);
		const subParsed = parseNodesFromText(response.text);
		log.info(`[import-resolver] Parsed ${subParsed.nodes.length} nodes from subscription, ${subParsed.issues.length} issues`);
		nodes.push(...subParsed.nodes.map((node) => ({ ...node, sourceSubscriptionUrl: url })));
		if (subParsed.nodes.length > 0) subscriptions.push({
			url,
			name: response.name || null,
			userinfo: response.userinfo
		});
		else {
			const legacy = await readLegacySubscription?.(url);
			if (legacy?.nodes?.length) {
				nodes.push(...legacy.nodes.map((node) => ({ ...node, sourceSubscriptionUrl: url })));
				subscriptions.push({
					url,
					name: response.name || legacy.name || null,
					userinfo: response.userinfo ?? legacy.userinfo ?? null
				});
				issues.push(withSourcePrefix(redactSubscriptionUrl(url), "Fresh subscription returned no supported VPN servers; restored servers from previous EgoistShield state."));
			} else issues.push(withSourcePrefix(redactSubscriptionUrl(url), "Subscription loaded, but no supported VPN servers were found."));
		}
		for (const issue of subParsed.issues) issues.push(withSourcePrefix(redactSubscriptionUrl(url), issue));
	} catch (error) {
		const message = toSafeSubscriptionError(url, error);
		log.error(`[import-resolver] Failed to fetch subscription ${redactSubscriptionUrl(url)}:`, message);
		const legacy = await readLegacySubscription?.(url);
		if (legacy?.nodes?.length) {
			nodes.push(...legacy.nodes.map((node) => ({ ...node, sourceSubscriptionUrl: url })));
			subscriptions.push({
				url,
				name: legacy.name || null,
				userinfo: legacy.userinfo ?? null
			});
			issues.push(withSourcePrefix(redactSubscriptionUrl(url), `Failed to load fresh subscription; restored servers from previous EgoistShield state: ${message}`));
		} else issues.push(withSourcePrefix(redactSubscriptionUrl(url), `Failed to load subscription: ${message}`));
	}
	return {
		nodes,
		issues,
		subscriptions
	};
}
//#endregion
