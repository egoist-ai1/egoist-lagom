//#region src/shared/persisted-display-text.ts
var DISPLAY_METADATA_KEYS = /* @__PURE__ */ new Set([
	"city",
	"country",
	"countryName",
	"provider",
	"ps",
	"remark",
	"subscriptionName"
]);
function normalizePersistedDisplayText(state) {
	return {
		...state,
		nodes: (state.nodes ?? []).map((node) => ({
			...node,
			name: typeof node.name === "string" ? normalizeDisplayText(node.name) : node.name,
			metadata: Object.fromEntries(Object.entries(node.metadata ?? {}).map(([key, value]) => [key, DISPLAY_METADATA_KEYS.has(key) && typeof value === "string" ? normalizeDisplayText(value) : value]))
		})),
		subscriptions: (state.subscriptions ?? []).map((subscription) => ({
			...subscription,
			name: typeof subscription.name === "string" ? normalizeDisplayText(subscription.name) : subscription.name
		}))
	};
}
//#endregion
