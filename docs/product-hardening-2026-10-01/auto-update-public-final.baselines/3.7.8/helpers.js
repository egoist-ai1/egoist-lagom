function parseGitHubReleaseApiUrl(releaseApiUrl) {
  const match = releaseApiUrl.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/releases(?:\/latest)?\/?$/i);
  if (!match?.[1] || !match[2]) return null;
  return {
    owner: match[1],
    repo: match[2]
  };
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

function buildGitHubAssetDownloadUrl(releaseApiUrl, tagName, assetName) {
  const parsed = parseGitHubReleaseApiUrl(releaseApiUrl);
  if (!parsed) return null;
  return `https://github.com/${parsed.owner}/${parsed.repo}/releases/download/${encodeURIComponent(tagName)}/${encodeURIComponent(assetName)}`;
}

function extractSha256FromGitHubAssetDigest(digest) {
  if (!digest) return null;
  const match = digest.trim().match(/^(?:sha256:)?([a-f0-9]{64})$/i);
  return match?.[1] ? match[1].toLowerCase() : null;
}
