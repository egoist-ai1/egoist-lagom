//#region src/electron/ipc/privileged-command-policy.ts
function createAdapterDnsRollbackSnapshot(records, reason) {
	return {
		schemaVersion: 1,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		owner: "EgoistShield",
		reason,
		records: records.map((record) => ({
			...record,
			before: record.before.map((snapshot) => ({
				family: snapshot.family,
				mode: snapshot.mode,
				servers: [...snapshot.servers]
			}))
		}))
	};
}
//#endregion
