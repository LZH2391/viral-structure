#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
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

from storyboard_pdf_material_frames import build_material_frame_index


PAGE_WIDTH, PAGE_HEIGHT = A4
PAGE_BG = colors.HexColor("#f7f7f4")
CARD_X = 28
CARD_Y = 30
CARD_WIDTH = PAGE_WIDTH - CARD_X * 2
CARD_HEIGHT = PAGE_HEIGHT - CARD_Y * 2
CARD_PADDING = 16
CARD_INNER_X = CARD_X + CARD_PADDING
CARD_INNER_WIDTH = CARD_WIDTH - CARD_PADDING * 2
MEDIA_COLS = 3
MEDIA_GAP = 0
MEDIA_ROW_HEIGHT = 154
MEDIA_TEXT_HEIGHT = 58
MEDIA_ROW_GAP = 18
MAX_SHOTS_PER_PAGE = 6
INFO_LINE_HEIGHT = 11


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
    material_frame_dir = output_path.with_name("shot-storyboard-material-frames")
    material_indexes = [
        build_material_frame_index(read_json(Path(item).resolve()), root, Path(item).resolve().parent, material_frame_dir)
        for item in args.material_frame_map
    ]

    result = build_pdf({
        "restructurePath": Path(args.restructure).resolve(),
        "shotDesignPath": shot_design_path,
        "manifestPath": Path(args.manifest).resolve(),
        "cropsManifestPath": Path(args.crops_manifest).resolve() if args.crops_manifest else None,
        "manifest": manifest,
        "crops": crops,
        "materialIndexes": material_indexes,
        "materialFrameDir": material_frame_dir,
        "materialFrameMapPaths": [str(Path(item).resolve()) for item in args.material_frame_map],
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
    for slot in slots:
        pages = chunk_fixed(slot["shots"], MAX_SHOTS_PER_PAGE)
        for page_index, page_shots in enumerate(pages):
            page_media = [resolve_shot_media(shot, crop_index, context, warnings) for shot in page_shots]
            draw_slot_page(doc, slot, page_shots, page_media, page_index, len(pages), context)
            doc.showPage()
    doc.save()
    result = {
        "type": "shot-storyboard-pdf",
        "schemaVersion": "shot-storyboard-pdf.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "output": str(output_path),
        "slotCount": len(slots),
        "shotCount": sum(len(slot["shots"]) for slot in slots),
        "warnings": dedupe(warnings),
        "materialFrameMapPaths": context.get("materialFrameMapPaths", []),
        "materialFrameDir": str(context.get("materialFrameDir")) if context.get("materialFrameDir") and context["materialFrameDir"].exists() else None,
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


def group_shots_by_slot(shots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    slots = []
    current_key = None
    for shot in shots:
        key = shot.get("slotKey") or shot.get("slotSubtype") or "未标明 slot"
        if key != current_key:
            slots.append({"index": len(slots) + 1, "slot": key, "slotLabel": shot.get("slotSubtype") or key, "shots": []})
            current_key = key
        slots[-1]["shots"].append(shot)
    return slots


def chunk_fixed(shots: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [shots[index : index + size] for index in range(0, len(shots), size)] or [[]]


def draw_slot_page(
    doc: canvas.Canvas,
    slot: dict[str, Any],
    shots: list[dict[str, Any]],
    media: list[dict[str, Any]],
    page_index: int,
    page_count: int,
    context: dict[str, Any],
) -> None:
    draw_page_shell(doc)
    header_y = PAGE_HEIGHT - CARD_Y - 30
    slot_title = slot_title_text(slot, page_index, page_count)
    doc.setFont(font_name(), 17)
    doc.setFillColor(colors.HexColor("#222222"))
    doc.drawString(CARD_INNER_X, header_y, fit_text(slot_title, CARD_INNER_WIDTH, 17))
    doc.setFont(font_name(), 10)
    doc.setFillColor(colors.HexColor("#666666"))
    doc.drawString(CARD_INNER_X, header_y - 22, fit_text(f"链路：{slot_chain_text(shots)}", CARD_INNER_WIDTH - 90, 10))
    doc.setFont(font_name(), 8)
    doc.setFillColor(colors.HexColor("#888888"))
    doc.drawRightString(CARD_X + CARD_WIDTH - CARD_PADDING, header_y - 22, context["shotDesignPath"].name)

    first_row_y = header_y - 98 - MEDIA_ROW_HEIGHT
    second_row_y = first_row_y - MEDIA_TEXT_HEIGHT - MEDIA_ROW_GAP - MEDIA_ROW_HEIGHT
    draw_media_row(doc, shots[:3], media[:3], first_row_y)
    if len(shots) > 3:
        draw_media_row(doc, shots[3:6], media[3:6], second_row_y)

    footer_y = CARD_Y + 86
    doc.setStrokeColor(colors.HexColor("#e5e5df"))
    doc.line(CARD_INNER_X, footer_y + 34, CARD_INNER_X + CARD_INNER_WIDTH, footer_y + 34)
    doc.setFont(font_name(), 10)
    doc.setFillColor(colors.HexColor("#444444"))
    doc.drawString(CARD_INNER_X, footer_y + 12, fit_text(f"restructure：{slot_footer_text(slot, shots)}", CARD_INNER_WIDTH, 10))
    doc.setFillColor(colors.HexColor("#777777"))
    doc.drawString(CARD_INNER_X, footer_y - 8, "素材取代表帧；自设计取四格图切分帧。")


def draw_page_shell(doc: canvas.Canvas) -> None:
    doc.setFillColor(PAGE_BG)
    doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)
    doc.setFillColor(colors.white)
    doc.setStrokeColor(colors.HexColor("#d8d8d0"))
    doc.roundRect(CARD_X, CARD_Y, CARD_WIDTH, CARD_HEIGHT, radius=8, stroke=1, fill=1)


def draw_media_row(doc: canvas.Canvas, shots: list[dict[str, Any]], media: list[dict[str, Any]], y: float) -> None:
    if not shots:
        return
    cell_width = (CARD_INNER_WIDTH - MEDIA_GAP * (MEDIA_COLS - 1)) / MEDIA_COLS
    doc.setFillColor(colors.HexColor("#111111"))
    doc.rect(CARD_INNER_X, y, CARD_INNER_WIDTH, MEDIA_ROW_HEIGHT, stroke=0, fill=1)
    for index, (shot, item) in enumerate(zip(shots, media)):
        x = CARD_INNER_X + index * (cell_width + MEDIA_GAP)
        draw_shot_image(doc, x + 2, y + 2, cell_width - 4, MEDIA_ROW_HEIGHT - 4, shot, item)
        draw_shot_caption(doc, x, y - 18, cell_width, shot, item)


def draw_shot_image(doc: canvas.Canvas, x: float, y: float, width: float, height: float, shot: dict[str, Any], media: dict[str, Any]) -> None:
    path = media.get("path")
    if path and Path(path).exists():
        try:
            draw_contain_image(doc, str(path), x, y, width, height)
        except Exception:
            draw_placeholder(doc, x, y, width, height, "图片读取失败")
    else:
        draw_placeholder(doc, x, y, width, height, "缺代表帧")
    doc.setStrokeColor(colors.HexColor("#222222"))
    doc.rect(x, y, width, height, stroke=1, fill=0)
    doc.setFont(font_name(), 7)
    doc.setFillColor(colors.HexColor("#111111"))
    label_width = min(width - 8, max(28, pdfmetrics.stringWidth(shot.get("shotId", ""), font_name(), 7) + 8))
    doc.roundRect(x + 4, y + height - 15, label_width, 11, radius=3, stroke=0, fill=1)
    doc.setFillColor(colors.white)
    doc.drawString(x + 8, y + height - 12, shot.get("shotId", ""))


def draw_contain_image(doc: canvas.Canvas, path: str, x: float, y: float, width: float, height: float) -> None:
    reader = ImageReader(path)
    image_width, image_height = reader.getSize()
    if image_width <= 0 or image_height <= 0:
        raise ValueError("invalid image size")
    scale = min(width / image_width, height / image_height)
    draw_width = image_width * scale
    draw_height = image_height * scale
    draw_x = x + (width - draw_width) / 2
    draw_y = y + (height - draw_height) / 2
    doc.drawImage(reader, draw_x, draw_y, width=draw_width, height=draw_height)


def draw_placeholder(doc: canvas.Canvas, x: float, y: float, width: float, height: float, label: str) -> None:
    doc.setFillColor(colors.HexColor("#eeeeee"))
    doc.rect(x, y, width, height, stroke=0, fill=1)
    doc.setFillColor(colors.HexColor("#777777"))
    doc.setFont(font_name(), 9)
    doc.drawCentredString(x + width / 2, y + height / 2, label)


def draw_shot_caption(doc: canvas.Canvas, x: float, y: float, width: float, shot: dict[str, Any], media: dict[str, Any]) -> None:
    doc.setFont(font_name(), 9)
    doc.setFillColor(colors.HexColor("#222222"))
    doc.drawString(x + 2, y, fit_text(f"{shot_number(shot)} · {source_label_for_shot(shot, media)}", width - 6, 9))
    doc.setFont(font_name(), 8)
    doc.setFillColor(colors.HexColor("#555555"))
    doc.drawString(x + 2, y - 16, fit_text(caption_detail_for_shot(shot), width - 6, 8))


def slot_title_text(slot: dict[str, Any], page_index: int, page_count: int) -> str:
    suffix = f" · {page_index + 1}/{page_count}" if page_count > 1 else ""
    return f"Slot {slot['index']:02d} · {slot['slot'].replace('`', '')}{suffix}"


def slot_chain_text(shots: list[dict[str, Any]]) -> str:
    items = []
    for shot in shots:
        subtype = str(shot.get("slotSubtype") or "").replace("`", "")
        key = str(shot.get("slotKey") or "")
        label = normalize_text(subtype.replace(key, ""))
        label = label or source_label_for_shot(shot, {})
        if label and label not in items:
            items.append(label)
    return " → ".join(items[:5]) or "未标明"


def slot_footer_text(slot: dict[str, Any], shots: list[dict[str, Any]]) -> str:
    proof_items = [normalize_text(shot.get("proofFunction") or "") for shot in shots]
    proof_items = [item for item in proof_items if item]
    if proof_items:
        return truncate("；".join(dedupe(proof_items)[:2]), 72)
    return normalize_text(slot.get("slotLabel") or slot.get("slot") or "")


def shot_number(shot: dict[str, Any]) -> str:
    text = str(shot.get("shotId") or "")
    digits = "".join(char for char in text if char.isdigit())
    return digits[-2:] if digits else text


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


def caption_detail_for_shot(shot: dict[str, Any]) -> str:
    strategy = shot.get("strategy") or ""
    dialogue = normalize_text(shot.get("dialogue") or shot.get("imagePrompt") or "")
    packaging = compact_packaging_text(shot.get("overlayPackaging") or "")
    if strategy == "existing_material_packaging_caption":
        return f"新增标签：{packaging or dialogue}"
    if strategy == "existing_material":
        return f"原字幕：{dialogue}"
    if strategy == "self_designed_by_shot_design":
        return f"台词：{dialogue}"
    return dialogue or packaging


def compact_packaging_text(value: str) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    for separator in ("；", ";", "，", ","):
        if separator in text:
            return text.split(separator, 1)[0]
    return text



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


def fit_text(value: str, width: float, font_size: int) -> str:
    text = normalize_text(value)
    if pdfmetrics.stringWidth(text, font_name(), font_size) <= width:
        return text
    ellipsis = "…"
    current = ""
    for char in text:
        candidate = f"{current}{char}"
        if pdfmetrics.stringWidth(f"{candidate}{ellipsis}", font_name(), font_size) > width:
            return f"{current}{ellipsis}" if current else ellipsis
        current = candidate
    return current


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
