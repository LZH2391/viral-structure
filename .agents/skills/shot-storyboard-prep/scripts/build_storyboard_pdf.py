#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas


PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT_MARGIN = 36
RIGHT_MARGIN = 36
TOP_MARGIN = 36
BOTTOM_MARGIN = 42
MAX_COLS = 4
MIN_SHOT_WIDTH = 150
STRIP_GAP = 16
INFO_LINE_HEIGHT = 12


def main() -> None:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Build shot-storyboard.pdf from storyboard prep outputs.")
    parser.add_argument("--restructure", required=True, help="restructure.final.md")
    parser.add_argument("--shot-design", required=True, help="shot-design.final.md")
    parser.add_argument("--manifest", required=True, help="shot-storyboard-manifest.json")
    parser.add_argument("--crops-manifest", help="shot-storyboard-crops.json")
    parser.add_argument("--material-frame-map", action="append", default=[], help="Optional JSON files that map material shotRef/groupId to image paths")
    parser.add_argument("--output", help="Output PDF path; defaults to <shot-design dir>/shot-storyboard.pdf")
    parser.add_argument("--root", default=".", help="Repository root used to resolve /runtime URIs")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    shot_design_path = Path(args.shot_design).resolve()
    output_path = Path(args.output).resolve() if args.output else shot_design_path.with_name("shot-storyboard.pdf")
    manifest = read_json(Path(args.manifest).resolve())
    crops = read_json(Path(args.crops_manifest).resolve()) if args.crops_manifest else {"crops": []}
    material_indexes = [build_material_frame_index(read_json(Path(item).resolve()), root) for item in args.material_frame_map]

    result = build_pdf({
        "restructurePath": Path(args.restructure).resolve(),
        "shotDesignPath": shot_design_path,
        "manifestPath": Path(args.manifest).resolve(),
        "cropsManifestPath": Path(args.crops_manifest).resolve() if args.crops_manifest else None,
        "manifest": manifest,
        "crops": crops,
        "materialIndexes": material_indexes,
        "outputPath": output_path,
        "root": root,
    })
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))


def configure_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def build_pdf(context: dict[str, Any]) -> dict[str, Any]:
    output_path: Path = context["outputPath"]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    register_font()
    crop_index = {item.get("shotId"): item for item in context["crops"].get("crops", [])}
    slots = group_shots_by_slot(context["manifest"].get("shots", []))
    warnings = list(context["manifest"].get("warnings") or []) + list(context["crops"].get("warnings") or [])

    doc = canvas.Canvas(str(output_path), pagesize=A4)
    state = {"y": PAGE_HEIGHT - TOP_MARGIN}
    draw_title(doc, state, context)
    for slot in slots:
        slot_height = estimate_slot_height(slot["shots"])
        ensure_space(doc, state, slot_height)
        draw_slot_heading(doc, state, slot)
        rows = chunk_shots(slot["shots"], PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN)
        for row in rows:
            row_media = [resolve_shot_media(shot, crop_index, context, warnings) for shot in row]
            draw_strip(doc, state, row, row_media)
    doc.save()
    result = {
        "type": "shot-storyboard-pdf",
        "schemaVersion": "shot-storyboard-pdf.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "output": str(output_path),
        "slotCount": len(slots),
        "shotCount": sum(len(slot["shots"]) for slot in slots),
        "warnings": dedupe(warnings),
        "source": {
            "restructureFinalPath": str(context["restructurePath"]),
            "shotDesignFinalPath": str(context["shotDesignPath"]),
            "manifestPath": str(context["manifestPath"]),
            "cropsManifestPath": str(context["cropsManifestPath"]) if context["cropsManifestPath"] else None,
        },
    }
    sidecar = output_path.with_suffix(".summary.json")
    sidecar.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    result["summary"] = str(sidecar)
    return result


def register_font() -> None:
    try:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    except Exception:
        pass


def font_name() -> str:
    return "STSong-Light" if "STSong-Light" in pdfmetrics.getRegisteredFontNames() else "Helvetica"


def draw_title(doc: canvas.Canvas, state: dict[str, float], context: dict[str, Any]) -> None:
    doc.setFont(font_name(), 15)
    doc.drawString(LEFT_MARGIN, state["y"], "Shot Storyboard")
    state["y"] -= 20
    doc.setFont(font_name(), 8)
    doc.setFillColor(colors.HexColor("#555555"))
    doc.drawString(LEFT_MARGIN, state["y"], f"shot-design: {context['shotDesignPath'].name}")
    state["y"] -= 18
    doc.setFillColor(colors.black)


def group_shots_by_slot(shots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    slots = []
    current_key = None
    for shot in shots:
        key = shot.get("slotKey") or shot.get("slotSubtype") or "未标明 slot"
        if key != current_key:
            slots.append({"slot": key, "slotLabel": shot.get("slotSubtype") or key, "shots": []})
            current_key = key
        slots[-1]["shots"].append(shot)
    return slots


def estimate_slot_height(shots: list[dict[str, Any]]) -> float:
    rows = chunk_shots(shots, PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN)
    return 24 + len(rows) * (112 + 48 + STRIP_GAP)


def ensure_space(doc: canvas.Canvas, state: dict[str, float], needed: float) -> None:
    if state["y"] - needed < BOTTOM_MARGIN:
        doc.showPage()
        state["y"] = PAGE_HEIGHT - TOP_MARGIN


def draw_slot_heading(doc: canvas.Canvas, state: dict[str, float], slot: dict[str, Any]) -> None:
    doc.setFont(font_name(), 10)
    doc.setFillColor(colors.HexColor("#111111"))
    text = truncate(slot["slot"].replace("`", ""), 96)
    doc.drawString(LEFT_MARGIN, state["y"], text)
    state["y"] -= 14


def chunk_shots(shots: list[dict[str, Any]], available_width: float) -> list[list[dict[str, Any]]]:
    if not shots:
        return []
    if available_width / len(shots) >= MIN_SHOT_WIDTH and len(shots) <= MAX_COLS:
        cols = len(shots)
    else:
        cols = max(1, min(MAX_COLS, math.floor(available_width / MIN_SHOT_WIDTH)))
    return [shots[index : index + cols] for index in range(0, len(shots), cols)]


def draw_strip(doc: canvas.Canvas, state: dict[str, float], shots: list[dict[str, Any]], media: list[dict[str, Any]]) -> None:
    available_width = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN
    shot_width = math.floor(available_width / len(shots))
    shot_height = 96
    x = LEFT_MARGIN
    y = state["y"] - shot_height
    for shot, item in zip(shots, media):
        draw_shot_image(doc, x, y, shot_width, shot_height, shot, item)
        x += shot_width
    state["y"] = y - 4
    draw_info_row(doc, state, shots, media, shot_width)
    state["y"] -= STRIP_GAP


def draw_shot_image(doc: canvas.Canvas, x: float, y: float, width: float, height: float, shot: dict[str, Any], media: dict[str, Any]) -> None:
    path = media.get("path")
    if path and Path(path).exists():
        try:
            reader = ImageReader(path)
            doc.drawImage(reader, x, y, width=width, height=height, preserveAspectRatio=True, anchor="c")
        except Exception:
            draw_placeholder(doc, x, y, width, height, "图片读取失败")
    else:
        draw_placeholder(doc, x, y, width, height, "缺代表帧")
    doc.setStrokeColor(colors.HexColor("#222222"))
    doc.rect(x, y, width, height, stroke=1, fill=0)
    doc.setFont(font_name(), 7)
    doc.setFillColor(colors.white)
    doc.setStrokeColor(colors.black)
    doc.setFillColor(colors.HexColor("#111111"))
    doc.drawString(x + 4, y + height - 10, shot.get("shotId", ""))


def draw_placeholder(doc: canvas.Canvas, x: float, y: float, width: float, height: float, label: str) -> None:
    doc.setFillColor(colors.HexColor("#eeeeee"))
    doc.rect(x, y, width, height, stroke=0, fill=1)
    doc.setFillColor(colors.HexColor("#777777"))
    doc.setFont(font_name(), 9)
    doc.drawCentredString(x + width / 2, y + height / 2, label)


def draw_info_row(doc: canvas.Canvas, state: dict[str, float], shots: list[dict[str, Any]], media: list[dict[str, Any]], shot_width: float) -> None:
    max_lines = 0
    rendered = []
    for shot, item in zip(shots, media):
        source_label = source_label_for_shot(shot, item)
        text = " / ".join(part for part in [
            shot.get("shotId", ""),
            source_label,
            normalize_text(shot.get("dialogue") or "无台词"),
            normalize_text(shot.get("overlayPackaging") or ""),
        ] if part)
        lines = wrap_text(text, shot_width - 8, 7)
        rendered.append(lines)
        max_lines = max(max_lines, len(lines))
    x = LEFT_MARGIN
    y = state["y"]
    doc.setFont(font_name(), 7)
    doc.setFillColor(colors.HexColor("#222222"))
    for lines in rendered:
        for index, line in enumerate(lines[:4]):
            doc.drawString(x + 4, y - index * INFO_LINE_HEIGHT, line)
        x += shot_width
    state["y"] -= min(max_lines, 4) * INFO_LINE_HEIGHT + 4


def resolve_shot_media(shot: dict[str, Any], crop_index: dict[str, Any], context: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    shot_id = shot.get("shotId")
    if shot.get("shouldGenerate"):
        crop = crop_index.get(shot_id)
        if crop and crop.get("path"):
            return {"kind": "self_designed", "path": crop.get("path")}
        warnings.append(f"{shot_id}: 自设计镜头缺少裁切帧")
        return {"kind": "self_designed", "path": None}
    for ref in shot.get("sourceRefs") or []:
        for index in context["materialIndexes"]:
            path = index.get(ref)
            if path:
                return {"kind": "material", "path": path, "sourceRef": ref}
    warnings.append(f"{shot_id}: 素材镜头缺少代表帧 sourceRefs={shot.get('sourceRefs')}")
    return {"kind": "material", "path": None, "sourceRef": ",".join(shot.get("sourceRefs") or [])}


def source_label_for_shot(shot: dict[str, Any], media: dict[str, Any]) -> str:
    strategy = shot.get("strategy") or "unknown"
    if strategy == "self_designed_by_shot_design":
        return "自设计"
    if strategy == "existing_material_packaging_caption":
        return f"素材+包装补强 {media.get('sourceRef') or ''}".strip()
    if strategy == "existing_material":
        return f"素材 {media.get('sourceRef') or ''}".strip()
    return strategy


def build_material_frame_index(value: Any, root: Path) -> dict[str, str]:
    index: dict[str, str] = {}
    visit_material_node(value, root, index)
    return index


def visit_material_node(value: Any, root: Path, index: dict[str, str]) -> None:
    if isinstance(value, dict):
        ref = value.get("shotRef") or value.get("groupId") or value.get("shotId")
        image_path = value.get("representativeFrame") or value.get("localImagePath") or value.get("filePath") or value.get("path") or value.get("uri")
        if ref and isinstance(image_path, str):
            resolved = resolve_path_or_uri(image_path, root)
            if resolved and resolved.exists():
                index[str(ref)] = str(resolved)
        for child in value.values():
            visit_material_node(child, root, index)
    elif isinstance(value, list):
        for item in value:
            visit_material_node(item, root, index)


def resolve_path_or_uri(value: str, root: Path) -> Path | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.startswith("/runtime/"):
        return (root / "Runtime" / text[len("/runtime/") :]).resolve()
    if text.startswith("runtime/"):
        return (root / "Runtime" / text[len("runtime/") :]).resolve()
    return Path(text).resolve()


def wrap_text(text: str, width: float, font_size: int) -> list[str]:
    words = list(text)
    lines = []
    current = ""
    for char in words:
        candidate = f"{current}{char}"
        if pdfmetrics.stringWidth(candidate, font_name(), font_size) <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = char
    if current:
        lines.append(current)
    return lines or [""]


def normalize_text(value: str) -> str:
    return " ".join(str(value or "").split())


def truncate(value: str, max_length: int) -> str:
    text = normalize_text(value)
    return text if len(text) <= max_length else f"{text[:max_length - 1]}…"


def dedupe(values: list[str]) -> list[str]:
    result = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


if __name__ == "__main__":
    main()
