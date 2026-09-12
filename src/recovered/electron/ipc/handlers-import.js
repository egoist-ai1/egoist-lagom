//#region src/electron/ipc/handlers-import.ts
/**
* Import/Subscription IPC Handlers — import:text, import:file,
* subscription:refresh-one, subscription:refresh-all,
* subscription:rename, node:rename
*/
var MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
async function mapWithConcurrency(items, concurrency, mapper) {
	const results = new Array(items.length);
	let nextIndex = 0;
	async function worker() {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			try {
				results[index] = {
					status: "fulfilled",
					value: await mapper(items[index])
				};
			} catch (reason) {
				results[index] = {
					status: "rejected",
					reason
				};
			}
		}
	}
	const workerCount = Math.min(Math.max(1, concurrency), items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}
function mergeImportResults(current, nodes, issues, subscriptions, started = current) {
	const newSubs = [...current.subscriptions];
	const subIdByUrl = /* @__PURE__ */ new Map();
	for (const sub of subscriptions) {
		const previous = started.subscriptions.find((item) => item.url === sub.url);
		if (previous && !current.subscriptions.some((item) => item.id === previous.id && item.url === sub.url)) continue;
		const idx = newSubs.findIndex((s) => s.url === sub.url);
		const subItem = {
			id: crypto.randomUUID(),
			url: sub.url,
			name: sub.name || null,
			enabled: true,
			lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
			upload: sub.userinfo?.upload,
			download: sub.userinfo?.download,
			total: sub.userinfo?.total,
			expire: sub.userinfo?.expire
		};
		if (idx >= 0) {
			const existingSub = newSubs[idx];
			const existingId = existingSub?.id ?? subItem.id;
			newSubs[idx] = {
				...existingSub,
				...subItem,
				id: existingId,
				name: existingSub.name || subItem.name,
				enabled: existingSub.enabled,
				upload: sub.userinfo?.upload ?? existingSub.upload,
				download: sub.userinfo?.download ?? existingSub.download,
				total: sub.userinfo?.total ?? existingSub.total,
				expire: sub.userinfo?.expire ?? existingSub.expire
			};
			subIdByUrl.set(sub.url, existingId);
		} else {
			newSubs.push(subItem);
			subIdByUrl.set(sub.url, subItem.id);
		}
	}
	const taggedNodes = nodes.filter((node) => !node.sourceSubscriptionUrl || subIdByUrl.has(node.sourceSubscriptionUrl)).map(({ sourceSubscriptionUrl, ...node }) => ({
		...node,
		subscriptionId: sourceSubscriptionUrl ? subIdByUrl.get(sourceSubscriptionUrl) : node.subscriptionId
	}));
	const addedNodes = uniqueNodes(current.nodes, taggedNodes);
	return {
		next: {
			...current,
			nodes: [...current.nodes, ...addedNodes],
			subscriptions: newSubs,
			activeNodeId: current.activeNodeId === null && started.activeNodeId !== null ? null : current.activeNodeId ?? addedNodes[0]?.id ?? null
		},
		result: {
			added: addedNodes.length,
			subscriptionsAdded: subIdByUrl.size,
			issues
		}
	};
}
function mergeSubscriptionRefresh(current, started, originalSub, nodes, response) {
	const subscription = current.subscriptions.find((item) => item.id === originalSub.id && item.url === originalSub.url);
	if (!subscription) return { next: current, added: 0 };
	const originalNodes = started.nodes.filter((node) => node.subscriptionId === originalSub.id);
	const existingNodes = current.nodes.filter((node) => node.subscriptionId === originalSub.id);
	const originalById = new Map(originalNodes.map((node) => [node.id, node]));
	const originalByKey = new Map(originalNodes.map((node) => [buildNodeFingerprint(node), node]));
	const existingById = new Map(existingNodes.map((node) => [node.id, node]));
	const existingKeys = new Set(existingNodes.map(buildNodeFingerprint));
	const incoming = nodes.filter((node) => {
		const key = buildNodeFingerprint(node);
		// A node removed or edited while the request was pending must not reappear.
		return !originalByKey.has(key) || existingKeys.has(key);
	});
	const taggedNodes = preserveNodeIdentities(existingNodes, incoming).map((node) => {
		const original = originalById.get(node.id);
		const existing = existingById.get(node.id);
		return {
			...node,
			name: original && existing && original.name !== existing.name ? existing.name : node.name,
			subscriptionId: originalSub.id
		};
	});
	const userNodes = existingNodes.filter((node) => {
		const original = originalById.get(node.id);
		return !original || buildNodeFingerprint(original) !== buildNodeFingerprint(node);
	});
	const freshNodes = [...current.nodes.filter((node) => node.subscriptionId !== originalSub.id), ...taggedNodes, ...uniqueNodes(taggedNodes, userNodes)];
	return {
		next: {
			...current,
			nodes: freshNodes,
			activeNodeId: current.activeNodeId === null && started.activeNodeId !== null ? null : freshNodes.some((node) => node.id === current.activeNodeId) ? current.activeNodeId : freshNodes[0]?.id ?? null,
			subscriptions: current.subscriptions.map((item) => item.id === originalSub.id ? {
				...item,
				name: item.name !== originalSub.name ? item.name : response.name || item.name || null,
				lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
				upload: response.userinfo?.upload ?? item.upload,
				download: response.userinfo?.download ?? item.download,
				total: response.userinfo?.total ?? item.total,
				expire: response.userinfo?.expire ?? item.expire
			} : item)
		},
		added: taggedNodes.length
	};
}
function registerImportHandlers({ stateStore }) {
	const commitImport = async (started, nodes, issues, subscriptions) => {
		let result;
		await stateStore.update((current) => {
			const merged = mergeImportResults(current, nodes, issues, subscriptions, started);
			result = merged.result;
			return merged.next;
		});
		return result;
	};
	ipcMain.handle("import:text", async (_event, rawPayload) => {
		const payload = ImportTextInputSchema.parse(rawPayload);
		const current = stateStore.get();
		const profile = getSubscriptionUserAgent(current.settings);
		const sendHwid = current.settings.sendSubscriptionHwid ?? false;
		const { nodes, issues, subscriptions } = await resolveImportPayload(payload, (url) => readUrlText(url, profile, sendHwid), (url) => stateStore.findLegacySubscriptionFallback(url));
		return commitImport(current, nodes, issues, subscriptions);
	});
	ipcMain.handle("import:file", async (_event, rawPath) => {
		const filePath = ImportFileInputSchema.parse(rawPath);
		if (!consumePickedFile(filePath)) throw new Error("Файл должен быть выбран через безопасный диалог импорта.");
		const stat = await promises.stat(filePath);
		if (!stat.isFile()) throw new Error("Выбранный путь не является файлом.");
		if (stat.size > MAX_IMPORT_FILE_BYTES) throw new Error("Файл импорта слишком большой. Максимальный размер: 5 МБ.");
		const current = stateStore.get();
		const profile = getSubscriptionUserAgent(current.settings);
		const sendHwid = current.settings.sendSubscriptionHwid ?? false;
		const { nodes, issues, subscriptions } = await resolveImportPayload(await promises.readFile(filePath, "utf8"), (url) => readUrlText(url, profile, sendHwid), (url) => stateStore.findLegacySubscriptionFallback(url));
		return commitImport(current, nodes, issues, subscriptions);
	});
	ipcMain.handle("subscription:refresh-one", async (_event, rawUrl) => {
		const url = SubscriptionUrlInputSchema.parse(rawUrl);
		const current = stateStore.get();
		const originalSub = current.subscriptions.find((item) => item.url === url);
		if (!originalSub) return { added: 0, subscriptionsAdded: 0, issues: [] };
		const response = await readUrlText(url, getSubscriptionUserAgent(current.settings), current.settings.sendSubscriptionHwid ?? false);
		const parsed = parseNodesFromText(response.text);
		let nodes = parsed.nodes;
		const issues = [...parsed.issues];
		if (nodes.length === 0) {
			const legacy = await stateStore.findLegacySubscriptionFallback(url);
			if (legacy?.nodes?.length) {
				nodes = legacy.nodes;
				issues.push(`[${redactSubscriptionUrl(url)}] Fresh subscription returned no supported VPN servers; restored servers from previous EgoistShield state.`);
			} else {
				issues.push(`[${redactSubscriptionUrl(url)}] Subscription refresh returned no supported VPN servers. Existing servers were kept.`);
				return {
					added: 0,
					subscriptionsAdded: 0,
					issues
				};
			}
		}
		let added = 0;
		await stateStore.update((latest) => {
			const merged = mergeSubscriptionRefresh(latest, current, originalSub, nodes, response);
			added = merged.added;
			return merged.next;
		});
		return {
			added,
			subscriptionsAdded: 0,
			issues
		};
	});
	ipcMain.handle("subscription:refresh-all", async () => {
		const started = stateStore.get();
		const profile = getSubscriptionUserAgent(started.settings);
		const sendHwid = started.settings.sendSubscriptionHwid ?? false;
		let totalAdded = 0;
		const issues = [];
		const refreshedSubs = /* @__PURE__ */ new Map();
		const enabledSubs = started.subscriptions.filter((item) => item.enabled);
		const results = await mapWithConcurrency(enabledSubs, 4, async (sub) => {
			const response = await readUrlText(sub.url, profile, sendHwid);
			const parsed = parseNodesFromText(response.text);
			let nodes = parsed.nodes;
			const parsedIssues = [...parsed.issues];
			if (nodes.length === 0) {
				const legacy = await stateStore.findLegacySubscriptionFallback(sub.url);
				if (legacy?.nodes?.length) {
					nodes = legacy.nodes;
					parsedIssues.push(`[${redactSubscriptionUrl(sub.url)}] Fresh subscription returned no supported VPN servers; restored servers from previous EgoistShield state.`);
				} else parsedIssues.push(`[${redactSubscriptionUrl(sub.url)}] Subscription refresh returned no supported VPN servers. Existing servers were kept.`);
			}
			return {
				subId: sub.id,
				url: sub.url,
				nodes,
				issues: parsedIssues,
				name: response.name || null,
				userinfo: response.userinfo
			};
		});
		for (const result of results) if (result.status === "fulfilled") {
			const { subId, url, nodes: parsedNodes, issues: parsedIssues, name, userinfo } = result.value;
			if (parsedNodes.length === 0) {
				issues.push(...parsedIssues.map((issue) => `[${redactSubscriptionUrl(url)}] ${issue}`));
				continue;
			}
			refreshedSubs.set(url, {
				userinfo,
				name,
				nodes: parsedNodes
			});
			issues.push(...parsedIssues.map((issue) => `[${redactSubscriptionUrl(url)}] ${issue}`));
		} else issues.push(`Не удалось обновить подписку: ${String(result.reason)}`);
		await stateStore.update((latest) => {
			let next = latest;
			for (const sub of enabledSubs) {
				const data = refreshedSubs.get(sub.url);
				if (!data) continue;
				const merged = mergeSubscriptionRefresh(next, started, sub, data.nodes, {
					name: data.name,
					userinfo: data.userinfo
				});
				totalAdded += merged.added;
				next = merged.next;
			}
			return next;
		});
		return {
			added: totalAdded,
			subscriptionsAdded: 0,
			issues
		};
	});
	ipcMain.handle("subscription:rename", async (_event, rawUrl, rawName) => {
		const { url, newName } = RenameSubscriptionInputSchema.parse({
			url: rawUrl,
			newName: rawName
		});
		const current = stateStore.get();
		const next = {
			...current,
			subscriptions: current.subscriptions.map((s) => s.url === url ? {
				...s,
				name: newName
			} : s)
		};
		await stateStore.set(next);
		return true;
	});
	ipcMain.handle("subscription:delete", async (_event, rawUrl) => {
		const url = SubscriptionUrlInputSchema.parse(rawUrl);
		const current = stateStore.get();
		const subscription = current.subscriptions.find((item) => item.url === url);
		if (!subscription) return false;
		const subscriptionId = subscription.id;
		const nodes = subscriptionId ? current.nodes.filter((node) => node.subscriptionId !== subscriptionId) : current.nodes;
		const activeNodeId = current.activeNodeId && nodes.some((node) => node.id === current.activeNodeId) ? current.activeNodeId : nodes[0]?.id ?? null;
		await stateStore.set({
			...current,
			nodes,
			activeNodeId,
			subscriptions: current.subscriptions.filter((item) => item.url !== url)
		});
		return true;
	});
	ipcMain.handle("node:rename", async (_event, rawId, rawName) => {
		const { id, newName } = RenameNodeInputSchema.parse({
			id: rawId,
			newName: rawName
		});
		const current = stateStore.get();
		const next = {
			...current,
			nodes: current.nodes.map((n) => n.id === id ? {
				...n,
				name: newName
			} : n)
		};
		await stateStore.set(next);
		return true;
	});
}
//#endregion
