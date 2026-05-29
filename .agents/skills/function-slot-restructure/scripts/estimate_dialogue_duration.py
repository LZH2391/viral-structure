#!/usr/bin/env python3
"""Estimate dialogue duration from character count.

This utility is for checking dialogue that already exists. It must not be used
to allocate time during slot, atom, or shot design.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any, List


DEFAULT_CHARS_PER_SECOND = 6.0


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def extract_json_values(value: Any, key_names: set[str]) -> List[str]:
    values: List[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key in key_names and isinstance(child, str):
                values.append(child)
            else:
                values.extend(extract_json_values(child, key_names))
    elif isinstance(value, list):
        for child in value:
            values.extend(extract_json_values(child, key_names))
    return values


def count_dialogue_chars(text: str) -> int:
    # Count spoken/readable characters, ignoring whitespace and common punctuation.
    cleaned = re.sub(r"\s+", "", text)
    cleaned = re.sub(r"[，。！？、,.!?;；:：\"'“”‘’（）()\[\]【】《》<>…—\-]", "", cleaned)
    return len(cleaned)


def estimate_seconds(char_count: int, chars_per_second: float) -> float:
    if chars_per_second <= 0:
        raise ValueError("chars_per_second must be greater than 0")
    return char_count / chars_per_second


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--text", help="Dialogue text to estimate")
    source.add_argument("--file", help="UTF-8 text or JSON file containing dialogue")
    parser.add_argument(
        "--json-keys",
        default="台词,字幕,line,dialogue,voiceover,text",
        help="Comma-separated JSON keys to extract when --file points to JSON",
    )
    parser.add_argument(
        "--chars-per-second",
        type=float,
        default=DEFAULT_CHARS_PER_SECOND,
        help="Reading speed. Default: 6 characters per second",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    args = parser.parse_args()

    input_kind = "text"
    if args.text is not None:
        lines = [args.text]
    else:
        path = Path(args.file)
        raw = read_text(path)
        input_kind = "file"
        if path.suffix.lower() == ".json":
            key_names = {x.strip() for x in args.json_keys.split(",") if x.strip()}
            lines = extract_json_values(json.loads(raw), key_names)
            input_kind = "json"
        else:
            lines = [raw]

    text = "\n".join(lines)
    char_count = count_dialogue_chars(text)
    seconds = estimate_seconds(char_count, args.chars_per_second)
    result = {
        "inputKind": input_kind,
        "charsPerSecond": args.chars_per_second,
        "dialogueItemCount": len(lines),
        "charCount": char_count,
        "estimatedSeconds": round(seconds, 2),
        "estimatedSecondsCeil": int(math.ceil(seconds)),
        "note": "Estimate only. Do not use this to allocate time during restructure design.",
    }
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))


if __name__ == "__main__":
    main()
