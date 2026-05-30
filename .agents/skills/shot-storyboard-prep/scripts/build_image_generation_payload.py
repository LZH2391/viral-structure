#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> None:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Build image-generation module payload for a storyboard prompt file.")
    parser.add_argument("--storyboard-prompt-file", required=True)
    parser.add_argument("--sample-video-id", required=True)
    parser.add_argument("--parent-artifact-id")
    parser.add_argument("--size")
    parser.add_argument("--quality")
    parser.add_argument("--timeout-seconds", type=float, default=450)
    parser.add_argument("--storyboard-retry-attempts", type=int, default=2)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    prompt_file = Path(args.storyboard_prompt_file).resolve()
    payload = {
        "sampleVideoId": args.sample_video_id,
        "storyboardPromptFile": str(prompt_file),
    }
    if args.parent_artifact_id:
        payload["parentArtifactId"] = args.parent_artifact_id
    if args.size:
        payload["size"] = args.size
    if args.quality:
        payload["quality"] = args.quality
    payload["timeoutSeconds"] = args.timeout_seconds
    payload["storyboardRetryAttempts"] = args.storyboard_retry_attempts

    print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None))


def configure_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")


if __name__ == "__main__":
    main()
