//#region src/electron/shutdown-coordinator.ts
async function runShutdownSteps(steps, timeoutMs) {
	const completedSteps = [];
	const failedSteps = [];
	let timeoutHandle = null;
	let runningStep = null;
	const work = (async () => {
		for (const step of steps) {
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
		return false;
	})();
	const timeout = new Promise((resolve) => {
		timeoutHandle = setTimeout(() => resolve(true), timeoutMs);
	});
	const timedOut = await Promise.race([work, timeout]);
	if (timeoutHandle) clearTimeout(timeoutHandle);
	return {
		completedSteps,
		failedSteps,
		timedOut,
		unfinishedStep: timedOut ? runningStep : null
	};
}
//#endregion
