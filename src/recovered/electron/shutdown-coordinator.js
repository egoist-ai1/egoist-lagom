//#region src/electron/shutdown-coordinator.ts
function observeGuiLifecycleTelemetry(phase, step = null, ok = null) {
	try {
		if (typeof guiLifecycleTelemetry === "function") guiLifecycleTelemetry(phase, step, ok);
	} catch { /* Diagnostics cannot interrupt application cleanup. */ }
}
async function runShutdownSteps(steps, timeoutMs) {
	observeGuiLifecycleTelemetry("shutdown-start");
	const completedSteps = [];
	const failedSteps = [];
	let timeoutHandle = null;
	let runningStep = null;
	let deadlineReached = false;
	const deadline = Date.now() + timeoutMs;
	const work = (async () => {
		for (const step of steps) {
			if (deadlineReached || Date.now() >= deadline) {
				deadlineReached = true;
				break;
			}
			runningStep = step.name;
			observeGuiLifecycleTelemetry("shutdown-step-start", step.name);
			try {
				await step.run();
				completedSteps.push(step.name);
				observeGuiLifecycleTelemetry("shutdown-step-end", step.name, true);
			} catch (error) {
				failedSteps.push({
					name: step.name,
					error
				});
				observeGuiLifecycleTelemetry("shutdown-step-end", step.name, false);
			}
			runningStep = null;
		}
		return deadlineReached;
	})();
	const timeout = new Promise((resolve) => {
		timeoutHandle = setTimeout(() => {
			deadlineReached = true;
			observeGuiLifecycleTelemetry("shutdown-timeout", runningStep, false);
			resolve(true);
		}, timeoutMs);
	});
	const timedOut = await Promise.race([work, timeout]);
	if (timeoutHandle) clearTimeout(timeoutHandle);
	observeGuiLifecycleTelemetry("shutdown-outcome", timedOut ? runningStep : null, !timedOut && failedSteps.length === 0);
	return {
		completedSteps: [...completedSteps],
		failedSteps: [...failedSteps],
		timedOut,
		unfinishedStep: timedOut ? runningStep : null
	};
}
//#endregion
