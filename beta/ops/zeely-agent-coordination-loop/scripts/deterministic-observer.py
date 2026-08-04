#!/usr/bin/env python3
"""Emit a safe coordination report from the typed GitHub watcher output.

This is deliberately not an agent or model. It ignores stdin, runs the
checked-in read-only watcher, retains only task IDs, agent IDs, state, and
typed issue codes, and writes Markdown to stdout for Looper's own workspace.
"""

from __future__ import annotations

import json
import subprocess
import sys


WATCH_COMMAND = ["node", "../../tools/coordination/watch-agent-reports.mjs", "--once"]


def read_snapshot() -> dict[str, object] | None:
    result = subprocess.run(
        WATCH_COMMAND,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        encoding="utf-8",
        errors="replace",
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        return None
    for line in reversed(result.stdout.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if value.get("event") == "AGENT_REPORTS":
            return value
    return None


def render() -> str:
    snapshot = read_snapshot()
    lines = ["# Coordination report", "", "## Observed reports", ""]
    if snapshot is None:
        lines.append("- Watch snapshot unavailable; no lane was modified.")
        lines.extend([
            "",
            "## Required follow-up",
            "",
            "- Orchestrator should rerun the typed watcher before changing a lease.",
        ])
    else:
        reports = snapshot.get("reports", [])
        issues = snapshot.get("issues", [])
        if reports:
            for report in reports:
                lines.append(
                    f"- {report.get('task_id')} / {report.get('agent_id')}: {report.get('state')}"
                )
        else:
            lines.append("- No valid agent status reports are currently published.")
        lines.extend(["", "## Required follow-up", ""])
        if issues:
            for issue in issues:
                lines.append(
                    f"- {issue.get('task_id')} / {issue.get('agent_id')}: {issue.get('code')}"
                )
        else:
            lines.append("- None; typed report snapshot has no outstanding issue.")
    lines.extend([
        "",
        "## Safety boundary",
        "",
        "- Deterministic read-only observer; no lane, product, provider, or credential mutation occurred.",
    ])
    return "\n".join(lines)


if __name__ == "__main__":
    _ = sys.stdin.read()
    print(render())
