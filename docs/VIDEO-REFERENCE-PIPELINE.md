# Fashion video reference preparation and replay

This operator workflow preserves the four approved catalog videos as separate RGB, binary matte, and monocular relative-depth derivatives. It binds reviewed per-frame face tracks to each original SHA-256, dimensions, frame rate, and frame count. It does not change the source clips or the normal provider checks.

## Prepare and verify the four references

The committed manifest contains catalog IDs and filenames, the four source hashes, exact timing, reviewed geometric tracks, and the pinned model revision. Supply the private source and destination folders when running it:

```sh
python3 beta/tools/prepare-video-references.py inspect \
  --manifest beta/config/video-reference-preparation/fashion-cool-style-v1.json \
  --source-root "$PRIVATE_VIDEO_SOURCE_ROOT"

python3 beta/tools/prepare-video-references.py prepare \
  --manifest beta/config/video-reference-preparation/fashion-cool-style-v1.json \
  --source-root "$PRIVATE_VIDEO_SOURCE_ROOT" \
  --output-root "$PRIVATE_VIDEO_DERIVATIVE_ROOT"

python3 beta/tools/prepare-video-references.py verify \
  --manifest beta/config/video-reference-preparation/fashion-cool-style-v1.json \
  --source-root "$PRIVATE_VIDEO_SOURCE_ROOT" \
  --output-root "$PRIVATE_VIDEO_DERIVATIVE_ROOT"
```

`inspect` checks the source hashes and uses FFprobe to confirm the expected 1080×1920, 25 FPS sources: 331 frames/13.24 seconds, 379/15.16, 378/15.12, and 375/15.00. It needs no image-processing libraries. `prepare` requires FFmpeg, FFprobe, OpenCV, NumPy, PyTorch, and Transformers. It loads `depth-anything/Depth-Anything-V2-Small-hf` at revision `5426e4f0f36572d16453bbda7a8389317b1bef99`; the operator environment may need that exact Hugging Face revision available locally or downloadable. The script does not install dependencies. `--help` and the metadata tests do not import OpenCV, NumPy, PyTorch, or Transformers.

Each reference produces three files named from its catalog source: `-anonymized.mp4`, `-mask.mp4`, and `-depth.mp4`. The RGB derivative replaces only the reviewed face ellipses with neutral gray and copies source audio when present. The matte is silent, binary 0/255, encoded full-range 4:4:4 (`yuv444p` or FFprobe's full-range alias `yuvj444p`); the two root-reviewed tracks use `LINE_8`, while the other two use antialiased drawing thresholded at 128. Depth is inferred from each original frame at 252×448, then encoded at 720×1280. One fixed 1st-to-99th percentile scale is computed for the whole source clip, so it does not normalize each frame independently. White represents higher predicted relative depth and black lower predicted relative depth; it is not metric geometry.

The tracks record reviewed detection and manual coverage. Detection and review do not prove every face or identifying detail is covered. Gray fill is not a guarantee of irreversible anonymization, and a depth map can preserve body and scene shape. Review the RGB, matte, and depth output before sharing it with a provider. The preprocessing tool never overwrites an existing derivative; use a fresh destination for a new render.

`verify` checks the original hashes again, output dimensions, exact frame count, 25 FPS and duration, full-range matte format, binary matte pixels, neutral RGB values inside an eroded matte core, and twelve distinct derivative hashes. These technical checks do not replace visual review. The already prepared private output set passed those checks for all four originals; `verify` can read that set without rewriting it.

## Replay the verified Seedance 2.5 reference pack

The replay tool is deliberately limited to the proven vertical Seedance 2.5 shape: two ordered images followed by two ordered MP4 videos, 720p 9:16 H.264 output, silent generation, and `task: "reference"`. It uses the supplied prompt bytes unchanged, including the full scene direction. The tool is separate from website creation and does not alter the normal provider route.

Create a private manifest that points to files under one private media root. Do not commit that manifest or prompt. Each video entry must include its expected FFprobe metadata as well as a SHA-256:

```json
{
  "schema_version": "wardrobe-seedance-reference-pack-v1",
  "model": "seedance-2.5",
  "task": "reference",
  "output": {
    "duration_seconds": 14,
    "resolution": "720p",
    "aspect_ratio": "9:16",
    "codec": "H264",
    "generate_audio": false
  },
  "files": [
    { "label": "@Image1", "kind": "image", "path": "approved-look.png", "mime_type": "image/png", "sha256": "<sha256>" },
    { "label": "@Image2", "kind": "image", "path": "garment-detail.png", "mime_type": "image/png", "sha256": "<sha256>" },
    {
      "label": "@Video1", "kind": "video", "path": "reference-01-anonymized.mp4", "mime_type": "video/mp4", "sha256": "<sha256>",
      "metadata": { "width": 1080, "height": 1920, "fps": "25/1", "frame_count": 331, "duration_seconds": 13.24 }
    },
    {
      "label": "@Video2", "kind": "video", "path": "reference-01-depth.mp4", "mime_type": "video/mp4", "sha256": "<sha256>",
      "metadata": { "width": 720, "height": 1280, "fps": "25/1", "frame_count": 331, "duration_seconds": 13.24 }
    }
  ]
}
```

Run without a mode first. This validates MIME signatures, hashes, image/video count and order, exact video metadata, model limits, prompt labels, and estimated cost. It performs no upload or provider request:

```sh
node beta/tools/seedance-reference-pack.mjs \
  --manifest "$PRIVATE_VIDEO_PACK_MANIFEST" \
  --media-root "$PRIVATE_VIDEO_MEDIA_ROOT" \
  --prompt-file "$PRIVATE_VIDEO_PROMPT"
```

Only a later, separately authorized paid run should set `FAL_KEY` in the process environment and add `--submit`, `--state-dir "$PRIVATE_VIDEO_STATE_ROOT"`, and an explicit `--max-estimate-usd`. The state directory must be private; the tool rejects group- or world-readable state directories on Unix. It contains the private upload URLs, prompt, and full request input; keep it outside Git. The tool uploads through the existing `@fal-ai/client` storage API, writes and fsyncs a `SUBMITTING` receipt, then makes one direct create POST. It does not use an SDK queue-submit method that could retry that POST. A failed or partial upload stops before creation.

The 720p estimate uses FAL's published token formula: `(720 × 1280 × (input video seconds + output seconds) × 24 / 1024) × $0.0214 / 1000 × 0.6` when video references are present. Image references are not billed by that formula. The estimate is a pre-submit guard, not a guarantee of final billing. The authorized test had 26.48 seconds of video inputs and a 14-second output request; its estimate was $11.22688512 and the observed charge was $11.105316. See [FAL's Seedance 2.5 reference-to-video pricing](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video).

The successful transport test returned HTTP 200 and a 720×1280, 24 FPS video lasting 14.041667 seconds. It also showed a gray mask remnant and a secondary operator, so the result was not polished. Its request ID, output hash, raw receipt, media, and storage URLs remain private. No new paid test is included here.

If a request was created, resume only its exact saved request ID with the same manifest, media, prompt, and private state directory:

```sh
node beta/tools/seedance-reference-pack.mjs \
  --manifest "$PRIVATE_VIDEO_PACK_MANIFEST" \
  --media-root "$PRIVATE_VIDEO_MEDIA_ROOT" \
  --prompt-file "$PRIVATE_VIDEO_PROMPT" \
  --state-dir "$PRIVATE_VIDEO_STATE_ROOT" \
  --resume "$EXACT_SAVED_REQUEST_ID"
```

The command verifies the source, prompt, complete input hash, endpoint, model, and saved upload roles before status/result reads. A rejected job or an unknown create outcome is never resubmitted. If a transport failure left no request ID, the saved `SUBMITTING`/`UNKNOWN` receipt blocks another create; contact the provider/operator through the existing recovery process instead of retrying.

Run the fake-backed focused suite with:

```sh
node --test beta/test/video/video-reference-preparation.test.js beta/test/video/seedance-reference-pack.test.js
```
