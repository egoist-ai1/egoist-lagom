var APP_RELEASE_OWNER = "egoist-ai1";
var APP_RELEASE_REPOSITORY = "egoist-lagom";
var APP_RELEASE_API_URL = `https://api.github.com/repos/${APP_RELEASE_OWNER}/${APP_RELEASE_REPOSITORY}/releases/latest`;
var APP_RELEASE_PAGE_URL = `https://github.com/${APP_RELEASE_OWNER}/${APP_RELEASE_REPOSITORY}/releases/latest`;
var STABLE_CHANNEL_URL = `https://github.com/${APP_RELEASE_OWNER}/${APP_RELEASE_REPOSITORY}/releases/latest/download/stable-channel.json`;
var STABLE_CHANNEL_SIGNATURE_URL = `${STABLE_CHANNEL_URL}.sig`;
var UPDATE_MAX_BYTES = 1024 * 1024 * 1024;
var DOWNLOAD_TIMEOUT_MS = 1200 * 1e3;
var DOWNLOAD_IDLE_TIMEOUT_MS = 30 * 1e3;
var DOWNLOAD_ATTEMPTS = 3;
var ALLOWED_REDIRECT_HOSTS = /* @__PURE__ */ new Set([
  "github.com",
  "objects.githubusercontent.com",
  "objects-origin.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "release-assets.githubusercontent.com"
]);
var UpdaterError = class extends Error {
  code;
  retryable;
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.name = "UpdaterError";
  }
};
function emit(options, progress) {
  options.onProgress?.(progress);
}
function mapUnknownError(error) {
  if (error instanceof UpdaterError) return error;
  const network = getNetworkErrorDetails(error);
  if (network.kind === "timeout") return new UpdaterError("timeout", "\u0421\u0435\u0440\u0432\u0435\u0440 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0439 \u043D\u0435 \u043E\u0442\u0432\u0435\u0442\u0438\u043B \u0432\u043E\u0432\u0440\u0435\u043C\u044F. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.", true);
  if (network.kind === "network" || network.kind === "offline") return new UpdaterError("offline", "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C\u0441\u044F \u043A \u043A\u0430\u043D\u0430\u043B\u0443 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0439. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442, DNS \u0438 proxy.", true);
  if (network.kind === "http" && network.status === 404) return new UpdaterError("release-not-found", "\u041F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u0439 stable-\u0440\u0435\u043B\u0438\u0437 \u043F\u043E\u043A\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D.", true);
  return new UpdaterError("unknown", "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u043F\u044B\u0442\u043A\u0443 \u0438\u043B\u0438 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0436\u0443\u0440\u043D\u0430\u043B.", true);
}
function failureResult(currentVersion, error) {
  const mapped = mapUnknownError(error);
  return {
    ok: false,
    phase: [
      "manifest-missing",
      "manifest-invalid",
      "signature-invalid",
      "key-unknown",
      "key-revoked",
      "anti-rollback",
      "candidate-mismatch",
      "redirect-blocked",
      "integrity-failed"
    ].includes(mapped.code) ? "blocked" : "failed",
    currentVersion,
    message: mapped.message,
    failureCode: mapped.code,
    retryable: mapped.retryable
  };
}
function candidateEquals(left, right) {
  return left.version === right.version && left.tag === right.tag && left.assetName === right.assetName && left.assetUrl === right.assetUrl && left.size === right.size && left.sha256 === right.sha256 && left.sha512 === right.sha512 && left.githubDigest === right.githubDigest && left.manifestDigest === right.manifestDigest && left.keyId === right.keyId;
}
function buildCandidate(trust, releaseUrl) {
  const manifest = trust.manifest;
  if (trust.trustStatus !== "trusted" || !trust.manifestVerified || !manifest || !trust.manifestDigest || !trust.keyId) throw new UpdaterError("signature-invalid", "\u0420\u0435\u043B\u0438\u0437 \u043D\u0435 \u043F\u0440\u043E\u0448\u0451\u043B \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443 Ed25519 \u0438 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D.");
  return {
    version: manifest.version,
    tag: manifest.tag,
    assetName: manifest.installerName,
    assetUrl: manifest.canonicalDownloadUrl,
    size: manifest.size,
    sha256: manifest.sha256,
    sha512: manifest.sha512,
    githubDigest: manifest.githubDigest,
    manifestDigest: trust.manifestDigest,
    channel: "stable",
    keyId: manifest.keyId,
    authenticodeStatus: manifest.authenticodeStatus,
    publishedAt: manifest.publishedAt,
    releaseUrl
  };
}
async function computeFileDigest(filePath, algorithm) {
  const hash = createHash(algorithm);
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}
function assertCanonicalCandidateUrl(candidate) {
  const url = new URL(candidate.assetUrl);
  const expectedPath = `/${APP_RELEASE_OWNER}/${APP_RELEASE_REPOSITORY}/releases/download/${candidate.tag}/${candidate.assetName}`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expectedPath || url.search || url.hash) throw new UpdaterError("candidate-mismatch", "\u0410\u0434\u0440\u0435\u0441 Setup \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u0435\u0442 \u0441 \u0434\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u044B\u043C release channel.");
}
function buildProtectedUpdaterLaunch(candidate, options, finalPath) {
  const updatesDir = path.dirname(finalPath);
  const installerResources = path.join(options.resourcesPath, "installer");
  return {
    manifestPath: path.join(updatesDir, "package-integrity.json"),
    manifest: {
      schemaVersion: 1,
      product: "Egoist Lagom",
      version: candidate.version,
      installer: {
        path: `updates/${candidate.assetName}`,
        bytes: candidate.size,
        sha256: candidate.sha256.toUpperCase()
      }
    },
    helperPath: path.join(installerResources, "invoke-final-silent-reinstall.ps1"),
    uiPath: path.join(installerResources, "ModernInstaller.exe"),
    fontPath: path.join(installerResources, "Unbounded.ttf"),
    signalPath: path.join(updatesDir, "handoff-started.flag")
  };
}
