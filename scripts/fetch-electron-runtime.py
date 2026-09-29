"""Fetch once, then verify the pinned Electron runtime without network access."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

MAX_METADATA = 2 * 1024 * 1024
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_EXTRACTED = 1024 * 1024 * 1024
MAX_ENTRIES = 5000
ALLOWED_HOSTS = {"api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}


def ordinary(path, directory=False):
    value = path.lstat()
    if getattr(value, "st_file_attributes", 0) & 0x400 or stat.S_ISLNK(value.st_mode):
        raise ValueError("Runtime paths must not be links: " + str(path))
    if directory:
        if not stat.S_ISDIR(value.st_mode):
            raise ValueError("Runtime path must be a directory: " + str(path))
    elif not stat.S_ISREG(value.st_mode) or value.st_nlink != 1:
        raise ValueError("Runtime input must be an ordinary file: " + str(path))
    return value


def ordinary_parents(path):
    for parent in [*path.parents, path]:
        if parent.exists() or parent.is_symlink():
            ordinary(parent, directory=True)


def sha256_file(path):
    ordinary(path)
    result = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def safe_zip_name(name):
    if not name or "\\" in name or "\0" in name or name.startswith("/"):
        raise ValueError("Unsafe ZIP path: " + repr(name))
    parts = name.rstrip("/").split("/")
    reserved = re.compile(r"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", re.I)
    if any(part in {"", ".", ".."} or ":" in part or part.endswith((".", " ")) or reserved.match(part) or any(ord(character) < 32 for character in part) for part in parts):
        raise ValueError("Unsafe ZIP path: " + repr(name))
    return PurePosixPath(*parts).as_posix()


def load_pin(path):
    ordinary(path)
    if path.stat().st_size > MAX_METADATA:
        raise ValueError("Runtime descriptor is too large")
    pin = json.loads(path.read_text(encoding="utf-8"))
    if pin.get("schemaVersion") != 1 or not re.fullmatch(r"\d+\.\d+\.\d+", pin.get("version", "")) or pin.get("platform") != "win32" or pin.get("arch") != "x64":
        raise ValueError("Unsupported pinned Electron descriptor")
    version = pin["version"]
    if pin.get("releaseUrl") != f"https://github.com/electron/electron/releases/tag/v{version}" or pin.get("releaseApiUrl") != f"https://api.github.com/repos/electron/electron/releases/tags/v{version}":
        raise ValueError("Electron release must be official and version-pinned")
    for field, name in [("asset", f"electron-v{version}-win32-x64.zip"), ("shasums", "SHASUMS256.txt")]:
        value = pin[field]
        limit = MAX_ARCHIVE if field == "asset" else MAX_METADATA
        if value.get("name") != name or value.get("url") != f"https://github.com/electron/electron/releases/download/v{version}/{name}" or not re.fullmatch(r"[a-f0-9]{64}", value.get("sha256", "")) or not isinstance(value.get("bytes"), int) or not 0 < value["bytes"] <= limit:
            raise ValueError("Invalid pinned Electron " + field)
    if not pin.get("requiredFiles") or any(safe_zip_name(name) != name for name in pin["requiredFiles"]):
        raise ValueError("Invalid required runtime files")
    return pin


def verify_release_metadata(pin, metadata):
    if metadata.get("id") != pin["releaseId"] or metadata.get("tag_name") != "v" + pin["version"] or metadata.get("published_at") != pin["publishedAt"] or metadata.get("draft") is not False or metadata.get("prerelease") is not False:
        raise ValueError("Official Electron release identity mismatch")
    for field in ["asset", "shasums"]:
        expected = pin[field]
        matches = [asset for asset in metadata.get("assets", []) if asset.get("name") == expected["name"]]
        if len(matches) != 1:
            raise ValueError("Official Electron asset is missing or ambiguous")
        asset = matches[0]
        if asset.get("id") != expected["id"] or asset.get("size") != expected["bytes"] or asset.get("digest") != "sha256:" + expected["sha256"] or asset.get("browser_download_url") != expected["url"]:
            raise ValueError("Official GitHub asset.digest/identity mismatch")


def verify_shasums(pin, payload):
    if len(payload) != pin["shasums"]["bytes"] or hashlib.sha256(payload).hexdigest() != pin["shasums"]["sha256"]:
        raise ValueError("Pinned SHASUMS256 checksum mismatch")
    matches = []
    for line in payload.decode("ascii").splitlines():
        match = re.fullmatch(r"([a-fA-F0-9]{64})\s+\*?(.+)", line)
        if match and match.group(2) == pin["asset"]["name"]:
            matches.append(match.group(1).lower())
    if matches != [pin["asset"]["sha256"]]:
        raise ValueError("Official Electron archive SHASUMS256 mismatch")


def zip_inventory(archive, pin):
    entries = archive.infolist()
    if len(entries) > MAX_ENTRIES or sum(entry.file_size for entry in entries) > MAX_EXTRACTED:
        raise ValueError("Electron ZIP exceeds extraction limits")
    seen = set()
    files = []
    for entry in entries:
        name = safe_zip_name(entry.filename)
        key = name.casefold()
        if key in seen:
            raise ValueError("Duplicate/colliding Electron ZIP path: " + name)
        seen.add(key)
        mode = (entry.external_attr >> 16) & 0xFFFF
        kind = stat.S_IFMT(mode)
        if kind not in {0, stat.S_IFREG, stat.S_IFDIR} or (entry.create_system == 0 and entry.external_attr & 0x400) or entry.flag_bits & 1 or entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
            raise ValueError("Linked/encrypted/unsupported Electron ZIP entry: " + name)
        if not entry.is_dir():
            files.append((entry, name))
    names = {name for entry, name in files}
    if not set(pin["requiredFiles"]).issubset(names):
        raise ValueError("Electron ZIP is missing required runtime files: " + ", ".join(sorted(set(pin["requiredFiles"]) - names)))
    if archive.getinfo("version").file_size > 64:
        raise ValueError("Electron archive version marker exceeds limit")
    version = archive.read("version").decode("ascii").strip()
    if version != pin["version"]:
        raise ValueError("Electron archive version mismatch")
    return files


def verify_cache(cache, pin):
    ordinary_parents(cache)
    archive_path = cache / pin["asset"]["name"]
    if ordinary(archive_path).st_size != pin["asset"]["bytes"] or sha256_file(archive_path) != pin["asset"]["sha256"]:
        raise ValueError("Pinned Electron archive checksum mismatch; cache rejected")
    metadata_path = cache / "official-release.json"
    if ordinary(metadata_path).st_size > MAX_METADATA:
        raise ValueError("Cached Electron release metadata exceeds limit")
    verify_release_metadata(pin, json.loads(metadata_path.read_text(encoding="utf-8")))
    sums_path = cache / pin["shasums"]["name"]
    if ordinary(sums_path).st_size != pin["shasums"]["bytes"]:
        raise ValueError("Pinned SHASUMS256 checksum mismatch")
    verify_shasums(pin, sums_path.read_bytes())
    runtime = cache / "runtime"
    ordinary_parents(runtime)
    observed = set()
    for base, dirs, files in os.walk(runtime, followlinks=False):
        for name in dirs:
            ordinary(Path(base) / name, directory=True)
        for name in files:
            item = Path(base) / name
            ordinary(item)
            observed.add(item.relative_to(runtime).as_posix())
    inventory = []
    with zipfile.ZipFile(archive_path) as archive:
        entries = zip_inventory(archive, pin)
        if observed != {name for entry, name in entries}:
            raise ValueError("Extracted Electron runtime file set mismatch; cache rejected")
        for entry, name in entries:
            hasher = hashlib.sha256()
            with archive.open(entry) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    hasher.update(chunk)
            expected_hash = hasher.hexdigest()
            item = runtime.joinpath(*name.split("/"))
            if item.stat().st_size != entry.file_size or sha256_file(item) != expected_hash:
                raise ValueError("Extracted Electron runtime checksum mismatch: " + name)
            inventory.append({"path": name, "bytes": entry.file_size, "sha256": expected_hash})
    return {"schemaVersion": 1, "version": pin["version"], "platform": pin["platform"], "arch": pin["arch"], "runtimePath": str(runtime), "releaseUrl": pin["releaseUrl"], "publishedAt": pin["publishedAt"], "archive": pin["asset"], "shasums": pin["shasums"], "integritySources": ["pinned SHA256", "official GitHub asset.digest", "official SHASUMS256.txt", "ZIP-to-extracted-file SHA256"], "support": pin.get("support", {}), "files": sorted(inventory, key=lambda entry: entry["path"])}


def allowed_url(url):
    value = urllib.parse.urlsplit(url)
    if value.scheme != "https" or value.hostname not in ALLOWED_HOSTS or value.username or value.password or value.port not in {None, 443}:
        raise ValueError("Electron download redirected outside official HTTPS hosts")


class OfficialRedirects(urllib.request.HTTPRedirectHandler):
    max_redirections = 5

    def redirect_request(self, request, response, code, message, headers, url):
        allowed_url(url)
        return super().redirect_request(request, response, code, message, headers, url)


def download(url, target, limit, exact_bytes=None):
    allowed_url(url)
    opener = urllib.request.build_opener(OfficialRedirects())
    for attempt in range(3):
        deadline = time.monotonic() + 300
        request = urllib.request.Request(url, headers={"User-Agent": "Egoist-Lagom-runtime-bootstrap", "Accept": "application/vnd.github+json" if "api.github.com" in url else "application/octet-stream"})
        try:
            with opener.open(request, timeout=30) as response, target.open("wb") as file:
                allowed_url(response.url)
                length = response.headers.get("Content-Length")
                if length and (int(length) > limit or (exact_bytes is not None and int(length) != exact_bytes)):
                    raise ValueError("Electron download size mismatch")
                total = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > limit or time.monotonic() > deadline:
                        raise ValueError("Electron download exceeded bounds")
                    file.write(chunk)
                if exact_bytes is not None and total != exact_bytes:
                    raise ValueError("Electron download is incomplete")
            return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def fetch_cache(project, pin, work):
    ordinary_parents(project)
    ordinary_parents(work)
    cache = project / ".tools" / ("electron-" + pin["version"])
    ordinary_parents(cache.parent)
    if cache.exists() or cache.is_symlink():
        return verify_cache(cache, pin)
    cache.parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="electron-" + pin["version"] + "-", dir=work) as temporary:
        staging = Path(temporary) / "cache"
        staging.mkdir()
        print("Fetching official Electron metadata/checksums", file=sys.stderr, flush=True)
        download(pin["releaseApiUrl"], staging / "official-release.json", MAX_METADATA)
        verify_release_metadata(pin, json.loads((staging / "official-release.json").read_text(encoding="utf-8")))
        download(pin["shasums"]["url"], staging / pin["shasums"]["name"], MAX_METADATA, pin["shasums"]["bytes"])
        verify_shasums(pin, (staging / pin["shasums"]["name"]).read_bytes())
        print("Fetching pinned Electron archive", file=sys.stderr, flush=True)
        archive_path = staging / pin["asset"]["name"]
        download(pin["asset"]["url"], archive_path, MAX_ARCHIVE, pin["asset"]["bytes"])
        if sha256_file(archive_path) != pin["asset"]["sha256"]:
            raise ValueError("Downloaded Electron archive checksum mismatch")
        runtime = staging / "runtime"
        runtime.mkdir()
        with zipfile.ZipFile(archive_path) as archive:
            entries = zip_inventory(archive, pin)
            for entry, name in entries:
                target = runtime.joinpath(*name.split("/"))
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as source, target.open("xb") as destination:
                    shutil.copyfileobj(source, destination, 1024 * 1024)
        verify_cache(staging, pin)
        ordinary_parents(cache.parent)
        if cache.exists() or cache.is_symlink():
            return verify_cache(cache, pin)
        os.rename(staging, cache)
    return verify_cache(cache, pin)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--descriptor", type=Path, default=Path(__file__).with_name("electron-runtime.json"))
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--verify", action="store_true", help="Verify the complete cache offline; never download or repair it")
    args = parser.parse_args()
    project = args.project_root.absolute()
    pin = load_pin(args.descriptor.absolute())
    if args.verify:
        result = verify_cache(project / ".tools" / ("electron-" + pin["version"]), pin)
    else:
        if args.work_dir is None or not args.work_dir.is_absolute():
            parser.error("--work-dir must be this task's existing absolute work directory")
        result = fetch_cache(project, pin, args.work_dir)
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile, KeyError) as error:
        print("Pinned Electron runtime rejected: " + str(error), file=sys.stderr)
        sys.exit(1)
