//#region src/electron/ipc/network-combinator-manager.ts
var DEFAULT_MODULES = [
	{
		id: "vpn",
		status: "idle",
		health: "ok",
		ownedLocks: [],
		activeMutations: []
	},
	{
		id: "dns",
		status: "idle",
		health: "ok",
		ownedLocks: [],
		activeMutations: []
	},
	{
		id: "zapret",
		status: "idle",
		health: "ok",
		ownedLocks: [],
		activeMutations: []
	},
	{
		id: "telegram-proxy",
		status: "idle",
		health: "ok",
		ownedLocks: [],
		activeMutations: [],
		sidecar: true
	},
	{
		id: "system-proxy",
		status: "idle",
		health: "ok",
		ownedLocks: [],
		activeMutations: []
	},
	{
		id: "firewall",
		status: "idle",
		health: "ok",
		ownedLocks: [],
		activeMutations: []
	},
	{
		id: "updates",
		status: "idle",
		health: "ok",
		ownedLocks: [],
		activeMutations: []
	}
];
var INSPECTION_CACHE_TTL_MS = 3e3;
var MUTATION_WAIT_TIMEOUT_MS = 3e4;
var NetworkCombinatorManager = class {
	isElevated;
	moduleInspectors;
	plans = /* @__PURE__ */ new Map();
	lastInspection = null;
	inspectionCacheExpiresAt = 0;
	inspectionInFlight = null;
	inspectionGeneration = 0;
	activeCoordinatedMutations = /* @__PURE__ */ new Map();
	mutationReleaseWaiters = /* @__PURE__ */ new Set();
	mutationSequence = 0;
	constructor(options) {
		this.isElevated = options.isElevated;
		this.moduleInspectors = options.moduleInspectors ?? {};
	}
	async inspect() {
		const generation = this.inspectionGeneration;
		const now = Date.now();
		if (this.lastInspection && this.inspectionCacheExpiresAt > now) return this.lastInspection;
		if (this.inspectionInFlight) {
			const value = await this.inspectionInFlight;
			return generation === this.inspectionGeneration ? value : this.inspect();
		}
		this.inspectionInFlight = this.buildInspection(generation).finally(() => {
			this.inspectionInFlight = null;
		});
		const value = await this.inspectionInFlight;
		return generation === this.inspectionGeneration ? value : this.inspect();
	}
	async buildInspection(generation = this.inspectionGeneration) {
		const modules = await Promise.all(DEFAULT_MODULES.map(async (fallback) => {
			const inspector = this.moduleInspectors[fallback.id];
			return inspector ? {
				...fallback,
				...await inspector()
			} : fallback;
		}));
		const inspection = buildNetworkCombinatorInspection({
			modules,
			admin: {
				isElevated: await this.isElevated(),
				strategy: "admin-default-app-boundary"
			}
		});
		if (generation === this.inspectionGeneration) {
			this.lastInspection = inspection;
			this.inspectionCacheExpiresAt = Date.now() + INSPECTION_CACHE_TTL_MS;
		}
		return inspection;
	}
	async plan(intent) {
		const plan = buildNetworkCombinatorPlan(this.lastInspection ?? await this.inspect(), intent);
		this.plans.set(plan.planId, plan);
		return plan;
	}
	approve(planId) {
		const approved = approveNetworkCombinatorPlan(this.requirePlan(planId));
		this.plans.set(planId, approved);
		return approved;
	}
	apply(planId) {
		const plan = this.requirePlan(planId);
		if (plan.approval.required && plan.approval.state !== "granted") throw new Error(`Network combinator plan is not approved: ${planId}`);
		if (plan.status === "blocked") throw new Error(`Network combinator plan is blocked: ${planId}`);
		return {
			ok: true,
			applied: false,
			message: plan.operations.some((operation) => operation.risk !== "read-only") ? "Approved mutating plan is ready for the privileged executor; no direct mutation is performed by the combinator manager." : "Read-only plan requires no Windows mutation.",
			planId
		};
	}
	rollback(planId) {
		this.requirePlan(planId);
		return {
			ok: true,
			applied: false,
			message: "Rollback is represented as a follow-up approved plan; no direct mutation is performed by the combinator manager.",
			planId
		};
	}
	verify(planId) {
		const plan = this.requirePlan(planId);
		return buildNetworkVerificationReport({
			plan,
			checks: [{
				id: "plan-state",
				label: "Plan state",
				status: plan.status === "ready" ? "passed" : "failed"
			}, {
				id: "approval-state",
				label: "Approval state",
				status: plan.approval.required && plan.approval.state !== "granted" ? "skipped" : "passed",
				reason: plan.approval.required && plan.approval.state !== "granted" ? "Plan is waiting for approval." : void 0
			}]
		});
	}
	async diagnose() {
		const inspection = this.lastInspection ?? await this.inspect();
		const coordinated = [...this.activeCoordinatedMutations.values()];
		return {
			redacted: true,
			generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			modules: inspection.modules,
			activeLocks: [.../* @__PURE__ */ new Set([...inspection.activeLocks, ...coordinated.flatMap((item) => item.requiredLocks)])],
			activeMutations: [...inspection.activeMutations, ...coordinated.map((item) => `${item.module}:${item.action}`)]
		};
	}
	async runCoordinatedMutation(intent, operation) {
		const normalized = {
			module: intent.module,
			action: intent.action,
			requiredLocks: [...new Set(intent.requiredLocks)],
			conflictsWith: [...new Set(intent.conflictsWith ?? [])]
		};
		const deadline = Date.now() + (intent.waitTimeoutMs ?? MUTATION_WAIT_TIMEOUT_MS);
		let active = null;
		while (!active) {
			// Module inspectors report steady ownership (for example an active VPN
			// owns `traffic-route`) outside the short-lived mutation map.  The old
			// loop only checked that map, so a DNS/Zapret mutation could start while
			// a VPN was already routing traffic.  Invalidate before every attempt so
			// a cached inspection cannot authorize a conflicting operation.
			this.invalidateInspection();
			const inspection = await this.inspect();
			// VPN transitions own suspension/restoration of a steady Zapret runtime.
			// Active Zapret mutations still conflict through tryAcquireMutation below.
			const transitionsZapret = normalized.module === "vpn" && ["connect", "reconnect", "disconnect"].includes(normalized.action) && normalized.requiredLocks.includes("zapret-suspend");
			const steadyLocks = inspection.modules.flatMap((module) => {
				if (module.id === normalized.module || transitionsZapret && module.id === "zapret") return [];
				return module.ownedLocks ?? [];
			});
			const steadyConflict = this.locksOverlap(normalized.conflictsWith, steadyLocks);
			active = steadyConflict ? null : this.tryAcquireMutation(normalized);
			if (active) break;
			const remainingMs = deadline - Date.now();
			if (remainingMs <= 0) {
				throw new Error(`Timed out waiting for a safe network mutation slot: ${intent.module}:${intent.action}`);
			}
			if (steadyConflict) {
				// A steady lock is released by the owning module rather than by this
				// manager, so no release waiter is notified.  Poll the authoritative
				// inspector in short intervals while retaining the caller deadline.
				await new Promise((resolve) => setTimeout(resolve, Math.min(250, remainingMs)));
			} else await this.waitForMutationRelease(remainingMs);
		}
		this.invalidateInspection();
		try {
			return await operation();
		} finally {
			this.activeCoordinatedMutations.delete(active.id);
			this.invalidateInspection();
			for (const release of [...this.mutationReleaseWaiters]) release();
		}
	}
	tryAcquireMutation(intent) {
		if ([...this.activeCoordinatedMutations.values()].some((active) => this.locksOverlap(intent.requiredLocks, active.requiredLocks) || this.locksOverlap(intent.conflictsWith, active.requiredLocks) || this.locksOverlap(active.conflictsWith, intent.requiredLocks))) return null;
		const mutation = {
			...intent,
			id: `${intent.module}:${intent.action}:${++this.mutationSequence}`,
			startedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		this.activeCoordinatedMutations.set(mutation.id, mutation);
		return mutation;
	}
	locksOverlap(left, right) {
		return left.some((lock) => right.includes(lock));
	}
	waitForMutationRelease(timeoutMs) {
		return new Promise((resolve, reject) => {
			let settled = false;
			const finish = (error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.mutationReleaseWaiters.delete(onRelease);
				if (error) reject(error);
				else resolve();
			};
			const onRelease = () => finish();
			const timer = setTimeout(() => finish(/* @__PURE__ */ new Error("Timed out waiting for the active network mutation to finish.")), timeoutMs);
			this.mutationReleaseWaiters.add(onRelease);
		});
	}
	invalidateInspection() {
		this.lastInspection = null;
		this.inspectionCacheExpiresAt = 0;
		this.inspectionGeneration += 1;
	}
	requirePlan(planId) {
		const plan = this.plans.get(planId);
		if (!plan) throw new Error(`Unknown network combinator plan: ${planId}`);
		return plan;
	}
};
//#endregion
