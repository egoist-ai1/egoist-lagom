//#region src/shared/speed-test.ts
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
function round(value, digits = 2) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}
function percentile(values, fraction) {
	const sorted = [...values.filter(Number.isFinite)].sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	if (sorted.length === 1) return sorted[0];
	const index = clamp(fraction, 0, 1) * (sorted.length - 1);
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) return sorted[lower];
	const weight = index - lower;
	return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}
function summarizeBandwidth(samples) {
	const valid = samples.filter((sample) => Number.isFinite(sample.mbps) && sample.mbps > 0 && Number.isFinite(sample.bytes) && sample.bytes > 0 && Number.isFinite(sample.timeMs) && sample.timeMs > 0);
	if (valid.length === 0) throw new Error("Нет валидных выборок пропускной способности.");
	const speeds = valid.map((sample) => sample.mbps);
	const average = speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
	const variance = speeds.reduce((sum, value) => sum + (value - average) ** 2, 0) / speeds.length;
	const coefficientOfVariation = average > 0 ? Math.sqrt(variance) / average : 1;
	return {
		mbps: round(percentile(speeds, .5) ?? average),
		averageMbps: round(average),
		p90Mbps: round(percentile(speeds, .9) ?? average),
		minMbps: round(Math.min(...speeds)),
		maxMbps: round(Math.max(...speeds)),
		stabilityPercent: Math.round(clamp(100 - coefficientOfVariation * 100, 0, 100)),
		bytes: valid.reduce((sum, sample) => sum + sample.bytes, 0),
		timeMs: valid.reduce((sum, sample) => sum + sample.timeMs, 0),
		samples: speeds.map((value) => round(value))
	};
}
function summarizeLatency(samples, attempts) {
	const valid = samples.filter((value) => Number.isFinite(value) && value >= 0);
	const successiveDifferences = valid.slice(1).map((value, index) => Math.abs(value - valid[index]));
	const sampleLossPercent = attempts > 0 ? (attempts - valid.length) / attempts * 100 : 0;
	return {
		latencyMs: valid.length > 0 ? round(percentile(valid, .5) ?? valid[0], 1) : null,
		jitterMs: successiveDifferences.length > 0 ? round(successiveDifferences.reduce((sum, value) => sum + value, 0) / successiveDifferences.length, 1) : null,
		minMs: valid.length > 0 ? round(Math.min(...valid), 1) : null,
		maxMs: valid.length > 0 ? round(Math.max(...valid), 1) : null,
		sampleLossPercent: round(clamp(sampleLossPercent, 0, 100), 1),
		samples: valid.map((value) => round(value, 1)),
		attempts: Math.max(0, attempts)
	};
}
function buildSpeedQualitySummary(input) {
	const bandwidthStability = input.upload ? (input.download.stabilityPercent + input.upload.stabilityPercent) / 2 : input.download.stabilityPercent;
	const latency = input.idleLatency.latencyMs ?? 250;
	const loadedLatency = Math.max(input.downloadLoadedLatency?.latencyMs ?? latency, input.uploadLoadedLatency?.latencyMs ?? latency);
	const sampleLoss = Math.max(input.idleLatency.sampleLossPercent, input.downloadLoadedLatency?.sampleLossPercent ?? 0, input.uploadLoadedLatency?.sampleLossPercent ?? 0);
	let score = bandwidthStability;
	score -= clamp((latency - 20) * .16, 0, 22);
	score -= clamp((loadedLatency - latency - 25) * .08, 0, 22);
	score -= sampleLoss * 1.8;
	score -= input.partialErrors * 8;
	score = Math.round(clamp(score, 0, 100));
	const grade = score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "poor";
	const MIN_HIGH_CONFIDENCE_DURATION_MS = 5e3;
	const hasLoadedLatency = (input.downloadLoadedLatency?.samples.length ?? 0) > 0 || (input.uploadLoadedLatency?.samples.length ?? 0) > 0;
	const durationMs = input.measurementDurationMs ?? 0;
	const confidenceReasons = [];
	if (input.download.samples.length < 3) confidenceReasons.push("мало выборок скачивания");
	if ((input.upload?.samples.length ?? 0) < 3) confidenceReasons.push("мало выборок отдачи");
	if (input.idleLatency.samples.length < 8) confidenceReasons.push("мало проб задержки");
	if (input.idleLatency.sampleLossPercent > 0) confidenceReasons.push("были срывы HTTPS-проб");
	if (input.partialErrors > 0) confidenceReasons.push("часть фаз не завершилась");
	if (!hasLoadedLatency) confidenceReasons.push("задержка под нагрузкой не измерена");
	if (durationMs > 0 && durationMs < MIN_HIGH_CONFIDENCE_DURATION_MS) confidenceReasons.push("измерение короче устойчивого окна");
	const confidence = confidenceReasons.length === 0 ? "high" : input.download.samples.length >= 2 && input.idleLatency.samples.length >= 4 ? "medium" : "low";
	return {
		score,
		grade,
		confidence,
		confidenceReasons,
		measurementDurationMs: durationMs || null,
		providerCount: input.providerCount ?? null
	};
}
//#endregion
