import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const metadataOnly = args.includes("--metadata-only");
const trustDirectory = path.join(root, "trust");
const registryBytes = fs.readFileSync(path.join(trustDirectory, "release-key-registry.json"));
const registrySignature = Buffer.from(fs.readFileSync(path.join(trustDirectory, "release-key-registry.json.sig"), "utf8").trim(), "base64");
const rootKey = createPublicKey(fs.readFileSync(path.join(trustDirectory, "root-public-key.pem")));
if (!verify(null, registryBytes, rootKey, registrySignature)) throw new Error("Release key registry signature is invalid.");
const registry = JSON.parse(registryBytes.toString("utf8"));

if (metadataOnly) {
  const fingerprints = JSON.parse(fs.readFileSync(path.join(trustDirectory, "key-fingerprints.json"), "utf8"));
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
  if (fingerprints.rootKeySha256 !== sha256(fs.readFileSync(path.join(trustDirectory, "root-public-key.pem")))) {
    throw new Error("Root key fingerprint does not match the published PEM.");
  }
  const releaseFingerprints = new Map(fingerprints.releaseKeys.map(key => [key.id, key.publicKeySha256]));
  if (fingerprints.releaseKeys.length !== registry.keys.length || registry.keys.some(key => releaseFingerprints.get(key.id) !== sha256(key.publicKeyPem))) {
    throw new Error("Release key fingerprints do not match the signed registry.");
  }
  for (const required of ["README.md", "SECURITY.md", "PRIVACY.md", "LICENSE.txt", "THIRD-PARTY-NOTICES.txt"]) {
    if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing ${required}`);
  }
  const tracked = fs.readdirSync(root, { recursive: true }).map(String);
  if (tracked.some((name) => /private|\.p8$|\.pk8$|\.key$/i.test(name))) throw new Error("Private-key-like file is present in metadata repository.");
  console.log(JSON.stringify({ ok: true, mode: "metadata", trustedKeys: registry.keys.length }));
  process.exit(0);
}

const assets = path.resolve(root, args.find((arg) => !arg.startsWith("--")) || "release-assets");
const manifestBytes = fs.readFileSync(path.join(assets, "release-manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.schemaVersion !== 2 || manifest.channel !== "stable") throw new Error("Unsupported release manifest.");
if (process.env.RELEASE_TAG && manifest.tag !== process.env.RELEASE_TAG) throw new Error("Tag mismatch.");
const key = registry.keys.find((item) => item.id === manifest.keyId && item.status === "trusted");
if (!key) throw new Error("Unknown or revoked release key.");
const signature = Buffer.from(fs.readFileSync(path.join(assets, "release-manifest.json.sig"), "utf8").trim(), "base64");
if (!verify(null, manifestBytes, createPublicKey(key.publicKeyPem), signature)) throw new Error("Manifest signature is invalid.");
const setup = fs.readFileSync(path.join(assets, manifest.installerName));
if (setup.length !== manifest.size) throw new Error("Setup size mismatch.");
for (const algorithm of ["sha256", "sha512"]) {
  const actual = createHash(algorithm).update(setup).digest("hex");
  if (actual !== manifest[algorithm]) throw new Error(`${algorithm} mismatch.`);
}
console.log(JSON.stringify({ ok: true, version: manifest.version, keyId: manifest.keyId, sha256: manifest.sha256 }));

