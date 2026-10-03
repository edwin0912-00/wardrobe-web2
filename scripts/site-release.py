#!/usr/bin/env python3
"""Build and atomically activate a minimal, hash-bound cinematic site artifact."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import posixpath
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path, PurePosixPath
from typing import Any, Callable

SCHEMA_VERSION = 1
MANIFEST_NAME = "site-release.json"
REQUIRED_ROOT_FILES = ("index.html", "serve.py")
ROOT_WEB_SUFFIXES = {".html", ".js", ".css"}
SOURCE_PREFIXES = ("adapters/", "vendor/", "b/")
MEDIA_PREFIXES = ("b/assets/", "b/audio/")
MEDIA_EXTENSIONS = {".mp4", ".mp3", ".jpg", ".jpeg", ".png", ".webp", ".avif"}
SHA256 = re.compile(r"^[a-f0-9]{64}$")
COMMIT = re.compile(r"^[a-f0-9]{40}$")


class SiteReleaseError(RuntimeError):
    pass


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def _fsync_directory(directory: Path) -> None:
    if os.name == "nt":
        return
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}-{time.time_ns()}")
    with temporary.open("xb") as output:
        output.write((json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode())
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    _fsync_directory(path.parent)


def _safe_relative(value: str) -> str:
    relative = PurePosixPath(value)
    if relative.is_absolute() or not value or any(part in ("", ".", "..") for part in relative.parts):
        raise SiteReleaseError(f"unsafe artifact path: {value!r}")
    normalized = relative.as_posix()
    if any(part in {"node_modules", "__pycache__", ".git", "test", "tests", "__tests__", "dumps", "private"}
           for part in relative.parts):
        raise SiteReleaseError(f"forbidden artifact path: {value!r}")
    return normalized


def _lstat_regular(root: Path, relative: str) -> Path:
    relative = _safe_relative(relative)
    current = root
    parts = PurePosixPath(relative).parts
    for index, part in enumerate(parts):
        current = current / part
        try:
            current.lstat()
        except OSError as error:
            raise SiteReleaseError(f"missing site source {relative}: {error.strerror}") from error
        if os.path.islink(current):
            raise SiteReleaseError(f"site source symlink is refused: {relative}")
        if index < len(parts) - 1 and not current.is_dir():
            raise SiteReleaseError(f"site source parent is not a directory: {relative}")
        if index == len(parts) - 1 and not current.is_file():
            raise SiteReleaseError(f"site source is not a regular file: {relative}")
    return current


def _walk_regular_files(root: Path, relative_root: str) -> list[str]:
    directory = root / relative_root
    try:
        directory.lstat()
    except FileNotFoundError:
        raise SiteReleaseError(f"locked media directory is missing: {relative_root}")
    if os.path.islink(directory) or not directory.is_dir():
        raise SiteReleaseError(f"locked media directory must be a real directory: {relative_root}")
    results: list[str] = []
    for entry in sorted(directory.iterdir(), key=lambda item: item.name):
        relative = f"{relative_root}/{entry.name}"
        if os.path.islink(entry):
            raise SiteReleaseError(f"locked media symlink is refused: {relative}")
        if entry.is_dir():
            results.extend(_walk_regular_files(root, relative))
        elif entry.is_file():
            results.append(_safe_relative(relative))
        else:
            raise SiteReleaseError(f"non-regular locked media is refused: {relative}")
    return results


def tracked_paths(repo_root: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "ls-files", "-z"], cwd=repo_root, check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise SiteReleaseError("could not enumerate tracked site source files") from error
    return [item.decode("utf-8") for item in result.stdout.split(b"\0") if item]


def select_tracked_site_sources(tracked: list[str]) -> list[str]:
    tracked_set = {PurePosixPath(path).as_posix() for path in tracked}
    missing = [path for path in REQUIRED_ROOT_FILES if path not in tracked_set]
    if missing:
        raise SiteReleaseError(f"required tracked site files are missing: {', '.join(missing)}")
    selected = {
        path for path in tracked_set
        if "/" not in path and Path(path).suffix.lower() in ROOT_WEB_SUFFIXES
    }
    selected.update(REQUIRED_ROOT_FILES)
    selected.update(path for path in tracked_set if path.startswith(SOURCE_PREFIXES))
    return sorted(_safe_relative(path) for path in selected)


def _local_reference_paths(relative: str, content: str) -> list[str]:
    references: list[str] = []
    if Path(relative).suffix.lower() in {".html", ".htm"}:
        references.extend(re.findall(r"(?:src|href|poster|data-src)\s*=\s*['\"]([^'\"]+)['\"]", content, re.I))
    if Path(relative).suffix.lower() == ".css":
        references.extend(re.findall(r"url\(\s*['\"]?([^'\")]+)", content, re.I))
    if Path(relative).suffix.lower() in {".js", ".mjs"}:
        references.extend(re.findall(r"(?:import|from)\s*(?:\(\s*)?['\"]([^'\"]+)['\"]", content))
    result = []
    for reference in references:
        parsed = urllib.parse.urlsplit(reference)
        reference_path = urllib.parse.unquote(parsed.path)
        if parsed.scheme or parsed.netloc or reference_path.startswith("/") or reference_path.startswith("#") or not reference_path:
            continue
        result.append(posixpath.normpath(posixpath.join(posixpath.dirname(relative), reference_path)))
    return result


def validate_local_site_references(repo_root: Path, source_paths: list[str], media_paths: list[str]) -> None:
    included = set(source_paths) | set(media_paths)
    for relative in source_paths:
        if Path(relative).suffix.lower() not in {".html", ".htm", ".css", ".js", ".mjs"}:
            continue
        content = _lstat_regular(repo_root, relative).read_text(encoding="utf-8", errors="replace")
        for target in _local_reference_paths(relative, content):
            if target not in included:
                raise SiteReleaseError(f"local site dependency is outside the release allowlist: {relative} -> {target}")


def _media_bundle_sha(repo_root: Path) -> tuple[str, list[str]]:
    try:
        lock = json.loads(_lstat_regular(repo_root, "release/MEDIA.lock.json").read_text())
        marker = json.loads(_lstat_regular(repo_root, ".wardrobe-media-bundle.json").read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise SiteReleaseError("locked cinematic media bundle marker is missing or invalid") from error
    media_sha = lock.get("sha256")
    if (not SHA256.fullmatch(str(media_sha)) or marker.get("sha256") != media_sha
            or marker.get("bundle") != lock.get("bundle")):
        raise SiteReleaseError("installed cinematic media does not match release/MEDIA.lock.json")
    required = [
        _safe_relative(file)
        for file in lock.get("required_files", [])
        if file.startswith(MEDIA_PREFIXES)
    ]
    if not required:
        raise SiteReleaseError("media lock contains no required cinematic assets")
    return media_sha, required


def select_site_files(
    repo_root: Path,
    tracked: list[str] | None = None,
) -> tuple[list[str], str]:
    selected = set(select_tracked_site_sources(tracked if tracked is not None else tracked_paths(repo_root)))
    media_sha, required_media = _media_bundle_sha(repo_root)
    media_paths: list[str] = []
    for directory in MEDIA_PREFIXES:
        media_paths.extend(_walk_regular_files(repo_root, directory.rstrip("/")))
    selected.update(media_paths)
    selected.update(required_media)
    validate_local_site_references(repo_root, sorted(selected - set(media_paths)), media_paths)
    for relative in sorted(selected):
        _lstat_regular(repo_root, relative)
    missing_media = [path for path in required_media if path not in selected]
    if missing_media:
        raise SiteReleaseError(f"required locked site media is missing: {', '.join(missing_media)}")
    return sorted(selected), media_sha


def _copy_hash(source: Path, destination: Path) -> tuple[int, str]:
    hasher = hashlib.sha256()
    size = 0
    with source.open("rb") as incoming, destination.open("xb") as outgoing:
        for block in iter(lambda: incoming.read(1024 * 1024), b""):
            outgoing.write(block)
            hasher.update(block)
            size += len(block)
        outgoing.flush()
        os.fsync(outgoing.fileno())
    return size, hasher.hexdigest()


def verify_artifact(artifact_root: Path) -> dict[str, Any]:
    artifact_root = artifact_root.absolute()
    if os.path.islink(artifact_root) or not artifact_root.is_dir():
        raise SiteReleaseError("site artifact must be a real directory")
    try:
        manifest = json.loads((artifact_root / MANIFEST_NAME).read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise SiteReleaseError("site release manifest is missing or invalid") from error
    if manifest.get("schema_version") != SCHEMA_VERSION or not COMMIT.fullmatch(str(manifest.get("source_commit", ""))):
        raise SiteReleaseError("site release manifest schema or source commit is invalid")
    if not SHA256.fullmatch(str(manifest.get("media_bundle_sha256", ""))):
        raise SiteReleaseError("site release manifest media lock hash is invalid")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise SiteReleaseError("site release manifest has no files")
    expected: dict[str, dict[str, Any]] = {}
    for item in files:
        relative = _safe_relative(item.get("path", ""))
        if relative == MANIFEST_NAME or relative in expected:
            raise SiteReleaseError(f"duplicate or reserved site artifact path: {relative}")
        if not SHA256.fullmatch(str(item.get("sha256", ""))) or not isinstance(item.get("size_bytes"), int):
            raise SiteReleaseError(f"invalid file manifest entry: {relative}")
        expected[relative] = item

    actual: set[str] = set()
    for directory, names, files_in_dir in os.walk(artifact_root, followlinks=False):
        directory_path = Path(directory)
        for name in names:
            child = directory_path / name
            if os.path.islink(child):
                raise SiteReleaseError(f"site artifact contains a symlink: {child.relative_to(artifact_root)}")
        for name in files_in_dir:
            child = directory_path / name
            relative = child.relative_to(artifact_root).as_posix()
            if os.path.islink(child) or not child.is_file():
                raise SiteReleaseError(f"site artifact contains a non-regular file: {relative}")
            actual.add(relative)
    if actual != set(expected) | {MANIFEST_NAME}:
        extras = sorted(actual - (set(expected) | {MANIFEST_NAME}))
        missing = sorted((set(expected) | {MANIFEST_NAME}) - actual)
        raise SiteReleaseError(f"site artifact file set mismatch; extra={extras[:4]}, missing={missing[:4]}")
    for relative, item in expected.items():
        path = artifact_root / relative
        if path.stat().st_size != item["size_bytes"] or digest(path) != item["sha256"]:
            raise SiteReleaseError(f"site artifact SHA-256 mismatch: {relative}")
    return manifest


def build_artifact(
    repo_root: Path,
    versions_root: Path,
    source_commit: str,
    *,
    tracked: list[str] | None = None,
) -> Path:
    repo_root = repo_root.resolve()
    versions_root = versions_root.absolute()
    if not COMMIT.fullmatch(source_commit):
        raise SiteReleaseError("source commit must be a full 40-character SHA")
    paths, media_sha = select_site_files(repo_root, tracked)
    versions_root.mkdir(parents=True, exist_ok=True, mode=0o755)
    if os.path.islink(versions_root):
        raise SiteReleaseError("version directory cannot be a symlink")
    target = versions_root / source_commit
    if os.path.lexists(target):
        manifest = verify_artifact(target)
        if manifest.get("source_commit") != source_commit or manifest.get("media_bundle_sha256") != media_sha:
            raise SiteReleaseError("existing site artifact does not match this source/media release")
        return target

    stage = versions_root / f".staging-{source_commit}-{os.getpid()}-{time.time_ns()}"
    stage.mkdir(mode=0o700)
    records = []
    for relative in paths:
        source = _lstat_regular(repo_root, relative)
        destination = stage / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        size, file_sha = _copy_hash(source, destination)
        records.append({"path": relative, "size_bytes": size, "sha256": file_sha})
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "source_commit": source_commit,
        "media_bundle_sha256": media_sha,
        "files": records,
    }
    manifest_bytes = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    with (stage / MANIFEST_NAME).open("xb") as output:
        output.write(manifest_bytes)
        output.flush()
        os.fsync(output.fileno())
    _fsync_directory(stage)
    os.rename(stage, target)
    _fsync_directory(versions_root)
    verify_artifact(target)
    return target


def _curl_fetch(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 12.0,
    curl_bin: str | None = None,
) -> tuple[int, bytes, dict[str, str]]:
    curl_bin = curl_bin or os.environ.get("WARDROBE_CURL", "curl")
    with tempfile.TemporaryDirectory(prefix="wardrobe-site-check-") as temporary:
        header_path = Path(temporary) / "headers"
        body_path = Path(temporary) / "body"
        command = [
            curl_bin, "--silent", "--show-error", "--max-time", str(timeout),
            "--dump-header", str(header_path), "--output", str(body_path),
            "--write-out", "%{http_code}",
        ]
        for key, value in (headers or {}).items():
            command.extend(["--header", f"{key}: {value}"])
        command.append(url)
        result = subprocess.run(command, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0:
            message = result.stderr.strip().splitlines()[-1:] or ["curl failed"]
            raise SiteReleaseError(f"HTTP request failed: {message[0]}")
        try:
            status = int(result.stdout.strip())
            raw_headers = header_path.read_text(encoding="latin-1").splitlines()
            body = body_path.read_bytes()
        except (OSError, ValueError) as error:
            raise SiteReleaseError("curl returned an incomplete HTTP response") from error
        response_headers: dict[str, str] = {}
        for line in raw_headers:
            if line.startswith("HTTP/"):
                response_headers = {}
            elif ":" in line:
                key, value = line.split(":", 1)
                response_headers[key.lower()] = value.strip()
        return status, body, response_headers


def release_identity_from_runner(runner_path: Path) -> dict[str, str]:
    try:
        source = runner_path.read_text()
    except OSError as error:
        raise SiteReleaseError("configured beta runner is missing or unreadable") from error
    app_roots = re.findall(r'^app_root="([^"]+)"$', source, re.M)
    if len(app_roots) != 1:
        raise SiteReleaseError("configured beta runner must declare exactly one app_root")
    try:
        identity = json.loads((Path(app_roots[0]) / "ops/product-release-manifest.json").read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise SiteReleaseError("configured beta release identity is missing or invalid") from error
    base_commit = identity.get("base_commit")
    cache_token = identity.get("cache_token")
    if not COMMIT.fullmatch(str(base_commit or "")) or not re.fullmatch(r"product-[a-f0-9]{8}-[a-f0-9]{12}", str(cache_token or "")):
        raise SiteReleaseError("configured beta release identity is incomplete")
    return {"base_commit": base_commit, "cache_token": cache_token}


def verify_http_origin(
    origin: str,
    artifact_root: Path,
    expected_beta_identity: dict[str, str],
    timeout: float = 12.0,
    readiness_timeout: float = 20.0,
    curl_bin: str | None = None,
) -> None:
    manifest = verify_artifact(artifact_root)
    source_sha = manifest["source_commit"]
    base = origin.rstrip("/")

    def fetch(
        relative: str,
        headers: dict[str, str] | None = None,
        request_timeout: float | None = None,
    ) -> tuple[int, bytes, dict[str, str]]:
        encoded = urllib.parse.quote(relative, safe="/:@")
        separator = "&" if "?" in encoded else "?"
        url = f"{base}/{encoded}{separator}v={source_sha}"
        return _curl_fetch(url, headers=headers, timeout=request_timeout or timeout, curl_bin=curl_bin)

    deadline = time.monotonic() + readiness_timeout
    last_health_error = "no health response"
    while True:
        try:
            status, health_bytes, _ = fetch("api/health", request_timeout=min(timeout, 3.0))
            health = json.loads(health_bytes)
            actual_base_commit = health.get("release_sha", health.get("base_commit"))
            if (status == 200 and health.get("status") == "ready"
                    and actual_base_commit == expected_beta_identity["base_commit"]
                    and health.get("cache_token") == expected_beta_identity["cache_token"]):
                break
            last_health_error = "status, release SHA, or cache token did not match"
        except (SiteReleaseError, json.JSONDecodeError) as error:
            last_health_error = str(error)
        if time.monotonic() >= deadline:
            raise SiteReleaseError(f"{origin} health did not become ready with the expected beta release: {last_health_error}")
        time.sleep(0.5)

    status, manifest_bytes, _ = fetch(MANIFEST_NAME)
    expected_manifest_bytes = (artifact_root / MANIFEST_NAME).read_bytes()
    if status != 200 or manifest_bytes != expected_manifest_bytes:
        raise SiteReleaseError(f"{origin} is serving a stale site release manifest")

    for item in manifest["files"]:
        relative = item["path"]
        if relative == "index.html":
            # The server deliberately maps / and /index.html to b/index.html.
            continue
        path = artifact_root / relative
        if path.suffix.lower() in MEDIA_EXTENSIONS:
            end = min(1023, item["size_bytes"] - 1)
            if end < 0:
                raise SiteReleaseError(f"empty media file in site release: {relative}")
            status, body, headers = fetch(relative, {"Range": f"bytes=0-{end}"})
            expected_content_range = f"bytes 0-{end}/{item['size_bytes']}"
            if status != 206 or headers.get("content-range") != expected_content_range:
                raise SiteReleaseError(f"{origin} Range check failed for {relative}")
            with path.open("rb") as media_file:
                expected_prefix = media_file.read(end + 1)
            if body != expected_prefix:
                raise SiteReleaseError(f"{origin} is serving stale media bytes: {relative}")
        else:
            status, body, _ = fetch(relative)
            if status != 200 or len(body) != item["size_bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
                raise SiteReleaseError(f"{origin} static SHA-256 mismatch: {relative}")


def _write_state(path: Path, state: dict[str, Any]) -> None:
    _atomic_json(path, state)


def _read_runtime(runtime_root: Path) -> tuple[str, str | None]:
    if not os.path.lexists(runtime_root):
        raise SiteReleaseError("existing runtime path is missing; refusing to create a new one")
    if os.path.islink(runtime_root):
        target = os.readlink(runtime_root)
        resolved = Path(target) if os.path.isabs(target) else runtime_root.parent / target
        if not resolved.exists() or not resolved.is_dir():
            raise SiteReleaseError("existing runtime pointer is broken")
        return "symlink", target
    if runtime_root.is_dir():
        return "directory", None
    raise SiteReleaseError("existing runtime is not a directory or symlink")


def _rollback_runtime(runtime_root: Path, versions_root: Path, state: dict[str, Any]) -> None:
    runtime_type = state["previous_type"]
    identifier = state["attempt_id"]
    if runtime_type == "symlink":
        temporary = runtime_root.with_name(f".{runtime_root.name}.rollback-{identifier}")
        if os.path.lexists(temporary):
            raise SiteReleaseError("rollback pointer collision; preserving current runtime")
        os.symlink(state["previous_target"], temporary, target_is_directory=True)
        if os.path.lexists(runtime_root) and not os.path.islink(runtime_root):
            failed_tree = versions_root / f"failed-runtime-{identifier}"
            if os.path.lexists(failed_tree):
                raise SiteReleaseError("failed runtime preservation path already exists")
            os.rename(runtime_root, failed_tree)
        os.replace(temporary, runtime_root)
    else:
        backup = Path(state["previous_backup"])
        failed_pointer = versions_root / f"failed-pointer-{identifier}"
        if os.path.lexists(runtime_root):
            if os.path.lexists(failed_pointer):
                raise SiteReleaseError("failed release preservation path already exists")
            os.rename(runtime_root, failed_pointer)
        os.rename(backup, runtime_root)
    _fsync_directory(runtime_root.parent)


def activate_artifact(
    runtime_root: Path,
    versions_root: Path,
    artifact_root: Path,
    *,
    restart: Callable[[], None],
    verify_origins: Callable[[Path], None],
) -> dict[str, Any]:
    manifest = verify_artifact(artifact_root)
    runtime_root, versions_root = runtime_root.absolute(), versions_root.absolute()
    artifact_root = artifact_root.absolute()
    if runtime_root.parent != versions_root.parent:
        raise SiteReleaseError("version artifacts must be siblings of the stable runtime path")
    if artifact_root.parent != versions_root:
        raise SiteReleaseError("site artifact must be an immutable direct child of its versions directory")
    if runtime_root.parent.stat().st_dev != versions_root.stat().st_dev:
        raise SiteReleaseError("runtime and version artifacts must share a filesystem for atomic switching")
    previous_type, previous_target = _read_runtime(runtime_root)
    attempt_id = f"{manifest['source_commit'][:10]}-{os.getpid()}-{time.time_ns()}"
    backup = versions_root / f"rollback-legacy-{attempt_id}" if previous_type == "directory" else None
    state_path = versions_root / f"deployment-{attempt_id}.json"
    state: dict[str, Any] = {
        "schema_version": 1,
        "state": "PREPARED",
        "attempt_id": attempt_id,
        "source_commit": manifest["source_commit"],
        "runtime_root": str(runtime_root),
        "artifact_root": str(artifact_root),
        "previous_type": previous_type,
        "previous_target": previous_target,
        "previous_backup": str(backup) if backup else None,
    }
    _write_state(state_path, state)
    link_tmp = runtime_root.with_name(f".{runtime_root.name}.next-{attempt_id}")
    switched = False
    old_moved = False
    try:
        os.symlink(str(artifact_root), link_tmp, target_is_directory=True)
        if previous_type == "directory":
            if os.path.lexists(backup):
                raise SiteReleaseError("rollback destination already exists")
            os.rename(runtime_root, backup)
            old_moved = True
            _fsync_directory(runtime_root.parent)
            try:
                os.rename(link_tmp, runtime_root)
            except OSError:
                os.rename(backup, runtime_root)
                old_moved = False
                _fsync_directory(runtime_root.parent)
                raise
        else:
            os.replace(link_tmp, runtime_root)
        switched = True
        _fsync_directory(runtime_root.parent)
        state["state"] = "SWITCHED"
        _write_state(state_path, state)
        restart()
        # Verify the bytes after the restart as well as before the pointer switch.
        verify_artifact(artifact_root)
        verify_origins(artifact_root)
        state["state"] = "ACTIVE"
        _write_state(state_path, state)
        return {"ok": True, **state}
    except Exception as failure:
        if os.path.lexists(link_tmp):
            os.rename(link_tmp, versions_root / f"failed-next-{attempt_id}")
        rollback_error = None
        if switched or old_moved:
            try:
                _rollback_runtime(runtime_root, versions_root, state)
            except Exception as error:
                rollback_error = error
            try:
                restart()
            except Exception as error:
                rollback_error = error if rollback_error is None else SiteReleaseError(f"{rollback_error}; restart failed: {error}")
        if switched or old_moved:
            state["state"] = "ROLLED_BACK" if rollback_error is None else "ROLLBACK_FAILED"
        else:
            state["state"] = "NOT_SWITCHED"
        state["failure"] = f"{type(failure).__name__}: {failure}"
        if rollback_error:
            state["rollback_error"] = f"{type(rollback_error).__name__}: {rollback_error}"
        try:
            _write_state(state_path, state)
        except Exception as error:
            rollback_error = error if rollback_error is None else SiteReleaseError(f"{rollback_error}; receipt update failed: {error}")
        if rollback_error:
            raise SiteReleaseError(f"deployment failed ({failure}); rollback/restart also failed ({rollback_error})") from failure
        if switched or old_moved:
            raise SiteReleaseError(f"deployment failed and previous runtime was restored: {failure}") from failure
        raise SiteReleaseError(f"deployment failed before runtime switch: {failure}") from failure


def validate_plist(path: Path, label: str, *, required_argument: str | None = None, required_path: str | None = None) -> None:
    try:
        with path.open("rb") as source:
            plist = plistlib.load(source)
    except (OSError, plistlib.InvalidFileException) as error:
        raise SiteReleaseError(f"launchd plist is missing or invalid: {path}") from error
    if plist.get("Label") != label:
        raise SiteReleaseError(f"launchd plist label mismatch: {label}")
    arguments = plist.get("ProgramArguments")
    if not isinstance(arguments, list) or not all(isinstance(item, str) for item in arguments):
        raise SiteReleaseError(f"launchd plist has no valid ProgramArguments: {label}")
    if required_argument and required_argument not in arguments:
        raise SiteReleaseError(f"launchd plist does not use the configured beta runner: {label}")
    if required_path:
        working_directory = plist.get("WorkingDirectory", "")
        if not isinstance(working_directory, str):
            raise SiteReleaseError(f"launchd plist WorkingDirectory is invalid: {label}")
        expected = os.path.normcase(os.path.abspath(required_path))
        configured = []
        for argument in arguments:
            candidate = Path(argument)
            if not candidate.is_absolute():
                candidate = Path(working_directory) / candidate
            configured.append(os.path.normcase(os.path.abspath(candidate)))
        if expected not in configured:
            raise SiteReleaseError(f"launchd plist does not reference the configured site runtime: {label}")


def active_beta_work_ids(repo_root: Path, runner_path: Path, node: str = "node") -> list[str]:
    script = """
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.SITE_RELEASE_REPO;
const runner = process.env.SITE_RELEASE_BETA_RUNNER;
const moduleUrl = pathToFileURL(join(root, 'beta/tools/deploy-beta-release.mjs'));
const { activeBetaWorkIds } = await import(moduleUrl.href);
const active = await activeBetaWorkIds(await readFile(runner, 'utf8'));
process.stdout.write(JSON.stringify(active));
"""
    environment = {
        **os.environ,
        "SITE_RELEASE_REPO": str(repo_root),
        "SITE_RELEASE_BETA_RUNNER": str(runner_path),
    }
    result = subprocess.run(
        [node, "--input-type=module", "--eval", script], cwd=repo_root,
        env=environment, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    if result.returncode != 0:
        raise SiteReleaseError("could not verify active beta work from the configured beta runner")
    try:
        active = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise SiteReleaseError("beta active-work checker returned invalid output") from error
    if not isinstance(active, list):
        raise SiteReleaseError("beta active-work checker did not return a list")
    return active


def _restart_launchd(label: str, launchctl: str = "/bin/launchctl") -> None:
    domain = f"gui/{os.getuid()}/{label}"
    result = subprocess.run([launchctl, "kickstart", "-k", domain], check=False)
    if result.returncode != 0:
        raise SiteReleaseError(f"launchd restart failed for {label}")


def deploy_site(
    repo_root: Path,
    runtime_root: Path,
    versions_root: Path,
    source_commit: str,
    site_plist: Path,
    site_label: str,
    beta_plist: Path,
    beta_runner: Path,
    local_origin: str,
    public_origin: str,
    *,
    restart: Callable[[], None] | None = None,
    active_work_check: Callable[[], list[str]] | None = None,
    verify_origin: Callable[[str, Path, dict[str, str]], None] = verify_http_origin,
    tracked: list[str] | None = None,
) -> dict[str, Any]:
    artifact = build_artifact(repo_root, versions_root, source_commit, tracked=tracked)
    validate_plist(site_plist, site_label, required_path=str(runtime_root / "serve.py"))
    validate_plist(beta_plist, "com.madeforthisjob.beta", required_argument=str(beta_runner))
    expected_beta_identity = release_identity_from_runner(beta_runner)
    if expected_beta_identity["base_commit"] != source_commit:
        raise SiteReleaseError("configured beta release SHA does not match the selected alpha source SHA")
    active = (active_work_check or (lambda: active_beta_work_ids(repo_root, beta_runner)))()
    if active:
        raise SiteReleaseError(f"beta has active or unreadable persisted work; gateway restart refused: {', '.join(active)}")

    restart_fn = restart or (lambda: _restart_launchd(site_label, os.environ.get("WARDROBE_LAUNCHCTL", "/bin/launchctl")))

    def verify_both_origins(artifact_root: Path) -> None:
        verify_origin(local_origin, artifact_root, expected_beta_identity)
        verify_origin(public_origin, artifact_root, expected_beta_identity)

    return activate_artifact(runtime_root, versions_root, artifact, restart=restart_fn, verify_origins=verify_both_origins)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build", help="build an allowlisted, hash-bound site artifact")
    build.add_argument("--repo-root", type=Path, required=True)
    build.add_argument("--versions-root", type=Path, required=True)
    build.add_argument("--source-commit", required=True)
    deploy = commands.add_parser("deploy", help="build, switch, verify, or roll back the main static runtime")
    deploy.add_argument("--repo-root", type=Path, required=True)
    deploy.add_argument("--runtime-root", type=Path, required=True)
    deploy.add_argument("--versions-root", type=Path, required=True)
    deploy.add_argument("--source-commit", required=True)
    deploy.add_argument("--site-plist", type=Path, required=True)
    deploy.add_argument("--site-label", required=True)
    deploy.add_argument("--beta-plist", type=Path, required=True)
    deploy.add_argument("--beta-runner", type=Path, required=True)
    deploy.add_argument("--local-origin", required=True)
    deploy.add_argument("--public-origin", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "build":
            artifact = build_artifact(args.repo_root, args.versions_root, args.source_commit)
            result = {"ok": True, "artifact_root": str(artifact), "source_commit": args.source_commit}
        else:
            result = deploy_site(
                args.repo_root, args.runtime_root, args.versions_root, args.source_commit,
                args.site_plist, args.site_label, args.beta_plist, args.beta_runner,
                args.local_origin, args.public_origin,
            )
    except (SiteReleaseError, OSError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
