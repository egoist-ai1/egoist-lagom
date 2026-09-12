//#region src/electron/window-ux-policy.ts
var VISIBLE_WINDOW_EDGE = 96;
function finiteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}
function normalizeArea(area) {
	return {
		x: Math.round(area.x),
		y: Math.round(area.y),
		width: Math.max(1, Math.round(area.width)),
		height: Math.max(1, Math.round(area.height))
	};
}
function intersectionSize(a, b) {
	return {
		width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
		height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
	};
}
function isWindowBoundsVisible(bounds, workAreas) {
	return workAreas.some((area) => {
		const intersection = intersectionSize(bounds, normalizeArea(area));
		return intersection.width >= Math.min(VISIBLE_WINDOW_EDGE, bounds.width) && intersection.height >= Math.min(VISIBLE_WINDOW_EDGE, bounds.height);
	});
}
function centerWindowBounds(area, defaults) {
	const normalizedArea = normalizeArea(area);
	const width = Math.min(normalizedArea.width, Math.max(defaults.minWidth, defaults.width));
	const height = Math.min(normalizedArea.height, Math.max(defaults.minHeight, defaults.height));
	return {
		x: normalizedArea.x + Math.max(0, Math.round((normalizedArea.width - width) / 2)),
		y: normalizedArea.y + Math.max(0, Math.round((normalizedArea.height - height) / 2)),
		width,
		height
	};
}
function normalizeWindowState(raw, workAreas, defaults) {
	const primaryArea = normalizeArea(workAreas[0] ?? {
		x: 0,
		y: 0,
		width: defaults.width,
		height: defaults.height
	});
	const record = raw && typeof raw === "object" ? raw : {};
	const rawBounds = record.bounds && typeof record.bounds === "object" ? record.bounds : {};
	const x = finiteNumber(rawBounds.x);
	const y = finiteNumber(rawBounds.y);
	const width = finiteNumber(rawBounds.width);
	const height = finiteNumber(rawBounds.height);
	const candidate = x != null && y != null && width != null && height != null ? {
		x,
		y,
		width: Math.max(defaults.minWidth, width),
		height: Math.max(defaults.minHeight, height)
	} : null;
	return {
		bounds: candidate && isWindowBoundsVisible(candidate, workAreas) ? candidate : centerWindowBounds(primaryArea, defaults),
		widgetMode: record.widgetMode !== false,
		maximized: typeof record.maximized === "boolean" ? record.maximized : true
	};
}
function loadWindowState(filePath, workAreas, defaults) {
	try {
		return normalizeWindowState(JSON.parse(fs.readFileSync(filePath, "utf8")), workAreas, defaults);
	} catch {
		return normalizeWindowState(null, workAreas, defaults);
	}
}
function persistWindowState(filePath, state) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.${process.pid}.tmp`;
	fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	fs.renameSync(tempPath, filePath);
}
function isRendererZoomShortcut(input) {
	if (!input.control && !input.meta || input.alt) return false;
	const key = String(input.key ?? "").toLowerCase();
	const code = String(input.code ?? "").toLowerCase();
	return [
		"+",
		"=",
		"-",
		"_",
		"0"
	].includes(key) || [
		"numpadadd",
		"numpadsubtract",
		"digit0"
	].includes(code);
}
//#endregion
