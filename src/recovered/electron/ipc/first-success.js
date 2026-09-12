//#region src/electron/ipc/first-success.ts
/**
* Runs equivalent network probes concurrently and returns the first success.
* Every slower probe is aborted immediately so a healthy fast endpoint does
* not inherit the timeout of the slowest fallback.
*
* Контракт: «успех» — это выполненный промис. Probe, который на ошибке
* возвращает пустое значение вместо reject, обязан оборачиваться вызывающим
* кодом, иначе первый же провал будет принят за победу.
*/
var FIRST_SUCCESS_ABORT_REASON = "first-success";
/**
* A losing probe is cancelled after another endpoint has already produced a
* valid answer. That cancellation is control flow, not a network failure, and
* must not be written to the diagnostic log as an error every watchdog cycle.
*/
function isFirstSuccessfulCancellation(error) {
	if (error === "first-success") return true;
	if (!error || typeof error !== "object") return false;
	const candidate = error;
	return [
		candidate.message,
		candidate.reason,
		candidate.cause
	].some((value) => typeof value === "string" && value.trim() === "first-success");
}
async function firstSuccessful(probes) {
	if (probes.length === 0) throw new AggregateError([], "No probes were provided.");
	const controllers = probes.map(() => new AbortController());
	const errors = new Array(probes.length).fill(/* @__PURE__ */ new Error("Probe did not report a result."));
	return new Promise((resolve, reject) => {
		let settled = false;
		let failures = 0;
		const abortOthers = (winner) => {
			controllers.forEach((controller, controllerIndex) => {
				if (controllerIndex !== winner) controller.abort(FIRST_SUCCESS_ABORT_REASON);
			});
		};
		probes.forEach((probe, index) => {
			Promise.resolve().then(() => probe(controllers[index].signal)).then((value) => {
				if (settled) return;
				settled = true;
				abortOthers(index);
				resolve(value);
			}, (error) => {
				errors[index] = error;
				failures += 1;
				if (!settled && failures === probes.length) {
					settled = true;
					abortOthers(-1);
					reject(new AggregateError(errors, "Every network probe failed."));
				}
			});
		});
	});
}
//#endregion
