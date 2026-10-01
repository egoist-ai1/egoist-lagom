//#region src/electron/app-paths.ts
function detectRuntimeEnvironment({ isPackaged, nodeEnv }) {
	if (isPackaged) return "production";
	if (nodeEnv === "test") return "test";
	return "development";
}
function buildAppPathConfig({ defaultUserDataDir, environment, pid, testUserDataDir }) {
	if (environment === "test" && testUserDataDir && !path.isAbsolute(testUserDataDir)) throw new Error("Test user data path must be absolute.");
	const userDataDir = environment === "test" ? testUserDataDir || `${defaultUserDataDir}-test-${pid}` : environment === "development" ? `${defaultUserDataDir}-dev` : defaultUserDataDir;
	return {
		environment,
		userDataDir,
		sessionDataDir: environment === "production" ? null : path.join(userDataDir, "session"),
		logsDir: path.join(userDataDir, "logs")
	};
}
//#endregion
