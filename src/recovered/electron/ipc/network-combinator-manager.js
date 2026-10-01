//#region src/electron/ipc/network-combinator-manager.ts
var DEFAULT_MODULES = [
	{
		id: "vpn",
		status: "unknown",
		health: "unknown",
		ownedLocks: [],
		activeMutations: []
	},
	{
		id: "dns",
		status: "unknown",
		health: "unknown",
		ownedLocks: [],
		activeMutations: []
	},
	{
		id: "zapret",
		status: "unknown",
		health: "unknown",
		ownedLocks: [],
		activeMutations: []
	},
	{
		id: "telegram-proxy",
		status: "unknown",
		health: "unknown",
		ownedLocks: [],
		activeMutations: [],
		sidecar: true
	},
	{
		id: "system-proxy",
		status: "unknown",
		health: "unknown",
		ownedLocks: [],
		activeMutations: []
	},
	{
		id: "firewall",
		status: "unknown",
		health: "unknown",
		ownedLocks: [],
		activeMutations: []
	},
	{
		id: "updates",
		status: "unknown",
		health: "unknown",
		ownedLocks: [],
		activeMutations: []
	}
];
var INSPECTION_CACHE_TTL_MS = 3e3;
var MUTATION_WAIT_TIMEOUT_MS = 3e4;
var COORDINATOR_MAX_PENDING_MUTATIONS = 128;
var COORDINATOR_MAX_PLANS = 64;
var COORDINATOR_PLAN_TTL_MS = 3e5;
var NetworkCombinatorManager = class {
	isNetworkReady;
	isElevated;
	getProductVersion;
	moduleInspectors;
	plans = /* @__PURE__ */ new Map();
	planExpirations = /* @__PURE__ */ new Map();
	elapsedNow;
	lastInspection = null;
	inspectionCacheExpiresAt = 0;
	inspectionInFlight = null;
	inspectionGeneration = 0;
	inspectionDiagnostics = [];
	inspectionStartedAt = 0;
	onInspectionDiagnostic;
	activeCoordinatedMutations = /* @__PURE__ */ new Map();
	outstandingCoordinatedMutations = 0;
	mutationReleaseWaiters = /* @__PURE__ */ new Set();
	mutationSequence = 0;
	constructor(options) {
		this.isNetworkReady = options.isNetworkReady ?? (() => true);
		this.isElevated = options.isElevated;
		this.getProductVersion = options.getProductVersion ?? (() => void 0);
		this.moduleInspectors = options.moduleInspectors ?? {};
		this.elapsedNow = options.elapsedNow ?? (() => performance.now());
		this.onInspectionDiagnostic = options.onInspectionDiagnostic ?? ((event) => {
			if (typeof log !== "undefined") log.warn?.("[network-owner-inspection]", JSON.stringify(event));
		});
	}
	async inspect() {
		const generation = this.inspectionGeneration;
		const now = this.elapsedNow();
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
		this.inspectionStartedAt = this.elapsedNow();
		this.inspectionDiagnostics = DEFAULT_MODULES.map((module) => ({
			id: module.id, state: "pending", startedAt: this.elapsedNow(), elapsedMs: 0, errorCode: null
		}));
		try {
			const modules = await Promise.all(DEFAULT_MODULES.map(async (fallback, index) => {
				const row = this.inspectionDiagnostics[index];
				try {
					const inspector = this.moduleInspectors[fallback.id];
					const value = inspector ? { ...fallback, ...await inspector() } : fallback;
					row.state = value.status === "degraded" || value.health === "warn" ? "degraded" : "complete";
					if (fallback.id === "dns" && Array.isArray(value.ownerInspectionErrors)) row.causes = value.ownerInspectionErrors.slice(0, 8);
					if (row.state === "degraded") row.errorCode = typeof row.causes?.[0]?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(row.causes[0].code) ? row.causes[0].code : "OWNER_STATE_UNAVAILABLE";
					return value;
				} catch (error) {
					row.state = "error";
					row.errorCode = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : "INSPECTOR_REJECTED";
					throw error;
				} finally { row.elapsedMs = Math.max(0, Math.round(this.elapsedNow() - row.startedAt)); }
			}));
			const admin = { id: "admin-token", state: "pending", startedAt: this.elapsedNow(), elapsedMs: 0, errorCode: null };
			this.inspectionDiagnostics.push(admin);
			let isElevated;
			try { isElevated = await this.isElevated(); admin.state = "complete"; }
			catch (error) { admin.state = "error"; admin.errorCode = "ADMIN_TOKEN_QUERY_FAILED"; throw error; }
			finally { admin.elapsedMs = Math.max(0, Math.round(this.elapsedNow() - admin.startedAt)); }
			const inspection = buildNetworkCombinatorInspection({
			modules,
			productVersion: this.getProductVersion(),
			admin: {
				isElevated,
				strategy: "admin-default-app-boundary"
			}
		});
			if (generation === this.inspectionGeneration) {
				this.lastInspection = inspection;
				this.inspectionCacheExpiresAt = this.elapsedNow() + INSPECTION_CACHE_TTL_MS;
			}
			if (this.inspectionDiagnostics.some((row) => row.state === "degraded") || this.elapsedNow() - this.inspectionStartedAt >= 1000)
				this.reportInspectionDiagnostic("NETWORK_OWNER_INSPECTION_SLOW_OR_DEGRADED");
			return inspection;
		} catch (error) {
			this.reportInspectionDiagnostic("NETWORK_OWNER_INSPECTION_FAILED");
			throw error;
		}
	}
	reportInspectionDiagnostic(errorCode, action) {
		const providers = this.inspectionDiagnostics.map(({ id, state, startedAt, elapsedMs, errorCode, causes }) => ({
			id, state, elapsedMs: state === "pending" ? Math.max(0, Math.round(this.elapsedNow() - startedAt)) : elapsedMs, errorCode,
			...causes?.length ? { causes } : {}
		}));
		const event = { errorCode, ...(action ? { action } : {}), generation: this.inspectionGeneration,
			elapsedMs: Math.max(0, Math.round(this.elapsedNow() - this.inspectionStartedAt)), providers };
		try { this.onInspectionDiagnostic(event); } catch {}
		return event;
	}
	async plan(intent) {
		this.prunePlans();
		const plan = buildNetworkCombinatorPlan(await this.inspect(), intent);
		this.plans.delete(plan.planId);
		this.planExpirations.delete(plan.planId);
		if (this.plans.size >= COORDINATOR_MAX_PLANS) {
			const expiredId = this.plans.keys().next().value;
			this.plans.delete(expiredId);
			this.planExpirations.delete(expiredId);
		}
		this.plans.set(plan.planId, plan);
		this.planExpirations.set(plan.planId, this.elapsedNow() + COORDINATOR_PLAN_TTL_MS);
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
			ok: !plan.operations.some((operation) => operation.risk !== "read-only"),
			applied: false,
			code: plan.operations.some((operation) => operation.risk !== "read-only") ? "PLAN_EXECUTOR_UNAVAILABLE" : "READ_ONLY_PLAN",
			message: plan.operations.some((operation) => operation.risk !== "read-only") ? "Diagnostic plans cannot change Windows settings. Use the supported component controls." : "Read-only plan requires no Windows mutation.",
			planId
		};
	}
	rollback(planId) {
		this.requirePlan(planId);
		return {
			ok: false,
			applied: false,
			code: "PLAN_EXECUTOR_UNAVAILABLE",
			message: "No diagnostic plan was executed. There is no applied transaction to restore.",
			planId
		};
	}
	verify(planId) {
		const plan = this.requirePlan(planId);
		return buildNetworkVerificationReport({
			plan,
			checks: [{
				id: "execution",
				label: "Applied network state",
				status: "skipped",
				reason: "This diagnostic plan has no executor or observed network result. Plan approval does not verify connectivity."
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
	isMutationIdle() {
		return this.outstandingCoordinatedMutations === 0;
	}
	async runCoordinatedMutation(intent, operation) {
		if (this.outstandingCoordinatedMutations >= COORDINATOR_MAX_PENDING_MUTATIONS) throw new Error("Too many pending network operations. Wait for the current operation to finish.");
		this.outstandingCoordinatedMutations += 1;
		try {
			return await this.runCoordinatedMutationWithLocks(intent, operation);
		} finally {
			this.outstandingCoordinatedMutations -= 1;
		}
	}
	async runCoordinatedMutationWithLocks(intent, operation) {
		if (!this.isNetworkReady()) throw new Error("Завершается восстановление сети после запуска. Повторите действие через несколько секунд.");
		const normalized = {
			module: intent.module,
			action: intent.action,
			requiredLocks: [...new Set(intent.requiredLocks)],
			conflictsWith: [...new Set(intent.conflictsWith ?? [])]
		};
		const waitTimeoutMs = intent.waitTimeoutMs ?? MUTATION_WAIT_TIMEOUT_MS;
		if (!Number.isFinite(waitTimeoutMs) || waitTimeoutMs <= 0 || waitTimeoutMs > MUTATION_WAIT_TIMEOUT_MS) throw new Error("Invalid network mutation wait budget.");
		const deadline = this.elapsedNow() + waitTimeoutMs;
		let active = null;
		while (!active) {
			// Module inspectors report steady ownership (for example an active VPN
			// owns `traffic-route`) outside the short-lived mutation map.  The old
			// loop only checked that map, so a DNS/Zapret mutation could start while
			// a VPN was already routing traffic.  Invalidate before every attempt so
			// a cached inspection cannot authorize a conflicting operation.
			this.invalidateInspection();
			const inspection = await this.inspectBeforeDeadline(deadline, `${intent.module}:${intent.action}`);
			if (!this.isNetworkReady()) throw new Error("Завершается восстановление сети после запуска. Повторите действие через несколько секунд.");
			// VPN transitions own suspension/restoration of a steady Zapret runtime.
			// Active Zapret mutations still conflict through tryAcquireMutation below.
			const transitionsZapret = normalized.module === "vpn" && ["connect", "reconnect", "disconnect", "service-install", "service-start", "service-stop", "service-remove"].includes(normalized.action) && normalized.requiredLocks.includes("zapret-suspend");
			const steadyLocks = inspection.modules.flatMap((module) => {
				if (module.id === normalized.module || transitionsZapret && module.id === "zapret") return [];
				return module.ownedLocks ?? [];
			});
			const steadyConflict = this.locksOverlap(normalized.conflictsWith, steadyLocks);
			active = steadyConflict ? null : this.tryAcquireMutation(normalized);
			if (active) break;
			const remainingMs = deadline - this.elapsedNow();
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
	async inspectBeforeDeadline(deadline, action) {
		const remainingMs = deadline - this.elapsedNow();
		if (remainingMs <= 0) throw new Error(`Timed out waiting for a safe network mutation slot: ${action}`);
		let timer;
		try {
			return await Promise.race([
				this.inspect(),
				new Promise((_, reject) => {
					timer = setTimeout(() => {
						const event = this.reportInspectionDiagnostic("NETWORK_OWNER_INSPECTION_TIMEOUT", action);
						const pending = event.providers.filter((row) => row.state === "pending").map((row) => `${row.id}@${row.elapsedMs}ms`).join(",") || "none";
						reject(new Error(`Timed out inspecting network owners before mutation: ${action}; pending=${pending}`));
					}, remainingMs);
				})
			]);
		} finally {
			clearTimeout(timer);
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
		this.prunePlans();
		const plan = this.plans.get(planId);
		if (!plan) throw new Error(`Unknown network combinator plan: ${planId}`);
		return plan;
	}
	prunePlans() {
		const now = this.elapsedNow();
		for (const [id, expiresAt] of this.planExpirations) {
			if (expiresAt <= now) {
				this.planExpirations.delete(id);
				this.plans.delete(id);
			}
		}
	}
};
//#endregion
