#!/usr/bin/env python3
"""Fill rough shot duration from dialogue text at 6 chars/second.

Inputs:
- --text: one dialogue/subtitle string.
- --file: a UTF-8 text file, or a JSON shot table when used with --shot-json.

Shot JSON can be a list of rows or an object containing shots, shotDesign, or
items. Each row reads dialogue from 台词/字幕（若有）, 台词, 字幕, dialogue,
voiceover, or text, then writes 预计时长 back into the returned row.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any


DEFAULT_CHARS_PER_SECOND = 6.0
DEFAULT_DIALOGUE_KEYS = ("台词/字幕（若有）", "台词", "字幕", "dialogue", "voiceover", "text")


def count_dialogue_chars(text: str) -> int:
    cleaned = re.sub(r"\s+", "", text)
    cleaned = re.sub(r"[，。！？、,.!?;；:：\"'“”‘’（）()\[\]【】《》<>…—\-]", "", cleaned)
    return len(cleaned)


def duration_label(dialogue: str, chars_per_second: float) -> dict[str, Any]:
    text = dialogue.strip()
    if not text or text == "无":
        return {
            "charCount": 0,
            "estimatedSeconds": None,
            "estimatedSecondsCeil": None,
            "预计时长": "待无台词时长说明",
        }

    char_count = count_dialogue_chars(text)
    seconds = char_count / chars_per_second
    return {
        "charCount": char_count,
        "estimatedSeconds": round(seconds, 2),
        "estimatedSecondsCeil": int(math.ceil(seconds)),
        "预计时长": f"约 {round(seconds, 2)}s（{char_count} 字 / {chars_per_second:g} 字每秒）",
    }


def first_dialogue(row: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str):
            return value
    return ""


def shot_rows(data: Any) -> list[dict[str, Any]]:
    rows = data
    if isinstance(data, dict):
        rows = data.get("shots") or data.get("shotDesign") or data.get("items") or []
    if not isinstance(rows, list):
        raise ValueError("shot JSON must be a list or contain shots/shotDesign/items")
    return [row for row in rows if isinstance(row, dict)]


def fill_shot_json(data: Any, dialogue_keys: tuple[str, ...], chars_per_second: float) -> dict[str, Any]:
    items = []
    for index, row in enumerate(shot_rows(data), 1):
        estimate = duration_label(first_dialogue(row, dialogue_keys), chars_per_second)
        updated = dict(row)
        updated["预计时长"] = estimate["预计时长"]
        items.append({
            "shot": row.get("shot") or row.get("shotId") or row.get("id") or f"shot_{index}",
            **estimate,
            "row": updated,
        })
    return {
        "inputKind": "shot_json",
        "charsPerSecond": chars_per_second,
        "items": items,
        "note": "预计时长只由台词列计算；无台词行需要另写不能与台词并行的时长说明。",
    }


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--text", help="Dialogue text to estimate")
    source.add_argument("--file", help="UTF-8 text or JSON file containing dialogue")
    parser.add_argument("--shot-json", action="store_true", help="Fill 预计时长 for JSON shot rows")
    parser.add_argument("--chars-per-second", type=float, default=DEFAULT_CHARS_PER_SECOND)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    if args.chars_per_second <= 0:
        raise ValueError("--chars-per-second must be greater than 0")

    if args.text is not None:
        result = {"inputKind": "text", "charsPerSecond": args.chars_per_second, **duration_label(args.text, args.chars_per_second)}
    else:
        path = Path(args.file)
        raw = path.read_text(encoding="utf-8-sig")
        if args.shot_json:
            result = fill_shot_json(json.loads(raw), DEFAULT_DIALOGUE_KEYS, args.chars_per_second)
        else:
            result = {"inputKind": "file", "charsPerSecond": args.chars_per_second, **duration_label(raw, args.chars_per_second)}

    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))


if __name__ == "__main__":
    main()
