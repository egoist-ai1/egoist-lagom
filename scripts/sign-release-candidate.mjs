import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const directory = path.resolve(process.argv[2] || "candidate");
const tag = process.argv[3] || process.env.RELEASE_TAG || "";
if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("A canonical vX.Y.Z tag is required.");
const version = tag.slice(1);
const installerName = `EgoistShield-Setup-${version}.exe`;
const installerPath = path.join(directory, installerName);
if (!fs.existsSync(installerPath)) throw new Error(`Missing ${installerName}`);
const privatePem = process.env.EGOISTSHIELD_RELEASE_PRIVATE_KEY_PEM;
if (!privatePem?.includes("BEGIN PRIVATE KEY")) throw new Error("Release signing secret is missing.");
const keyId = process.env.EGOISTSHIELD_RELEASE_KEY_ID || "release-2026-09";
const privateKey = createPrivateKey(privatePem);
const trustDirectory = path.resolve("trust");
const registryBytes = fs.readFileSync(path.join(trustDirectory, "release-key-registry.json"));
const registrySignature = Buffer.from(fs.readFileSync(path.join(trustDirectory, "release-key-registry.json.sig"), "utf8").trim(), "base64");
const rootKey = createPublicKey(fs.readFileSync(path.join(trustDirectory, "root-public-key.pem")));
if (!verify(null, registryBytes, rootKey, registrySignature)) throw new Error("Release key registry signature is invalid.");
const key = JSON.parse(registryBytes).keys.find(item => item.id === keyId && item.status === "trusted");
if (!key || key.algorithm !== "Ed25519" || privateKey.asymmetricKeyType !== "ed25519") throw new Error("Unknown or unsupported release signing key.");
const now = Date.now();
if (!(Date.parse(key.notBefore) <= now && now < Date.parse(key.notAfter))) throw new Error("Release signing key is outside its validity period.");
const actualPublicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" });
const expectedPublicKey = createPublicKey(key.publicKeyPem).export({ type: "spki", format: "der" });
if (!actualPublicKey.equals(expectedPublicKey)) throw new Error("Release signing secret does not match the selected registry key.");
const bytes = fs.readFileSync(installerPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const sha512 = createHash("sha512").update(bytes).digest("hex");
const manifest = {
  schemaVersion: 2,
  channel: "stable",
  version,
  tag,
  installerName,
  canonicalDownloadUrl: `https://github.com/egoist-ai1/egoistshield/releases/download/${tag}/${installerName}`,
  size: bytes.length,
  sha256,
  sha512,
  githubDigest: `sha256:${sha256}`,
  minimumAppVersion: "3.6.1",
  keyId,
  authenticodeStatus: "not-signed",
  licenseVersion: "1.0",
  publishedAt: new Date().toISOString()
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const signature = `${sign(null, manifestBytes, privateKey).toString("base64")}\n`;
for (const name of ["release-manifest.json", "stable-channel.json"]) {
  fs.writeFileSync(path.join(directory, name), manifestBytes);
}
for (const name of ["release-manifest.json.sig", "stable-channel.json.sig"]) {
  fs.writeFileSync(path.join(directory, name), signature, "utf8");
}
fs.writeFileSync(`${installerPath}.sha256`, `${sha256}  ${installerName}\n`, "utf8");
console.log(JSON.stringify({ ok: true, version, keyId: manifest.keyId, size: bytes.length, sha256 }));

