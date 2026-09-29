//#region src/electron/shutdown-coordinator.ts
async function runShutdownSteps(steps, timeoutMs) {
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
			try {
				await step.run();
				completedSteps.push(step.name);
			} catch (error) {
				failedSteps.push({
					name: step.name,
					error
				});
			}
			runningStep = null;
		}
		return deadlineReached;
	})();
	const timeout = new Promise((resolve) => {
		timeoutHandle = setTimeout(() => {
			deadlineReached = true;
			resolve(true);
		}, timeoutMs);
	});
	const timedOut = await Promise.race([work, timeout]);
	if (timeoutHandle) clearTimeout(timeoutHandle);
	return {
		completedSteps: [...completedSteps],
		failedSteps: [...failedSteps],
		timedOut,
		unfinishedStep: timedOut ? runningStep : null
	};
}
//#endregion
