"""Authenticate a component's extracted ordinary files against its pinned ZIP."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import zipfile

MAX_ARCHIVE = 256 * 1024 * 1024
MAX_EXTRACTED = 1024 * 1024 * 1024
MAX_ENTRIES = 5000


def ordinary(path, directory=False):
    value = path.lstat()
    if getattr(value, "st_file_attributes", 0) & 0x400 or stat.S_ISLNK(value.st_mode):
        raise ValueError("Component paths must not be links: " + str(path))
    if directory:
        if not stat.S_ISDIR(value.st_mode):
            raise ValueError("Component path must be a directory: " + str(path))
    elif not stat.S_ISREG(value.st_mode) or value.st_nlink != 1:
        raise ValueError("Component input must be an ordinary file: " + str(path))
    return value


def ordinary_parents(path):
    for parent in reversed(path.parents):
        ordinary(parent, directory=True)


def digest_stream(stream):
    value = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        value.update(chunk)
    return value.hexdigest()


def safe_name(name):
    if not name or "\\" in name or "\0" in name or name.startswith("/"):
        raise ValueError("Unsafe component ZIP path: " + repr(name))
    parts = name.rstrip("/").split("/")
    reserved = re.compile(r"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", re.I)
    if any(part in {"", ".", ".."} or ":" in part or part.endswith((".", " ")) or reserved.match(part) or any(ord(c) < 32 for c in part) for part in parts):
        raise ValueError("Unsafe component ZIP path: " + repr(name))
    return PurePosixPath(*parts).as_posix()


def zip_entries(archive):
    entries = archive.infolist()
    if not 0 < len(entries) <= MAX_ENTRIES:
        raise ValueError("Unexpected component ZIP entry count")
    seen = set()
    total = 0
    for entry in entries:
        name = safe_name(entry.filename)
        folded = name.casefold()
        if folded in seen:
            raise ValueError("Duplicate component ZIP path: " + name)
        seen.add(folded)
        kind = stat.S_IFMT(entry.external_attr >> 16)
        if kind not in {0, stat.S_IFREG, stat.S_IFDIR} or (entry.create_system == 0 and entry.external_attr & 0x400) or entry.flag_bits & 1 or entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
            raise ValueError("Linked, encrypted or unsupported component ZIP entry: " + name)
        total += entry.file_size
        if entry.file_size > MAX_EXTRACTED or total > MAX_EXTRACTED:
            raise ValueError("Component ZIP exceeds extracted byte limit")
    return entries


def open_pinned_zip(archive_path, sha256):
    ordinary_parents(archive_path)
    value = ordinary(archive_path)
    if not 0 < value.st_size <= MAX_ARCHIVE or not re.fullmatch(r"[a-f0-9]{64}", sha256):
        raise ValueError("Invalid pinned component archive")
    with archive_path.open("rb") as stream:
        if digest_stream(stream) != sha256:
            raise ValueError("Component archive SHA-256 mismatch")
    return zipfile.ZipFile(archive_path)


def verify_extracted(archive_path, sha256, extracted):
    ordinary_parents(extracted)
    ordinary(extracted, directory=True)
    observed = set()
    for directory, dirs, files in os.walk(extracted, followlinks=False):
        for name in dirs:
            ordinary(Path(directory) / name, directory=True)
        for name in files:
            file = Path(directory) / name
            ordinary(file)
            observed.add(file.relative_to(extracted).as_posix())
    inventory = []
    with open_pinned_zip(archive_path, sha256) as archive:
        entries = zip_entries(archive)
        expected = {safe_name(entry.filename) for entry in entries if not entry.is_dir()}
        if observed != expected:
            raise ValueError("Extracted component file set differs from pinned ZIP")
        for entry in entries:
            if entry.is_dir():
                continue
            name = safe_name(entry.filename)
            file = extracted.joinpath(*PurePosixPath(name).parts)
            if ordinary(file).st_size != entry.file_size:
                raise ValueError("Extracted component size differs from pinned ZIP: " + name)
            with archive.open(entry) as stream:
                expected_hash = digest_stream(stream)
            with file.open("rb") as stream:
                actual_hash = digest_stream(stream)
            if actual_hash != expected_hash:
                raise ValueError("Extracted component SHA-256 differs from pinned ZIP: " + name)
            inventory.append({"path": name, "bytes": entry.file_size, "sha256": expected_hash})
    return {"schemaVersion": 1, "archiveSha256": sha256, "files": sorted(inventory, key=lambda item: item["path"])}


def extract_verified(archive_path, sha256, destination, work):
    ordinary_parents(work)
    ordinary(work, directory=True)
    if destination.exists():
        return verify_extracted(archive_path, sha256, destination)
    ordinary_parents(destination)
    with tempfile.TemporaryDirectory(prefix="component-extract-", dir=work) as temporary:
        stage = Path(temporary) / "extracted"
        stage.mkdir()
        with open_pinned_zip(archive_path, sha256) as archive:
            for entry in zip_entries(archive):
                target = stage.joinpath(*PurePosixPath(safe_name(entry.filename)).parts)
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(entry) as source, target.open("xb") as output:
                        shutil.copyfileobj(source, output, 1024 * 1024)
        verify_extracted(archive_path, sha256, stage)
        shutil.move(str(stage), str(destination))
    return verify_extracted(archive_path, sha256, destination)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--extracted", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(verify_extracted(args.archive.absolute(), args.sha256, args.extracted.absolute())))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
        raise SystemExit(str(error))
