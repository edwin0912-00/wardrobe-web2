#!/usr/bin/env python3
"""Prepare and verify hash-bound RGB, matte, and relative-depth video references.

OpenCV/NumPy and the pinned Transformers/PyTorch depth model are imported only
for the operations that need them. Manifest inspection and --help stay light.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import tempfile
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable

SCHEMA_VERSION = "wardrobe-video-reference-preparation-v1"
DEPTH_MODEL = "depth-anything/Depth-Anything-V2-Small-hf"
DEPTH_REVISION = "5426e4f0f36572d16453bbda7a8389317b1bef99"
EXPECTED_REFERENCES = (
    ("editorial-detail", "reference-01.mp4", 331, 13.24),
    ("walk-camera-energy", "reference-02.mp4", 379, 15.16),
    ("hard-sun-pose", "reference-03.mp4", 378, 15.12),
    ("architectural-stair-glitch", "reference-04.mp4", 375, 15.0),
)
DEFAULT_MANIFEST = Path(__file__).resolve().parents[1] / "config" / "video-reference-preparation" / "fashion-cool-style-v1.json"


class PreparationError(ValueError):
    """An input, metadata, or output failed a preservation check."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_manifest(path: Path = DEFAULT_MANIFEST) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PreparationError(f"Cannot read manifest: {error}") from error
    validate_manifest(manifest)
    return manifest


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(ch in "0123456789abcdef" for ch in value)


def validate_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise PreparationError("Unsupported video preparation manifest schema")
    model = manifest.get("depth_model", {})
    if model.get("id") != DEPTH_MODEL or model.get("revision") != DEPTH_REVISION:
        raise PreparationError("Depth model ID and revision must match the pinned approved model")
    references = manifest.get("references")
    if not isinstance(references, list) or len(references) != len(EXPECTED_REFERENCES):
        raise PreparationError("Manifest must contain the four approved references")

    for reference, expected in zip(references, EXPECTED_REFERENCES, strict=True):
        ref_id, filename, frames, duration = expected
        if (reference.get("id"), reference.get("filename")) != (ref_id, filename):
            raise PreparationError("Reference IDs and filenames must remain in catalog order")
        if not _is_sha256(reference.get("source_sha256")):
            raise PreparationError(f"{ref_id}: invalid source SHA-256")
        if (reference.get("width"), reference.get("height"), reference.get("fps")) != (1080, 1920, "25/1"):
            raise PreparationError(f"{ref_id}: source geometry or frame rate changed")
        if reference.get("frame_count") != frames or abs(float(reference.get("duration_seconds", -1)) - duration) > 0.001:
            raise PreparationError(f"{ref_id}: source frame count or duration changed")

        outputs = reference.get("outputs", {})
        stem = Path(filename).stem
        expected_outputs = {
            "rgb": f"{stem}-anonymized.mp4",
            "matte": f"{stem}-mask.mp4",
            "depth": f"{stem}-depth.mp4",
        }
        if outputs != expected_outputs:
            raise PreparationError(f"{ref_id}: output filenames must follow the approved pack names")

        tracks = reference.get("face_tracks", {})
        bound = tracks.get("bound_to", {})
        if bound != {
            "source_sha256": reference["source_sha256"],
            "width": 1080,
            "height": 1920,
            "fps": "25/1",
            "frame_count": frames,
        }:
            raise PreparationError(f"{ref_id}: face tracks are not bound to this exact source and geometry")
        frame_tracks = tracks.get("frames")
        if not isinstance(frame_tracks, list) or len(frame_tracks) != frames:
            raise PreparationError(f"{ref_id}: face track frame count does not match the source")
        for index, row in enumerate(frame_tracks):
            if row.get("frame") != index or not isinstance(row.get("shapes"), list):
                raise PreparationError(f"{ref_id}: face track indices must cover each source frame in order")
            for shape in row["shapes"]:
                if (not isinstance(shape, list) or len(shape) != 5
                        or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in shape)
                        or shape[2] <= 0 or shape[3] <= 0):
                    raise PreparationError(f"{ref_id}: invalid face ellipse at frame {index}")
        if tracks.get("rasterization") not in ("LINE_8", "LINE_AA_THRESHOLD_128"):
            raise PreparationError(f"{ref_id}: unsupported matte rasterization rule")
        threshold = 128 if tracks["rasterization"] == "LINE_AA_THRESHOLD_128" else None
        if tracks.get("threshold") != threshold:
            raise PreparationError(f"{ref_id}: matte threshold does not match its rasterization rule")


def probe_video(path: Path) -> dict[str, Any]:
    command = [
        "ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate,nb_read_frames,duration,pix_fmt,color_range",
        "-of", "json", str(path),
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        streams = json.loads(result.stdout).get("streams", [])
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        raise PreparationError(f"ffprobe could not verify {path.name}: {error}") from error
    if not streams:
        raise PreparationError(f"ffprobe found no video stream in {path.name}")
    stream = streams[0]
    try:
        stream["width"] = int(stream["width"])
        stream["height"] = int(stream["height"])
        stream["frame_count"] = int(stream.pop("nb_read_frames"))
        stream["duration_seconds"] = float(stream.pop("duration"))
        Fraction(stream["avg_frame_rate"])
    except (KeyError, TypeError, ValueError, ZeroDivisionError) as error:
        raise PreparationError(f"ffprobe returned incomplete video metadata for {path.name}") from error
    return stream


def validate_source(reference: dict[str, Any], source_root: Path, probe_fn: Callable[[Path], dict[str, Any]] = probe_video) -> tuple[Path, dict[str, Any]]:
    source = source_root / reference["filename"]
    if not source.is_file():
        raise PreparationError(f"Missing source file: {reference['filename']}")
    actual_hash = sha256_file(source)
    if actual_hash != reference["source_sha256"]:
        raise PreparationError(f"Source SHA-256 changed: {reference['filename']}")
    metadata = probe_fn(source)
    expected = {
        "width": reference["width"],
        "height": reference["height"],
        "avg_frame_rate": reference["fps"],
        "frame_count": reference["frame_count"],
    }
    for key, value in expected.items():
        if metadata.get(key) != value:
            raise PreparationError(f"Source {reference['filename']} {key} changed")
    if abs(metadata.get("duration_seconds", -1) - reference["duration_seconds"]) > 0.001:
        raise PreparationError(f"Source {reference['filename']} duration changed")
    return source, metadata


def validate_sources(manifest: dict[str, Any], source_root: Path, probe_fn: Callable[[Path], dict[str, Any]] = probe_video) -> list[tuple[Path, dict[str, Any]]]:
    source_root = source_root.resolve()
    return [validate_source(reference, source_root, probe_fn) for reference in manifest["references"]]


def assert_binary_mask_values(values: Any) -> set[int]:
    observed = {int(value) for value in values}
    if not observed or not observed <= {0, 255}:
        raise PreparationError("Matte pixels must be full-range binary values 0 or 255")
    return observed


def _require_cv2_numpy() -> tuple[Any, Any]:
    try:
        import cv2  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
    except ImportError as error:
        raise PreparationError("Video processing requires the documented local OpenCV and NumPy environment") from error
    return cv2, np


def _output_paths(reference: dict[str, Any], output_root: Path) -> dict[str, Path]:
    return {kind: output_root / filename for kind, filename in reference["outputs"].items()}


def _spawn_encoder(command: list[str]) -> subprocess.Popen[bytes]:
    try:
        return subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as error:
        raise PreparationError(f"Could not start ffmpeg: {error}") from error


def _close_encoder_input(process: subprocess.Popen[bytes]) -> None:
    if process.stdin and not process.stdin.closed:
        try:
            process.stdin.close()
        except BrokenPipeError:
            pass


def _finish_encoder(process: subprocess.Popen[bytes], label: str) -> None:
    error_text = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
    status = process.wait()
    if status != 0:
        raise PreparationError(f"ffmpeg failed while writing {label}: {error_text[-800:]}")


def _face_frame(cv2: Any, np: Any, frame: Any, row: dict[str, Any], rasterization: str) -> Any:
    matte = np.zeros(frame.shape[:2], dtype=np.uint8)
    line_type = cv2.LINE_AA if rasterization == "LINE_AA_THRESHOLD_128" else cv2.LINE_8
    for cx, cy, rx, ry, angle in row["shapes"]:
        cv2.ellipse(
            matte,
            (round(cx), round(cy)),
            (max(1, round(rx)), max(1, round(ry))),
            angle,
            0,
            360,
            255,
            -1,
            lineType=line_type,
        )
    if rasterization == "LINE_AA_THRESHOLD_128":
        matte = (matte >= 128).astype(np.uint8) * 255
    frame[matte > 0] = (128, 128, 128)
    return frame, matte


def _render_rgb_and_matte(reference: dict[str, Any], source: Path, outputs: dict[str, Path], cv2: Any, np: Any) -> None:
    width, height = reference["width"], reference["height"]
    rate = reference["fps"]
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise PreparationError(f"OpenCV could not decode {reference['filename']}")

    rgb_command = [
        "ffmpeg", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}", "-framerate", rate, "-i", "-",
        "-i", str(source), "-map", "0:v:0", "-map", "1:a?", "-c:v", "libx264",
        "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy",
        "-movflags", "+faststart", "-n", str(outputs["rgb"]),
    ]
    matte_command = [
        "ffmpeg", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray",
        "-s", f"{width}x{height}", "-framerate", rate, "-i", "-", "-an",
        "-c:v", "libx264", "-preset", "fast", "-crf", "0", "-pix_fmt", "yuv444p",
        "-color_range", "pc", "-movflags", "+faststart", "-n", str(outputs["matte"]),
    ]
    rgb_encoder = _spawn_encoder(rgb_command)
    try:
        matte_encoder = _spawn_encoder(matte_command)
    except BaseException:
        _close_encoder_input(rgb_encoder)
        rgb_encoder.terminate()
        rgb_encoder.wait()
        raise
    rows = reference["face_tracks"]["frames"]
    try:
        for index, row in enumerate(rows):
            ok, frame = capture.read()
            if not ok:
                raise PreparationError(f"Missing source frame {index} in {reference['filename']}")
            rgb_frame, matte = _face_frame(cv2, np, frame, row, reference["face_tracks"]["rasterization"])
            assert rgb_encoder.stdin is not None and matte_encoder.stdin is not None
            rgb_encoder.stdin.write(rgb_frame.tobytes())
            matte_encoder.stdin.write(matte.tobytes())
        if capture.read()[0]:
            raise PreparationError(f"Source {reference['filename']} has more frames than its reviewed tracks")
    except BaseException:
        capture.release()
        for encoder in (rgb_encoder, matte_encoder):
            _close_encoder_input(encoder)
            if encoder.poll() is None:
                encoder.terminate()
        for encoder in (rgb_encoder, matte_encoder):
            encoder.wait()
            if encoder.stderr:
                encoder.stderr.read()
        raise
    capture.release()
    for encoder in (rgb_encoder, matte_encoder):
        _close_encoder_input(encoder)
    _finish_encoder(rgb_encoder, outputs["rgb"].name)
    _finish_encoder(matte_encoder, outputs["matte"].name)


def _depth_model(np: Any) -> tuple[Any, Any, str]:
    try:
        import torch  # type: ignore[import-not-found]
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation  # type: ignore[import-not-found]
    except ImportError as error:
        raise PreparationError("Depth inference requires the documented local PyTorch and Transformers environment") from error
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    if device == "cpu":
        torch.set_num_threads(4)
    processor = AutoImageProcessor.from_pretrained(DEPTH_MODEL, revision=DEPTH_REVISION)
    model = AutoModelForDepthEstimation.from_pretrained(DEPTH_MODEL, revision=DEPTH_REVISION)
    if getattr(model.config, "_commit_hash", None) not in (None, DEPTH_REVISION):
        raise PreparationError("Loaded depth model does not match the pinned revision")
    model.to(device).eval()
    return torch, (processor, model), device


def _render_depth(reference: dict[str, Any], source: Path, destination: Path, cv2: Any, np: Any, torch: Any, model_pair: tuple[Any, Any], device: str, output_root: Path) -> None:
    processor, model = model_pair
    frame_count = reference["frame_count"]
    width, height = 252, 448
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise PreparationError(f"OpenCV could not decode {reference['filename']} for depth inference")

    with tempfile.TemporaryDirectory(prefix=".video-depth-", dir=output_root) as temporary:
        cache_path = Path(temporary) / "relative-depth.float16"
        values = np.memmap(cache_path, dtype=np.float16, mode="w+", shape=(frame_count, height, width))
        try:
            with torch.inference_mode():
                for index in range(frame_count):
                    ok, frame = capture.read()
                    if not ok:
                        raise PreparationError(f"Missing source frame {index} during depth inference")
                    resized = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
                    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
                    inputs = processor(images=rgb, do_resize=False, return_tensors="pt")
                    prediction = model(**{key: value.to(device) for key, value in inputs.items()}).predicted_depth
                    prediction = torch.nn.functional.interpolate(
                        prediction.unsqueeze(1), size=(height, width), mode="bicubic", align_corners=False,
                    )
                    array = prediction[0, 0].float().cpu().numpy()
                    if not np.isfinite(array).all():
                        raise PreparationError(f"Depth model returned a non-finite value at frame {index}")
                    values[index] = array.astype(np.float16)
            if capture.read()[0]:
                raise PreparationError("Depth inference decoded more frames than the source manifest")
            values.flush()
        finally:
            capture.release()

        sample = np.asarray(values[:, ::8, ::8], dtype=np.float32)
        low, high = np.percentile(sample, [1, 99])
        if not math.isfinite(float(low)) or not math.isfinite(float(high)) or high <= low:
            raise PreparationError("Depth prediction has no finite clip-wide normalization range")
        command = [
            "ffmpeg", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", f"{width}x{height}", "-framerate", reference["fps"], "-i", "-",
            "-an", "-vf", "scale=720:1280:flags=bicubic", "-c:v", "libx264",
            "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", "-n", str(destination),
        ]
        encoder = _spawn_encoder(command)
        try:
            assert encoder.stdin is not None
            for index in range(frame_count):
                normalized = np.clip((values[index].astype(np.float32) - low) / (high - low), 0, 1)
                encoder.stdin.write(np.rint(normalized * 255).astype(np.uint8).tobytes())
            _close_encoder_input(encoder)
        except BaseException:
            _close_encoder_input(encoder)
            encoder.kill()
            encoder.wait()
            raise
        _finish_encoder(encoder, destination.name)


def _assert_output_metadata(reference: dict[str, Any], kind: str, metadata: dict[str, Any]) -> None:
    width, height = (720, 1280) if kind == "depth" else (1080, 1920)
    if metadata.get("width") != width or metadata.get("height") != height:
        raise PreparationError(f"{reference['id']} {kind} geometry changed")
    if metadata.get("avg_frame_rate") != reference["fps"] or metadata.get("frame_count") != reference["frame_count"]:
        raise PreparationError(f"{reference['id']} {kind} frame rate or frame count changed")
    if abs(metadata.get("duration_seconds", -1) - reference["duration_seconds"]) > 0.001:
        raise PreparationError(f"{reference['id']} {kind} duration changed")
    if kind == "matte" and (metadata.get("pix_fmt") not in ("yuv444p", "yuvj444p") or metadata.get("color_range") != "pc"):
        raise PreparationError(f"{reference['id']} matte must be encoded full-range 4:4:4")


def inspect_sources(manifest: dict[str, Any], source_root: Path, probe_fn: Callable[[Path], dict[str, Any]] = probe_video) -> list[dict[str, Any]]:
    result = []
    for reference, (source, metadata) in zip(manifest["references"], validate_sources(manifest, source_root, probe_fn), strict=True):
        result.append({
            "id": reference["id"],
            "filename": reference["filename"],
            "source_sha256": reference["source_sha256"],
            "frames": metadata["frame_count"],
            "fps": metadata["avg_frame_rate"],
            "duration_seconds": metadata["duration_seconds"],
        })
    return result


def prepare(manifest: dict[str, Any], source_root: Path, output_root: Path) -> dict[str, Any]:
    source_root, output_root = source_root.resolve(), output_root.resolve()
    if source_root == output_root:
        raise PreparationError("Output root must differ from the original source root")
    sources = validate_sources(manifest, source_root)
    output_paths = [
        path
        for reference in manifest["references"]
        for path in _output_paths(reference, output_root).values()
    ]
    if any(path.exists() for path in output_paths):
        raise PreparationError("At least one derivative already exists; choose a fresh output root to preserve it")
    output_root.mkdir(parents=True, exist_ok=True)
    cv2, np = _require_cv2_numpy()
    cv2.setNumThreads(2)
    torch, model_pair, device = _depth_model(np)
    for reference, (source, _) in zip(manifest["references"], sources, strict=True):
        outputs = _output_paths(reference, output_root)
        _render_rgb_and_matte(reference, source, outputs, cv2, np)
        _render_depth(reference, source, outputs["depth"], cv2, np, torch, model_pair, device, output_root)
        if sha256_file(source) != reference["source_sha256"]:
            raise PreparationError(f"Original changed during processing: {reference['filename']}")
        for kind, path in outputs.items():
            _assert_output_metadata(reference, kind, probe_video(path))
    return {"status": "PREPARED", "references": len(manifest["references"]), "derivatives": len(output_paths), "depth_device": device}


def verify(manifest: dict[str, Any], source_root: Path, output_root: Path) -> dict[str, Any]:
    cv2, np = _require_cv2_numpy()
    cv2.setNumThreads(2)
    output_root = output_root.resolve()
    sources = validate_sources(manifest, source_root)
    hashes: list[str] = []
    reports = []
    for reference, (source, source_meta) in zip(manifest["references"], sources, strict=True):
        outputs = _output_paths(reference, output_root)
        metadata: dict[str, dict[str, Any]] = {}
        for kind, path in outputs.items():
            if not path.is_file() or path.stat().st_size == 0:
                raise PreparationError(f"Missing or empty {reference['id']} {kind} derivative")
            probe = probe_video(path)
            _assert_output_metadata(reference, kind, probe)
            metadata[kind] = probe
            hashes.append(sha256_file(path))

        mask_capture = cv2.VideoCapture(str(outputs["matte"]))
        rgb_capture = cv2.VideoCapture(str(outputs["rgb"]))
        if not mask_capture.isOpened() or not rgb_capture.isOpened():
            raise PreparationError(f"Could not decode {reference['id']} RGB and matte outputs")
        decoded = 0
        frames_with_core = 0
        max_core_p99 = 0.0
        mask_values: set[int] = set()
        kernel = np.ones((33, 33), dtype=np.uint8)
        try:
            while True:
                mask_ok, matte = mask_capture.read()
                rgb_ok, rgb = rgb_capture.read()
                if mask_ok != rgb_ok:
                    raise PreparationError(f"{reference['id']} RGB and matte frame counts differ")
                if not mask_ok:
                    break
                decoded += 1
                unique = assert_binary_mask_values(np.unique(matte[:, :, 0]))
                mask_values.update(unique)
                core = cv2.erode((matte[:, :, 0] > 250).astype(np.uint8), kernel).astype(bool)
                if core.any():
                    frames_with_core += 1
                    pixels = rgb[core].astype(np.int16)
                    spread = pixels.max(axis=1) - pixels.min(axis=1)
                    max_core_p99 = max(max_core_p99, float(np.percentile(spread, 99)))
        finally:
            mask_capture.release()
            rgb_capture.release()
        if decoded != reference["frame_count"] or not mask_values <= {0, 255}:
            raise PreparationError(f"{reference['id']} matte values or decoded frame count failed verification")
        if frames_with_core == 0 or max_core_p99 > 5:
            raise PreparationError(f"{reference['id']} neutral matte core exceeded the codec spread limit")
        reports.append({
            "id": reference["id"],
            "source_sha256": reference["source_sha256"],
            "source_frames": source_meta["frame_count"],
            "derivative_sha256": {kind: sha256_file(path) for kind, path in outputs.items()},
            "mask_values": sorted(mask_values),
            "frames_with_mask_core": frames_with_core,
            "max_mask_core_p99_channel_spread": max_core_p99,
        })
    if len(set(hashes)) != 12:
        raise PreparationError("The twelve derivative files must all have distinct SHA-256 values")
    return {
        "status": "PASS",
        "source_count": len(sources),
        "derivative_count": len(hashes),
        "unique_derivatives": len(set(hashes)),
        "tracks_are_reviewed_inputs_not_privacy_guarantees": True,
        "references": reports,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("inspect", "prepare", "verify"):
        command = subparsers.add_parser(name)
        command.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
        command.add_argument("--source-root", type=Path, required=True)
        if name != "inspect":
            command.add_argument("--output-root", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        manifest = load_manifest(args.manifest)
        if args.command == "inspect":
            result = {"status": "PASS", "references": inspect_sources(manifest, args.source_root)}
        elif args.command == "prepare":
            result = prepare(manifest, args.source_root, args.output_root)
        else:
            result = verify(manifest, args.source_root, args.output_root)
    except (PreparationError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"status": "FAIL", "error": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
