//#region src/electron/ipc/github-release.ts
var execFileAsync$5 = promisify(execFile);
var DEFAULT_GITHUB_HEADERS = {
	"User-Agent": "EgoistShield/Desktop",
	Accept: "application/vnd.github+json"
};
function parseGitHubReleaseApiUrl(releaseApiUrl) {
	const match = releaseApiUrl.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/releases(?:\/latest)?\/?$/i);
	if (!match?.[1] || !match[2]) return null;
	return {
		owner: match[1],
		repo: match[2]
	};
}
function buildGitHubReleasesApiUrl(releaseApiUrl) {
	const parsed = parseGitHubReleaseApiUrl(releaseApiUrl);
	if (!parsed) return null;
	return `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases`;
}
function buildGitHubReleaseTagApiUrl(releaseApiUrl, tagName) {
	const parsed = parseGitHubReleaseApiUrl(releaseApiUrl);
	if (!parsed) return null;
	return `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/tags/${encodeURIComponent(tagName)}`;
}
function buildGitHubReleaseTagPageUrl(releaseApiUrl, tagName) {
	const parsed = parseGitHubReleaseApiUrl(releaseApiUrl);
	if (!parsed) return null;
	return `https://github.com/${parsed.owner}/${parsed.repo}/releases/tag/${encodeURIComponent(tagName)}`;
}
function buildGitHubExpandedAssetsUrl(releaseApiUrl, tagName) {
	const parsed = parseGitHubReleaseApiUrl(releaseApiUrl);
	if (!parsed) return null;
	return `https://github.com/${parsed.owner}/${parsed.repo}/releases/expanded_assets/${encodeURIComponent(tagName)}`;
}
function normalizeVersionTag(value) {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.replace(/^v/i, "");
}
function toVersionTokens(value) {
	return value.trim().replace(/^v/i, "").split(/([0-9]+)/).filter(Boolean).map((part) => /^[0-9]+$/.test(part) ? Number.parseInt(part, 10) : part.toLowerCase());
}
function compareLooseVersions(left, right) {
	const leftTokens = toVersionTokens(left);
	const rightTokens = toVersionTokens(right);
	const length = Math.max(leftTokens.length, rightTokens.length);
	for (let index = 0; index < length; index += 1) {
		const leftToken = leftTokens[index];
		const rightToken = rightTokens[index];
		if (typeof leftToken === "undefined") return typeof rightToken === "number" && rightToken > 0 ? -1 : 0;
		if (typeof rightToken === "undefined") return typeof leftToken === "number" && leftToken > 0 ? 1 : 0;
		if (typeof leftToken === "number" && typeof rightToken === "number") {
			if (leftToken !== rightToken) return leftToken > rightToken ? 1 : -1;
			continue;
		}
		const compared = String(leftToken).localeCompare(String(rightToken), "en", {
			sensitivity: "base",
			numeric: true
		});
		if (compared !== 0) return compared > 0 ? 1 : -1;
	}
	return 0;
}
async function fetchLatestGitHubRelease(releaseApiUrl, headers = DEFAULT_GITHUB_HEADERS) {
	return fetchJsonWithRetry(releaseApiUrl, {
		headers,
		timeoutMs: 15e3,
		retries: 2,
		retryBaseDelayMs: 500
	});
}
async function fetchGitHubReleases(releaseApiUrl, headers = DEFAULT_GITHUB_HEADERS, limit = 20) {
	const releasesApiUrl = buildGitHubReleasesApiUrl(releaseApiUrl);
	if (!releasesApiUrl) throw new Error("Unsupported GitHub release API URL.");
	return fetchJsonWithRetry(`${releasesApiUrl}?per_page=${Math.max(1, Math.min(limit, 100))}`, {
		headers,
		timeoutMs: 15e3,
		retries: 2,
		retryBaseDelayMs: 500
	});
}
async function fetchGitHubReleaseByTag(releaseApiUrl, tagName, headers = DEFAULT_GITHUB_HEADERS) {
	const releaseTagApiUrl = buildGitHubReleaseTagApiUrl(releaseApiUrl, tagName);
	if (!releaseTagApiUrl) throw new Error("Unsupported GitHub release API URL.");
	return fetchJsonWithRetry(releaseTagApiUrl, {
		headers,
		timeoutMs: 15e3,
		retries: 2,
		retryBaseDelayMs: 500
	});
}
function buildGitHubReleasePageUrl(releaseApiUrl) {
	const parsed = parseGitHubReleaseApiUrl(releaseApiUrl);
	if (!parsed) return null;
	return `https://github.com/${parsed.owner}/${parsed.repo}/releases/latest`;
}
function buildGitHubAssetDownloadUrl(releaseApiUrl, tagName, assetName) {
	const parsed = parseGitHubReleaseApiUrl(releaseApiUrl);
	if (!parsed) return null;
	return `https://github.com/${parsed.owner}/${parsed.repo}/releases/download/${encodeURIComponent(tagName)}/${encodeURIComponent(assetName)}`;
}
function extractGitHubTagFromReleaseUrl(url) {
	const match = url.match(/\/releases\/tag\/([^/?#]+)/i);
	return match?.[1] ? decodeURIComponent(match[1]) : null;
}
async function fetchLatestGitHubReleasePageMeta(releaseApiUrl, headers = DEFAULT_GITHUB_HEADERS) {
	const releasePageUrl = buildGitHubReleasePageUrl(releaseApiUrl);
	if (!releasePageUrl) throw new Error("Unsupported GitHub release API URL.");
	const { response, text: html } = await fetchTextWithRetry(releasePageUrl, {
		headers: {
			...headers,
			Accept: "text/html,application/xhtml+xml"
		},
		redirect: "follow",
		timeoutMs: 15e3,
		retries: 2,
		retryBaseDelayMs: 500
	});
	const finalUrl = response.url || releasePageUrl;
	let tagName = extractGitHubTagFromReleaseUrl(finalUrl);
	if (!tagName) {
		const inlineMatch = html.match(/\/releases\/tag\/([^"'?#<>\s]+)/i);
		tagName = inlineMatch?.[1] ? decodeURIComponent(inlineMatch[1]) : null;
	}
	return {
		html_url: tagName ? finalUrl : releasePageUrl,
		tag_name: tagName
	};
}
async function resolveLatestGitHubRelease(releaseApiUrl, headers = DEFAULT_GITHUB_HEADERS) {
	try {
		const release = await fetchLatestGitHubRelease(releaseApiUrl, headers);
		return {
			release,
			html_url: release.html_url?.trim() || buildGitHubReleasePageUrl(releaseApiUrl),
			tag_name: release.tag_name?.trim() || null,
			source: "api"
		};
	} catch (apiError) {
		try {
			return {
				release: null,
				...await fetchLatestGitHubReleasePageMeta(releaseApiUrl, headers),
				source: "release-page"
			};
		} catch (fallbackError) {
			const apiMessage = apiError instanceof Error ? apiError.message : String(apiError);
			const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
			throw new Error(`${apiMessage}; fallback failed: ${fallbackMessage}`);
		}
	}
}
function pickGitHubAsset(release, matchers, excludes = []) {
	const assets = Array.isArray(release.assets) ? release.assets : [];
	for (const matcher of matchers) {
		const asset = assets.find((item) => {
			if (!matcher.test(item.name)) return false;
			return !excludes.some((exclude) => exclude.test(item.name));
		});
		if (asset) return asset;
	}
	return null;
}
async function downloadFileWithProgress(url, destinationPath, onProgress, headers = DEFAULT_GITHUB_HEADERS) {
	await promises.mkdir(path.dirname(destinationPath), { recursive: true });
	const { response } = await fetchWithRetry(url, {
		headers,
		timeoutMs: 6e4,
		retries: 2,
		retryBaseDelayMs: 1e3
	});
	if (!response.ok || !response.body) throw new Error(`Ошибка загрузки (${response.status})`);
	const total = Number.parseInt(response.headers.get("content-length") ?? "0", 10) || 0;
	const fileHandle = await promises.open(destinationPath, "w");
	let transferred = 0;
	try {
		const reader = response.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			await fileHandle.write(Buffer.from(value), 0, value.length, null);
			transferred += value.length;
			onProgress?.({
				percent: total > 0 ? Math.min(100, Math.round(transferred / total * 100)) : 0,
				transferred,
				total
			});
		}
	} catch (error) {
		await promises.rm(destinationPath, { force: true }).catch(() => void 0);
		throw error;
	} finally {
		await fileHandle.close();
	}
	onProgress?.({
		percent: 100,
		transferred,
		total
	});
}
async function downloadText(url, headers = DEFAULT_GITHUB_HEADERS) {
	const { text } = await fetchTextWithRetry(url, {
		headers,
		timeoutMs: 2e4,
		retries: 2,
		retryBaseDelayMs: 500
	});
	return text;
}
function quotePowerShellLiteral$1(value) {
	return `'${value.replace(/'/g, "''")}'`;
}
function buildChecksumCandidateAssetNames(assetName) {
	const exactCandidates = [
		`${assetName}.sha256`,
		`${assetName}.sha256.txt`,
		`${assetName}.sha256sum`,
		`${assetName}.sha256sum.txt`,
		`${assetName}.sha256sums`,
		`${assetName}.dgst`
	];
	const genericCandidates = [
		"checksums.txt",
		"checksum.txt",
		"checksums.sha256",
		"checksum.sha256",
		"sha256sum.txt",
		"sha256sums.txt",
		"SHA256SUMS",
		"SHA256SUMS.txt",
		"sha256.txt"
	];
	return [.../* @__PURE__ */ new Set([...exactCandidates, ...genericCandidates])];
}
function pickGitHubChecksumAsset(release, assetName) {
	const assets = Array.isArray(release.assets) ? release.assets : [];
	const candidates = new Set(buildChecksumCandidateAssetNames(assetName).map((item) => item.toLowerCase()));
	const exactMatch = assets.find((item) => candidates.has(item.name.toLowerCase()));
	if (exactMatch) return exactMatch;
	return assets.find((item) => /(^|[-_.])(sha256|sha256sum|checksums?)([-_.]|$)|\.dgst$/i.test(item.name)) ?? null;
}
function extractSha256FromChecksumText(checksumText, assetName) {
	const normalizedAssetName = assetName.trim().toLowerCase();
	const lines = checksumText.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const opensslStyle = trimmed.match(/^SHA256\s*\((.+)\)\s*=\s*([a-f0-9]{64})$/i);
		if (opensslStyle?.[1] && opensslStyle[2] && opensslStyle[1].trim().toLowerCase() === normalizedAssetName) return opensslStyle[2].toLowerCase();
		const checksumList = trimmed.match(/^([a-f0-9]{64})\s+[* ]?(.+)$/i);
		if (checksumList?.[1] && checksumList[2]) {
			if (checksumList[2].trim().replace(/^\.\//, "").toLowerCase() === normalizedAssetName) return checksumList[1].toLowerCase();
		}
	}
	const allHashes = [...checksumText.matchAll(/\b([a-f0-9]{64})\b/gi)].map((match) => match[1]?.toLowerCase()).filter(Boolean);
	if (allHashes.length === 1) return allHashes[0] ?? null;
	return null;
}
function extractSha256FromGitHubAssetDigest(digest) {
	if (!digest) return null;
	const match = digest.trim().match(/^(?:sha256:)?([a-f0-9]{64})$/i);
	return match?.[1] ? match[1].toLowerCase() : null;
}
function escapeRegularExpression(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* GitHub renders every release asset with an exact asset-specific digest in
* the public expanded-assets fragment. This HTML endpoint remains available
* when the unauthenticated REST quota is exhausted, so it is a useful
* fail-closed fallback for API HTTP 403. The asset name is matched inside the
* digest control itself; a hash belonging to a neighbouring asset is rejected.
*/
function extractSha256FromGitHubExpandedAssetsHtml(html, assetName) {
	const normalizedAssetName = assetName.trim();
	if (!/^[A-Za-z0-9._-]{1,255}$/.test(normalizedAssetName)) return null;
	const assetPattern = escapeRegularExpression(normalizedAssetName);
	return new RegExp(`aria-label=["']Copy to clipboard digest for ${assetPattern}["'][^>]*\\bvalue=["']sha256:([a-f0-9]{64})["']`, "i").exec(html)?.[1]?.toLowerCase() ?? null;
}
async function fetchGitHubReleaseAssetSha256(options) {
	const { assetName, headers = DEFAULT_GITHUB_HEADERS, releaseApiUrl, tagName } = options;
	const expandedAssetsUrl = buildGitHubExpandedAssetsUrl(releaseApiUrl, tagName);
	if (!expandedAssetsUrl) throw new Error("Unsupported GitHub release API URL.");
	const { text: html } = await fetchTextWithRetry(expandedAssetsUrl, {
		headers: {
			...headers,
			Accept: "text/html,application/xhtml+xml"
		},
		redirect: "follow",
		timeoutMs: 15e3,
		retries: 2,
		retryBaseDelayMs: 500,
		maxBytes: 2 * 1024 * 1024
	});
	const sha256 = extractSha256FromGitHubExpandedAssetsHtml(html, assetName);
	if (!sha256) throw new Error(`GitHub expanded assets не содержит SHA-256 для ${assetName}.`);
	return sha256;
}
async function computeFileSha256(filePath) {
	const hash = createHash("sha256");
	await new Promise((resolve, reject) => {
		const stream = createReadStream(filePath);
		stream.on("data", (chunk) => {
			hash.update(chunk);
		});
		stream.on("error", reject);
		stream.on("end", () => resolve());
	});
	return hash.digest("hex");
}
async function verifyFileSha256(filePath, expectedSha256) {
	const normalizedExpected = expectedSha256.trim().toLowerCase();
	const actualSha256 = await computeFileSha256(filePath);
	const verified = actualSha256 === normalizedExpected;
	return {
		verified,
		integritySource: "sha256",
		verificationMessage: verified ? "SHA-256 checksum подтверждён." : "SHA-256 checksum не совпадает с опубликованным значением.",
		expectedSha256: normalizedExpected,
		actualSha256
	};
}
async function verifyGitHubReleaseAssetChecksum(options) {
	const { assetDigest, assetName, filePath, headers = DEFAULT_GITHUB_HEADERS, release, releaseApiUrl, tagName } = options;
	const expectedSha256FromDigest = extractSha256FromGitHubAssetDigest(assetDigest);
	if (expectedSha256FromDigest) return verifyFileSha256(filePath, expectedSha256FromDigest);
	let lastChecksumError = null;
	try {
		return verifyFileSha256(filePath, await fetchGitHubReleaseAssetSha256({
			releaseApiUrl,
			tagName,
			assetName,
			headers
		}));
	} catch (error) {
		lastChecksumError = error instanceof Error ? error.message : String(error);
	}
	const checksumCandidates = buildChecksumCandidateAssetNames(assetName);
	const checksumUrls = [];
	const checksumAsset = release ? pickGitHubChecksumAsset(release, assetName) : null;
	if (checksumAsset?.browser_download_url) checksumUrls.push(checksumAsset.browser_download_url);
	for (const candidate of checksumCandidates) {
		const candidateUrl = buildGitHubAssetDownloadUrl(releaseApiUrl, tagName, candidate);
		if (candidateUrl) checksumUrls.push(candidateUrl);
	}
	const uniqueUrls = [...new Set(checksumUrls)];
	for (const checksumUrl of uniqueUrls) try {
		const expectedSha256 = extractSha256FromChecksumText(await downloadText(checksumUrl, headers), assetName);
		if (!expectedSha256) {
			lastChecksumError = `В файле checksum нет SHA-256 для ${assetName}.`;
			continue;
		}
		return verifyFileSha256(filePath, expectedSha256);
	} catch (error) {
		lastChecksumError = error instanceof Error ? error.message : String(error);
	}
	return {
		verified: false,
		integritySource: "none",
		verificationMessage: lastChecksumError ?? `Не найден опубликованный checksum для ${assetName}, обновление заблокировано.`
	};
}
async function extractZipArchive(zipPath, destinationPath) {
	await promises.mkdir(destinationPath, { recursive: true });
	await execFileAsync$5(resolveWindowsExecutable("powershell.exe"), [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		`Expand-Archive -LiteralPath ${quotePowerShellLiteral$1(zipPath)} -DestinationPath ${quotePowerShellLiteral$1(destinationPath)} -Force`
	], { windowsHide: true });
}
async function readVersionFile(versionPath) {
	try {
		return (await promises.readFile(versionPath, "utf8")).trim() || null;
	} catch {
		return null;
	}
}
//#endregion
