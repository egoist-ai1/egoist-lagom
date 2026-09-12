//#region src/electron/ipc/protected-runtime-root.ts
var PRODUCT_DATA_DIRECTORY = "EgoistShield";
var RUNTIME_DIRECTORY = "Runtime";
var PROTECTED_COMPONENTS = /* @__PURE__ */ new Set([
	"SystemDoH",
	"Zapret",
	"TelegramProxy"
]);
/**
* Resolve the machine-wide root consumed by LocalSystem services.
*
* A packaged build must not place service executables, WinSW XML or mutable
* service configuration below Electron userData: a standard user could replace
* those files before the next SCM start. Development keeps the historic local
* layout so tests never mutate machine-wide state.
*/
function resolveProtectedRuntimeRoot(options) {
	if (!options.packaged) return path.join(options.userDataDir, "runtime");
	const programDataDir = options.programDataDir?.trim();
	if (!programDataDir || !path.isAbsolute(programDataDir)) throw new Error("ProgramData не определён: запуск фоновых служб остановлен, чтобы не размещать LocalSystem runtime в пользовательском каталоге.");
	return path.join(path.resolve(programDataDir), PRODUCT_DATA_DIRECTORY, RUNTIME_DIRECTORY);
}
function resolveProtectedComponentRoot(runtimeRoot, component) {
	if (!PROTECTED_COMPONENTS.has(component)) throw new Error(`Неизвестный защищённый компонент: ${String(component)}`);
	const normalizedRuntimeRoot = path.resolve(runtimeRoot);
	const componentRoot = path.resolve(normalizedRuntimeRoot, component);
	const relative = path.relative(normalizedRuntimeRoot, componentRoot);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Некорректный путь защищённого компонента: ${String(component)}`);
	return componentRoot;
}
//#endregion
