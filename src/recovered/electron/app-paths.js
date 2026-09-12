//#region src/electron/app-paths.ts
function detectRuntimeEnvironment({ isPackaged, nodeEnv }) {
	if (nodeEnv === "test") return "test";
	if (!isPackaged) return "development";
	return "production";
}
function buildAppPathConfig({ defaultUserDataDir, environment, pid }) {
	const userDataDir = environment === "test" ? `${defaultUserDataDir}-test-${pid}` : environment === "development" ? `${defaultUserDataDir}-dev` : defaultUserDataDir;
	return {
		environment,
		userDataDir,
		sessionDataDir: environment === "production" ? null : path.join(userDataDir, "session"),
		logsDir: path.join(userDataDir, "logs")
	};
}
//#endregion
