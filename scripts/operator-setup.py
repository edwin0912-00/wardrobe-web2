#!/usr/bin/env python3
"""Private, local operator configuration for the complete Wardrobe alpha."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import platform
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path
from urllib.parse import urlsplit


CONFIG_VERSION = 1
CONFIG_FILENAME = "operator-config.json"
MANAGED_ENVIRONMENT = (
    "CODEX_HOME",
    "FAL_KEY",
    "OPENROUTER_API_KEY",
    "ZEELY_GENERATION_PROVIDER",
    "ZEELY_LOOK_IMAGE_ROUTE",
    "ZEELY_VLM_PROVIDER",
    "ZEELY_PUBLIC_HTTPS_ORIGIN",
    "ZEELY_RUNTIME_ROOT",
    "ZEELY_VIDEO_REFERENCE_ROOT",
    "WARDROBE_ALPHA_RUNTIME_ROOT",
    "WARDROBE_ALPHA_SITE_PORT",
    "WARDROBE_ALPHA_ENGINE_PORT",
)


class SetupError(Exception):
    """An operator-facing configuration or setup error."""


def default_runtime_root(home: Path | None = None, environment: dict | None = None) -> Path:
    home = (home or Path.home()).expanduser()
    environment = os.environ if environment is None else environment
    if platform.system() == "Darwin":
        return home / "Library" / "Application Support" / "WardrobeAlpha"
    state_home = environment.get("XDG_STATE_HOME")
    if state_home:
        candidate = Path(state_home).expanduser()
        if candidate.is_absolute():
            return candidate / "wardrobe-alpha"
    return home / ".local" / "state" / "wardrobe-alpha"


def default_config_path(home: Path | None = None, environment: dict | None = None) -> Path:
    # Keep lookup stable if an operator later moves the runtime directory.
    return default_runtime_root(home, environment) / CONFIG_FILENAME


def default_codex_home(home: Path | None = None) -> Path:
    return (home or Path.home()).expanduser() / ".codex-wardrobe-alpha"


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _absolute_private_directory(value: object, label: str, repo_root: Path) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SetupError(f"{label} must be an absolute directory path")
    raw = Path(value.strip()).expanduser()
    if not raw.is_absolute():
        raise SetupError(f"{label} must be absolute")
    try:
        resolved = raw.resolve(strict=False)
    except (OSError, RuntimeError) as error:
        raise SetupError(f"{label} cannot be resolved") from error

    repo_root = repo_root.resolve()
    home = Path.home().resolve()
    if resolved == Path(resolved.anchor) or resolved == home:
        raise SetupError(f"{label} must be a dedicated directory, not a filesystem or home root")
    if _is_within(resolved, repo_root) or _is_within(repo_root, resolved):
        raise SetupError(f"{label} must be separate from the repository checkout")
    if resolved.exists() and not resolved.is_dir():
        raise SetupError(f"{label} exists but is not a directory")
    return str(resolved)


def _optional_private_directory(value: object, label: str, repo_root: Path) -> str | None:
    if value in (None, ""):
        return None
    return _absolute_private_directory(value, label, repo_root)


def validate_origin(value: object) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise SetupError("Public HTTPS origin must be a URL")
    origin = value.strip()
    if not origin:
        return None
    if any(ord(character) < 32 or character.isspace() or character == "\\" for character in origin):
        raise SetupError("Public HTTPS origin contains invalid characters")
    try:
        parsed = urlsplit(origin)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise SetupError("Public HTTPS origin is malformed") from error
    if parsed.scheme.lower() != "https" or not parsed.netloc or not hostname:
        raise SetupError("Public origin must start with https:// and include a host")
    if parsed.username is not None or parsed.password is not None or "@" in parsed.netloc:
        raise SetupError("Public HTTPS origin cannot include credentials")
    if parsed.netloc.endswith(":") or (port is not None and port == 0):
        raise SetupError("Public HTTPS origin has an invalid port")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise SetupError("Public HTTPS origin must contain only a host and optional port")
    return f"https://{parsed.netloc}"


def validate_label(value: object) -> str:
    if not isinstance(value, str):
        raise SetupError("Host label is required")
    label = value.strip()
    if not label or len(label) > 120 or any(ord(character) < 32 or ord(character) == 127 for character in label):
        raise SetupError("Host label must contain 1 to 120 printable characters")
    return label


def validate_secret(value: object, label: str) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise SetupError(f"{label} must be text")
    secret = value.strip()
    if not secret:
        return None
    if len(secret) > 8192 or any(ord(character) < 32 or ord(character) == 127 for character in secret):
        raise SetupError(f"{label} is invalid")
    return secret


def validate_port(value: object, label: str) -> int | None:
    if value is None or value == "" or (isinstance(value, str) and value.lower() == "auto"):
        return None
    if isinstance(value, bool):
        raise SetupError(f"{label} must be a port from 1 to 65535 or auto")
    if isinstance(value, int):
        port = value
    elif isinstance(value, str) and value.isdecimal():
        port = int(value)
    else:
        raise SetupError(f"{label} must be a port from 1 to 65535 or auto")
    if not 1 <= port <= 65535:
        raise SetupError(f"{label} must be a port from 1 to 65535 or auto")
    return port


def validate_config(config: object, repo_root: Path) -> dict:
    if not isinstance(config, dict):
        raise SetupError("Configuration must be a JSON object")
    expected = {
        "version",
        "host_label",
        "public_https_origin",
        "runtime_root",
        "codex_home",
        "fal_key",
        "openrouter_api_key",
        "video_reference_root",
        "site_port",
        "engine_port",
    }
    if set(config) != expected:
        raise SetupError("Configuration fields are missing or unsupported")
    if isinstance(config["version"], bool) or config["version"] != CONFIG_VERSION:
        raise SetupError("Configuration version is unsupported")

    root = repo_root.resolve()
    runtime_root = _absolute_private_directory(config["runtime_root"], "Private runtime directory", root)
    codex_home = _absolute_private_directory(config["codex_home"], "Dedicated CODEX_HOME", root)
    runtime_path = Path(runtime_root)
    codex_path = Path(codex_home)
    if _is_within(runtime_path, codex_path) or _is_within(codex_path, runtime_path):
        raise SetupError("Private runtime directory and CODEX_HOME must be separate")

    video_root = _optional_private_directory(config["video_reference_root"], "Video-reference root", root)
    site_port = validate_port(config["site_port"], "Site port")
    engine_port = validate_port(config["engine_port"], "Engine port")
    if site_port is not None and site_port == engine_port:
        raise SetupError("Site and engine ports must differ")

    return {
        "version": CONFIG_VERSION,
        "host_label": validate_label(config["host_label"]),
        "public_https_origin": validate_origin(config["public_https_origin"]),
        "runtime_root": runtime_root,
        "codex_home": codex_home,
        "fal_key": validate_secret(config["fal_key"], "FAL key"),
        "openrouter_api_key": validate_secret(config["openrouter_api_key"], "OpenRouter key"),
        "video_reference_root": video_root,
        "site_port": site_port,
        "engine_port": engine_port,
    }


def validate_config_path(value: Path | str, repo_root: Path) -> Path:
    config_path = Path(value).expanduser()
    if not config_path.is_absolute():
        raise SetupError("Private configuration path must be absolute")
    try:
        config_path = config_path.parent.resolve(strict=False) / config_path.name
    except (OSError, RuntimeError) as error:
        raise SetupError("Private configuration path cannot be resolved") from error
    parent = config_path.parent
    root = repo_root.resolve()
    if parent == Path(parent.anchor) or parent == Path.home().resolve():
        raise SetupError("Private configuration needs its own directory")
    if _is_within(parent, root) or _is_within(root, parent):
        raise SetupError("Private configuration must be separate from the repository checkout")
    if parent.exists():
        mode = stat.S_IMODE(parent.stat().st_mode)
        if mode & (stat.S_ISVTX | 0o022):
            raise SetupError("Choose a private config directory, not a shared or writable directory")
    return config_path


def _ensure_private_directory(directory: Path) -> None:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not directory.is_dir():
        raise SetupError("Private configuration parent is not a directory")
    try:
        directory.chmod(0o700)
    except OSError as error:
        raise SetupError("Could not set private directory permissions to 0700") from error
    if stat.S_IMODE(directory.stat().st_mode) != 0o700:
        raise SetupError("Private directory permissions must be 0700")


def _fsync_directory(directory: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    descriptor = os.open(directory, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save_config(config_path: Path, config: dict, repo_root: Path) -> None:
    config_path = validate_config_path(config_path, repo_root)
    repo_root = repo_root.resolve()
    config_parent = config_path.parent.resolve(strict=False)
    if config_path.is_symlink():
        raise SetupError("Refusing to replace a symbolic-link configuration file")
    validated = validate_config(config, repo_root)
    _ensure_private_directory(config_parent)

    encoded = (json.dumps(validated, indent=2, sort_keys=True) + "\n").encode("utf-8")
    descriptor, temporary_name = tempfile.mkstemp(prefix=".operator-config-", dir=config_parent)
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        stream = os.fdopen(descriptor, "wb")
        descriptor = None
        with stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, config_path)
        _fsync_directory(config_parent)
    except Exception:
        if descriptor is not None:
            os.close(descriptor)
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def load_config(config_path: Path, repo_root: Path) -> dict:
    config_path = validate_config_path(config_path, repo_root)
    repo_root = repo_root.resolve()
    config_parent = config_path.parent.resolve(strict=False)
    if config_path.is_symlink():
        raise SetupError("Refusing to read a symbolic-link configuration file")
    try:
        info = config_path.stat()
    except FileNotFoundError as error:
        raise SetupError("No operator configuration was found; run ./setup first") from error
    if not stat.S_ISREG(info.st_mode):
        raise SetupError("Operator configuration is not a regular file")
    if stat.S_IMODE(info.st_mode) != 0o600:
        raise SetupError("Operator configuration permissions must be 0600; run ./setup to save it securely")
    if not config_path.parent.is_dir() or stat.S_IMODE(config_path.parent.stat().st_mode) != 0o700:
        raise SetupError("Operator configuration directory permissions must be 0700; run ./setup to secure it")
    if info.st_size > 64 * 1024:
        raise SetupError("Operator configuration is unexpectedly large")
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SetupError("Operator configuration could not be read as JSON") from error
    return validate_config(data, repo_root)


def _current_host_label() -> str:
    return platform.node() or socket.gethostname() or "this-host"


def _prompt_value(
    label: str,
    current: object,
    fallback: object,
    validator,
    input_fn,
    *,
    optional: bool = False,
    display=None,
):
    default = current if current is not None else fallback
    display_value = display(default) if display else ("not set" if default is None and optional else default)
    while True:
        raw = input_fn(f"{label} [{display_value}]: ")
        if raw == "":
            candidate = default
        elif raw.strip() == "-" and optional:
            candidate = None
        else:
            candidate = raw
        try:
            return None if candidate is None and optional else validator(candidate)
        except SetupError as error:
            print(error, file=sys.stderr)


def _prompt_secret(label: str, current: str | None, secret_fn) -> str | None:
    try:
        raw = secret_fn(f"{label} (Enter keeps a saved value or leaves it unset): ")
    except (getpass.GetPassWarning, OSError) as error:
        raise SetupError("Secret entry requires a terminal with masked input") from error
    if raw == "":
        return current
    return validate_secret(raw, label)


def read_masked_secret(prompt: str) -> str:
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise SetupError("Secret entry requires a terminal with masked input")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        return getpass.getpass(prompt, stream=sys.stderr)


def collect_configuration(
    existing: dict | None,
    repo_root: Path,
    *,
    input_fn=input,
    secret_fn=read_masked_secret,
    home: Path | None = None,
    environment: dict | None = None,
) -> dict:
    existing = existing or {}
    root = repo_root.resolve()
    home = (home or Path.home()).expanduser()
    runtime_default = str(default_runtime_root(home, environment).resolve(strict=False))
    codex_default = str(default_codex_home(home).resolve(strict=False))

    host_label = _prompt_value(
        "Current host label (informational)",
        existing.get("host_label"),
        _current_host_label(),
        validate_label,
        input_fn,
    )
    public_origin = _prompt_value(
        "Public HTTPS origin (optional; host label does not provision it)",
        existing.get("public_https_origin"),
        None,
        validate_origin,
        input_fn,
        optional=True,
    )
    runtime_root = _prompt_value(
        "Private runtime directory",
        existing.get("runtime_root"),
        runtime_default,
        lambda value: _absolute_private_directory(value, "Private runtime directory", root),
        input_fn,
    )
    codex_home = _prompt_value(
        "Dedicated CODEX_HOME",
        existing.get("codex_home"),
        codex_default,
        lambda value: _absolute_private_directory(value, "Dedicated CODEX_HOME", root),
        input_fn,
    )

    fal_key = _prompt_secret("FAL_KEY", existing.get("fal_key"), secret_fn)
    openrouter_key = _prompt_secret("OPENROUTER_API_KEY", existing.get("openrouter_api_key"), secret_fn)

    video_root = _prompt_value(
        "Private video-reference root (optional)",
        existing.get("video_reference_root"),
        None,
        lambda value: _optional_private_directory(value, "Video-reference root", root),
        input_fn,
        optional=True,
    )
    site_port = _prompt_value(
        "Site port (auto uses the existing free-port selection)",
        existing.get("site_port"),
        None,
        lambda value: validate_port(value, "Site port"),
        input_fn,
        optional=True,
        display=_format_port,
    )
    engine_port = _prompt_value(
        "Engine port (auto uses the existing free-port selection)",
        existing.get("engine_port"),
        None,
        lambda value: validate_port(value, "Engine port"),
        input_fn,
        optional=True,
        display=_format_port,
    )

    config = {
        "version": CONFIG_VERSION,
        "host_label": host_label,
        "public_https_origin": public_origin,
        "runtime_root": runtime_root,
        "codex_home": codex_home,
        "fal_key": fal_key,
        "openrouter_api_key": openrouter_key,
        "video_reference_root": video_root,
        "site_port": site_port,
        "engine_port": engine_port,
    }
    while site_port is not None and site_port == engine_port:
        print("Site and engine ports must differ.", file=sys.stderr)
        engine_port = _prompt_value(
            "Engine port (auto uses the existing free-port selection)",
            None,
            None,
            lambda value: validate_port(value, "Engine port"),
            input_fn,
            optional=True,
            display=_format_port,
        )
        config["engine_port"] = engine_port
    return validate_config(config, root)


def _format_port(value: int | None) -> str:
    return str(value) if value is not None else "auto"


def print_configuration_summary(config: dict, config_path: Path) -> None:
    print("Configuration summary (secrets are never displayed):")
    print(f"  Host label: {config['host_label']}")
    print(f"  Public HTTPS origin: {config['public_https_origin'] or 'not set'}")
    print(f"  Private runtime directory: {config['runtime_root']}")
    print(f"  Dedicated CODEX_HOME: {config['codex_home']}")
    print(f"  FAL key: {'configured' if config['fal_key'] else 'not set'}")
    print(f"  OpenRouter key: {'configured' if config['openrouter_api_key'] else 'not set'}")
    print(f"  Video-reference root: {config['video_reference_root'] or 'not set'}")
    print(f"  Site / engine ports: {_format_port(config['site_port'])} / {_format_port(config['engine_port'])}")
    print(f"  Private config file: {config_path}")


def configure(config_path: Path, repo_root: Path, *, input_fn=input, secret_fn=read_masked_secret) -> int:
    existing = None
    if config_path.exists() or config_path.is_symlink():
        existing = load_config(config_path, repo_root)
    config = collect_configuration(existing, repo_root, input_fn=input_fn, secret_fn=secret_fn)
    print_configuration_summary(config, config_path)
    if existing is not None:
        answer = input_fn("Replace the saved configuration? [y/N]: ").strip().lower()
        confirmed = answer in ("y", "yes")
    else:
        answer = input_fn("Save this private configuration? [Y/n]: ").strip().lower()
        confirmed = answer not in ("n", "no")
    if not confirmed:
        print("Configuration was not saved.")
        return 0
    save_config(config_path, config, repo_root)
    print("Configuration saved with mode 0600 in a mode 0700 directory.")
    return 0


def build_run_environment(config: dict, base_environment: dict | None = None) -> dict:
    environment = dict(os.environ if base_environment is None else base_environment)
    for key in MANAGED_ENVIRONMENT:
        environment.pop(key, None)
    environment["CODEX_HOME"] = config["codex_home"]
    environment["WARDROBE_ALPHA_RUNTIME_ROOT"] = config["runtime_root"]
    if config["fal_key"]:
        environment["FAL_KEY"] = config["fal_key"]
    if config["openrouter_api_key"]:
        environment["OPENROUTER_API_KEY"] = config["openrouter_api_key"]
        environment["ZEELY_VLM_PROVIDER"] = "openrouter"
    environment["ZEELY_GENERATION_PROVIDER"] = "codex-primary"
    if config["public_https_origin"]:
        environment["ZEELY_PUBLIC_HTTPS_ORIGIN"] = config["public_https_origin"]
    if config["video_reference_root"]:
        environment["ZEELY_VIDEO_REFERENCE_ROOT"] = config["video_reference_root"]
    if config["site_port"] is not None:
        environment["WARDROBE_ALPHA_SITE_PORT"] = str(config["site_port"])
    if config["engine_port"] is not None:
        environment["WARDROBE_ALPHA_ENGINE_PORT"] = str(config["engine_port"])
    return environment


def _prepare_runtime_directory(path: Path) -> None:
    _ensure_private_directory(path)


def run_product(repo_root: Path, config: dict, *, base_environment: dict | None = None, runner=subprocess.run) -> int:
    environment = build_run_environment(config, base_environment)
    if config["video_reference_root"]:
        missing = [name for name in ("ffmpeg", "ffprobe")
                   if shutil.which(name, path=environment.get("PATH", os.defpath)) is None]
        if missing:
            raise SetupError("Fashion Video requires " + ", ".join(missing)
                             + " on the run PATH. Install FFmpeg and run ./setup run again.")
    _prepare_runtime_directory(Path(config["runtime_root"]))
    old_umask = os.umask(0o077)
    try:
        result = runner(["./verify", "--run"], cwd=str(repo_root), env=environment, check=False)
    finally:
        os.umask(old_umask)
    return int(result.returncode)


def report_check(config: dict) -> None:
    codex_auth = Path(config["codex_home"]) / "auth.json"
    auth_present = codex_auth.is_file()
    video_root = Path(config["video_reference_root"]) if config["video_reference_root"] else None
    video_exists = bool(video_root and video_root.is_dir())

    print("Configuration: valid; config mode 0600 and directory mode 0700")
    print(f"Host label: {config['host_label']} (informational; no host provisioning was attempted)")
    print(f"Public HTTPS origin: {config['public_https_origin'] or 'not set'} (DNS and TLS were not checked)")
    print(f"Codex auth file: {'present' if auth_present else 'missing'} (presence only; account and authorization were not checked)")
    print(f"FAL credential: {'configured' if config['fal_key'] else 'missing'} (not verified)")
    print(f"OpenRouter credential: {'configured' if config['openrouter_api_key'] else 'missing'} (not verified)")
    if video_root:
        state = "directory present" if video_exists else "directory missing"
        print(f"Video-reference root: {state} (manifest hashes were not checked)")
    else:
        print("Video-reference root: not configured")
    print("Video tools on PATH: " + ", ".join(
        f"{name} {'found' if shutil.which(name) else 'missing'}"
        for name in ("ffmpeg", "ffprobe")) + " (path lookup only; not executed)")
    print(f"Ports: site {_format_port(config['site_port'])}, engine {_format_port(config['engine_port'])}")
    if not auth_present or not config["fal_key"] or not config["openrouter_api_key"]:
        print("Local UI can run with missing credentials; unavailable provider features remain unverified.")


def load_config_for_run(config_path: Path, repo_root: Path, *, configure_fn=None) -> dict | None:
    configure_fn = configure if configure_fn is None else configure_fn
    if config_path.exists() or config_path.is_symlink():
        return load_config(config_path, repo_root)
    if configure_fn(config_path, repo_root) != 0:
        return None
    if not config_path.exists():
        print("Run aborted because no operator configuration was saved.", file=sys.stderr)
        return None
    return load_config(config_path, repo_root)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="./setup",
        description="Configure or run the complete local Wardrobe alpha product.",
        epilog=(
            "A host label or HTTPS origin does not provision a server, DNS or TLS. "
            "Run this command on the target host after cloning the alpha branch."
        ),
    )
    parser.add_argument("command", nargs="?", choices=("configure", "run"), default="configure")
    parser.add_argument("--check", action="store_true", help="validate private config and report local auth/key presence without provider calls")
    parser.add_argument("--config", type=Path, help="absolute private JSON config path (default: platform WardrobeAlpha path)")
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parents[1]
    try:
        config_path = validate_config_path(args.config or default_config_path(), repo_root)
        if args.check:
            if args.command != "configure":
                parser.error("--check cannot be combined with a command")
            config = load_config(config_path, repo_root)
            report_check(config)
            return 0
        if args.command == "configure":
            return configure(config_path, repo_root)
        config = load_config_for_run(config_path, repo_root)
        if config is None:
            return 1
        report_check(config)
        return run_product(repo_root, config)
    except (SetupError, OSError, subprocess.SubprocessError) as error:
        print(f"operator setup failed: {error}", file=sys.stderr)
        return 1
    except EOFError:
        print("operator setup failed: input ended before configuration was saved", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\noperator setup interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
