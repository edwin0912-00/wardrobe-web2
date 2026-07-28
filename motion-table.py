#!/usr/bin/env python3
"""Turn a master's real motion into a scroll-to-time table that imposes an exact curve.

Why this exists
---------------
Asking the video model for a sine was tried three times and produced a peak at second 10,
then second 5, then second 4. Prompt-steering the speed curve is coarse. Worse, once the
footage carries its own uneven pace, easing the scroll-to-time mapping on top of it
COMPOUNDS the two curves instead of correcting anything — which is why the movement still
did not read as a sine even after the mapping was eased.

So the footage is now asked for CONSTANT speed, which a dolly gives easily, and the curve
is imposed here where it is exact:

  1. measure per-frame visual motion of the master
  2. integrate it into cumulative motion C(t), normalised to 0..1
  3. pick the target curve S(u) — cumulative motion wanted at scroll fraction u
  4. invert:  t(u) = C-inverse( S(u) )
  5. emit t(u) as a lookup table the engine reads instead of easing time directly

The result is that VISUAL motion follows the curve, not clock time. No frames are invented
and none are duplicated: the browser still seeks to real times, so there is no judder.

Usage:  motion-table.py out.json master1.mp4 [master2.mp4 ...]
"""
import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

SAMPLES = 129          # table resolution per leg; odd so the midpoint is exact
ANALYSIS_WIDTH = 320   # motion is a large-scale quantity; full res adds noise, not signal


def frame_motion(path):
    """Mean absolute luma difference between consecutive frames, in order."""
    tmp = tempfile.mkdtemp(prefix="motion-")
    try:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-i", path, "-vsync", "0",
             "-vf", "scale=%d:-2" % ANALYSIS_WIDTH, os.path.join(tmp, "f%05d.png")],
            check=True,
        )
        files = sorted(os.listdir(tmp))
        prev = None
        out = []
        for name in files:
            a = np.asarray(Image.open(os.path.join(tmp, name)).convert("L"), dtype=np.int16)
            if prev is not None:
                out.append(float(np.abs(a - prev).mean()))
            prev = a
        return out, len(files)
    finally:
        for name in os.listdir(tmp):
            os.unlink(os.path.join(tmp, name))
        os.rmdir(tmp)


def probe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def sine_cumulative(u):
    """Cumulative distance for a sine speed profile: speed = sin(pi*u)."""
    return 0.5 - 0.5 * math.cos(math.pi * u)


def build(path):
    motion, n_frames = frame_motion(path)
    duration = probe_duration(path)
    if not motion:
        raise SystemExit("no motion measured in %s" % path)

    # Cumulative motion against frame index, normalised.
    cum = np.concatenate([[0.0], np.cumsum(motion)])
    if cum[-1] <= 0:
        raise SystemExit("%s has no motion at all" % path)
    cum = cum / cum[-1]

    # Frame index -> time, evenly spaced across the real duration.
    times = np.linspace(0.0, duration, len(cum))

    # Invert: for each scroll fraction, find the time whose cumulative motion matches
    # the curve's cumulative distance.
    table = []
    for i in range(SAMPLES):
        u = i / (SAMPLES - 1)
        want = sine_cumulative(u)
        t = float(np.interp(want, cum, times))
        table.append(round(t, 4))

    # How uneven was the source? This is the number that says whether the correction
    # was doing real work or nothing at all.
    speed = np.asarray(motion, dtype=float)
    unevenness = float(speed.std() / speed.mean()) if speed.mean() > 0 else 0.0

    return {
        "file": os.path.basename(path),
        "duration": round(duration, 4),
        "frames": n_frames,
        "table": table,
        "sourceUnevenness": round(unevenness, 4),
        "sourcePeakAtFraction": round(float(np.argmax(
            np.convolve(speed, np.ones(9) / 9, mode="same"))) / len(speed), 4),
    }


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    out_path = sys.argv[1]
    legs = [build(p) for p in sys.argv[2:]]
    payload = {
        "curve": "sine-in-out",
        "samples": SAMPLES,
        "note": "t = C-inverse(S(u)); index the table with scroll fraction inside the leg",
        "legs": legs,
    }
    with open(out_path, "w") as fh:
        json.dump(payload, fh, indent=2)
    for leg in legs:
        print("%-16s dur %6.2fs  frames %4d  unevenness %.3f  source peak at %.2f"
              % (leg["file"], leg["duration"], leg["frames"],
                 leg["sourceUnevenness"], leg["sourcePeakAtFraction"]))
    print("wrote", out_path)


if __name__ == "__main__":
    main()
