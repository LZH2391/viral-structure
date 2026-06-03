#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from PIL import Image


CONTACT_SHEET_LABEL_HEIGHT = 28
DIRECT_IMAGE_KEYS = (
    "representativeFrame",
    "representativeFramePath",
    "representativeFrameLocalPath",
    "localImagePath",
    "imagePath",
    "filePath",
    "framePath",
    "path",
    "uri",
    "imageUri",
)
REF_KEYS = ("shotRef", "sourceShotRef", "shotId", "id", "groupId")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def build_material_frame_index(value: Any, root: Path, base_dir: Path, output_dir: Path) -> dict[str, str]:
    index: dict[str, str] = {}
    visit_material_node(value, root, base_dir, index)
    visual_manifest = load_visual_manifest(value, root, base_dir) if isinstance(value, dict) else None
    source_index = build_source_frame_index(value, root, base_dir, visual_manifest)
    for ref, frame_path in source_index.items():
        index.setdefault(ref, frame_path)
    for ref, frame_path in build_visual_ref_index(value, root, base_dir, output_dir, visual_manifest, set(index)).items():
        index.setdefault(ref, frame_path)
    add_group_aliases(value, index)
    return index


def visit_material_node(value: Any, root: Path, base_dir: Path, index: dict[str, str]) -> None:
    if isinstance(value, dict):
        ref = first_text(value.get(key) for key in REF_KEYS)
        image_path = first_image_value(value)
        if ref and isinstance(image_path, str):
            resolved = resolve_path_or_uri(image_path, root, base_dir)
            if resolved and resolved.exists():
                index[str(ref)] = str(resolved)
        for child in value.values():
            visit_material_node(child, root, base_dir, index)
    elif isinstance(value, list):
        for item in value:
            visit_material_node(item, root, base_dir, index)


def first_image_value(value: dict[str, Any]) -> str | None:
    for key in DIRECT_IMAGE_KEYS:
        found = nested_image_value(value.get(key))
        if found:
            return found
    return None


def nested_image_value(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in DIRECT_IMAGE_KEYS:
            found = nested_image_value(value.get(key))
            if found:
                return found
    return None


def first_text(values: Any) -> str | None:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return None


def build_source_frame_index(value: Any, root: Path, base_dir: Path, visual_manifest: dict[str, Any] | None) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    sample_artifact = load_sample_artifact(value, root, base_dir)
    frames = sample_artifact.get("frames") if isinstance(sample_artifact, dict) else []
    if not isinstance(frames, list) or not frames:
        return {}
    shot_cards = value.get("shotCards") if isinstance(value.get("shotCards"), list) else []
    index: dict[str, str] = {}
    for card in shot_cards:
        if not isinstance(card, dict):
            continue
        ref = str(card.get("shotRef") or card.get("shotId") or "").strip()
        timestamp = representative_timestamp_for_card(card, visual_manifest)
        frame = closest_frame(frames, timestamp)
        image_value = first_image_value(frame) if isinstance(frame, dict) else None
        resolved = resolve_path_or_uri(image_value, root, base_dir) if image_value else None
        if ref and resolved and resolved.exists():
            index[ref] = str(resolved)
    return index


def load_sample_artifact(value: dict[str, Any], root: Path, base_dir: Path) -> dict[str, Any] | None:
    source_artifacts = value.get("sourceArtifacts") if isinstance(value.get("sourceArtifacts"), dict) else {}
    explicit = (
        value.get("sourceSampleArtifactPath")
        or value.get("sampleArtifactPath")
        or source_artifacts.get("sampleArtifactPath")
        or source_artifacts.get("sampleVideoArtifactPath")
    )
    if explicit:
        resolved = resolve_path_or_uri(str(explicit), root, base_dir)
        if resolved and resolved.exists():
            return read_json(resolved)
    sample_video_id = str(value.get("sampleVideoId") or "").strip()
    if sample_video_id:
        candidate = root / "Runtime" / "Artifacts" / sample_video_id / "artifact.json"
        if candidate.exists():
            return read_json(candidate)
    return None


def representative_timestamp_for_card(card: dict[str, Any], visual_manifest: dict[str, Any] | None) -> float | None:
    visual_ref = card.get("visualRef") if isinstance(card.get("visualRef"), dict) else {}
    for key in ("representativeFrameTimestamp", "middleTimestamp", "timestamp"):
        value = to_float(visual_ref.get(key))
        if value is not None:
            return value
    ref = str(card.get("shotRef") or card.get("shotId") or "").strip()
    sheet_id = str(visual_ref.get("sheetId") or "").strip()
    cell = find_visual_cell(visual_manifest or {}, sheet_id, ref) if ref and sheet_id else None
    if cell:
        for key in ("representativeFrameTimestamp", "middleTimestamp", "start"):
            value = to_float(cell.get(key))
            if value is not None:
                return value
    return None


def closest_frame(frames: list[Any], timestamp: float | None) -> dict[str, Any] | None:
    if timestamp is None:
        return None
    best = None
    best_distance = None
    for frame in frames:
        if not isinstance(frame, dict):
            continue
        frame_timestamp = to_float(frame.get("timestamp"))
        if frame_timestamp is None:
            continue
        distance = abs(frame_timestamp - timestamp)
        if best is None or best_distance is None or distance < best_distance:
            best = frame
            best_distance = distance
    return best


def build_visual_ref_index(
    value: Any,
    root: Path,
    base_dir: Path,
    output_dir: Path,
    visual_manifest: dict[str, Any] | None = None,
    skip_refs: set[str] | None = None,
) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    visual_manifest = visual_manifest or load_visual_manifest(value, root, base_dir)
    sheet_paths = resolve_sheet_paths(value, visual_manifest, root, base_dir)
    shot_cards = value.get("shotCards") if isinstance(value.get("shotCards"), list) else []
    index: dict[str, str] = {}
    if shot_cards:
        for card in shot_cards:
            if not isinstance(card, dict):
                continue
            ref = str(card.get("shotRef") or card.get("shotId") or "").strip()
            if ref in (skip_refs or set()):
                continue
            visual_ref = card.get("visualRef") if isinstance(card.get("visualRef"), dict) else {}
            path = crop_visual_ref(ref, visual_ref, visual_manifest, sheet_paths, output_dir)
            if ref and path:
                index[ref] = str(path)
    elif visual_manifest:
        for sheet in visual_manifest.get("sheets", []) or []:
            if not isinstance(sheet, dict):
                continue
            for cell in sheet.get("cells", []) or []:
                if not isinstance(cell, dict):
                    continue
                ref = str(cell.get("shotId") or cell.get("shotRef") or "").strip()
                if ref in (skip_refs or set()):
                    continue
                visual_ref = {"sheetId": sheet.get("sheetId"), "row": cell.get("row"), "col": cell.get("col")}
                path = crop_visual_ref(ref, visual_ref, visual_manifest, sheet_paths, output_dir)
                if ref and path:
                    index[ref] = str(path)
    return index


def load_visual_manifest(value: dict[str, Any], root: Path, base_dir: Path) -> dict[str, Any] | None:
    if isinstance(value.get("sheets"), list) and isinstance(value.get("shotSheets"), list):
        return value
    input_package = value.get("inputPackage") if isinstance(value.get("inputPackage"), dict) else {}
    manifest_path = input_package.get("visualManifestPath") or value.get("visualManifestPath")
    if manifest_path:
        resolved = resolve_path_or_uri(str(manifest_path), root, base_dir)
        if resolved and resolved.exists():
            return read_json(resolved)
    return None


def resolve_sheet_paths(value: dict[str, Any], visual_manifest: dict[str, Any] | None, root: Path, base_dir: Path) -> dict[str, Path]:
    result: dict[str, Path] = {}
    input_package = value.get("inputPackage") if isinstance(value.get("inputPackage"), dict) else {}
    attachments = input_package.get("visualAttachments") or value.get("visualAttachments") or []
    for attachment in attachments if isinstance(attachments, list) else []:
        if not isinstance(attachment, dict):
            continue
        sheet_id = str(attachment.get("sheetId") or "").strip()
        image_path = first_image_value(attachment)
        resolved = resolve_path_or_uri(image_path, root, base_dir) if image_path else None
        if sheet_id and resolved and resolved.exists():
            result[sheet_id] = resolved
    if visual_manifest:
        manifest_source_dir = resolve_visual_manifest_dir(value, root, base_dir)
        for sheet in visual_manifest.get("sheets", []) or []:
            if not isinstance(sheet, dict):
                continue
            sheet_id = str(sheet.get("sheetId") or "").strip()
            if sheet_id and sheet_id not in result:
                candidate = manifest_source_dir / "sheets" / f"{sheet_id}.jpg"
                if candidate.exists():
                    result[sheet_id] = candidate
    return result


def resolve_visual_manifest_dir(value: dict[str, Any], root: Path, base_dir: Path) -> Path:
    input_package = value.get("inputPackage") if isinstance(value.get("inputPackage"), dict) else {}
    manifest_path = input_package.get("visualManifestPath") or value.get("visualManifestPath")
    if manifest_path:
        resolved = resolve_path_or_uri(str(manifest_path), root, base_dir)
        if resolved:
            return resolved.parent
    return base_dir


def crop_visual_ref(
    ref: str,
    visual_ref: dict[str, Any],
    visual_manifest: dict[str, Any] | None,
    sheet_paths: dict[str, Path],
    output_dir: Path,
) -> Path | None:
    if not ref or not visual_manifest:
        return None
    sheet_id = str(visual_ref.get("sheetId") or "").strip()
    row = to_int(visual_ref.get("row"))
    col = to_int(visual_ref.get("col"))
    if (row is None or col is None) and sheet_id:
        cell = find_visual_cell(visual_manifest, sheet_id, ref)
        row = to_int(cell.get("row")) if cell else row
        col = to_int(cell.get("col")) if cell else col
    if not sheet_id or row is None or col is None:
        return None
    sheet_path = sheet_paths.get(sheet_id)
    if not sheet_path or not sheet_path.exists():
        return None
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{safe_filename(ref)}.png"
    with Image.open(sheet_path) as image:
        cols, rows = infer_sheet_grid(visual_manifest, sheet_id)
        if cols <= 0 or rows <= 0:
            return None
        cell_width = image.width / cols
        cell_height = image.height / rows
        left = round(col * cell_width)
        top = round(row * cell_height)
        right = round((col + 1) * cell_width)
        bottom = round((row + 1) * cell_height - CONTACT_SHEET_LABEL_HEIGHT)
        if right <= left or bottom <= top:
            return None
        image.crop((left, top, right, bottom)).save(output_path)
    return output_path


def find_visual_cell(visual_manifest: dict[str, Any], sheet_id: str, ref: str) -> dict[str, Any] | None:
    for sheet in visual_manifest.get("sheets", []) or []:
        if not isinstance(sheet, dict) or str(sheet.get("sheetId") or "") != sheet_id:
            continue
        for cell in sheet.get("cells", []) or []:
            if isinstance(cell, dict) and str(cell.get("shotId") or cell.get("shotRef") or "") == ref:
                return cell
    return None


def infer_sheet_grid(visual_manifest: dict[str, Any], sheet_id: str) -> tuple[int, int]:
    for sheet in visual_manifest.get("sheets", []) or []:
        if not isinstance(sheet, dict) or str(sheet.get("sheetId") or "") != sheet_id:
            continue
        cells = [cell for cell in sheet.get("cells", []) or [] if isinstance(cell, dict)]
        cols = max((to_int(cell.get("col")) or 0 for cell in cells), default=0) + 1
        rows = max((to_int(cell.get("row")) or 0 for cell in cells), default=0) + 1
        return cols, rows
    return 0, 0


def add_group_aliases(value: Any, index: dict[str, str]) -> None:
    if isinstance(value, dict):
        group_id = str(value.get("groupId") or "").strip()
        shot_refs = value.get("shotRefs") if isinstance(value.get("shotRefs"), list) else []
        if group_id and group_id not in index:
            for ref in shot_refs:
                path = index.get(str(ref or "").strip())
                if path:
                    index[group_id] = path
                    break
        for child in value.values():
            add_group_aliases(child, index)
    elif isinstance(value, list):
        for item in value:
            add_group_aliases(item, index)


def to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def to_float(value: Any) -> float | None:
    try:
        numeric = float(value)
        return numeric if numeric == numeric else None
    except (TypeError, ValueError):
        return None


def safe_filename(value: str) -> str:
    cleaned = "".join("_" if char in '<>:"/\\|?*' or ord(char) < 32 else char for char in str(value or ""))
    return cleaned.strip(" .") or "shot"


def re_drive_absolute(value: str) -> bool:
    return bool(re.match(r"^[A-Za-z]:[\\/]", str(value or "")))


def resolve_path_or_uri(value: str, root: Path, base_dir: Path) -> Path | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.startswith("/runtime/"):
        return (root / "Runtime" / text[len("/runtime/") :]).resolve()
    if text.startswith("runtime/"):
        return (root / "Runtime" / text[len("runtime/") :]).resolve()
    if Path(text).is_absolute() or re_drive_absolute(text):
        return Path(text).resolve()
    candidate = (base_dir / text).resolve()
    if candidate.exists():
        return candidate
    candidate = (root / text).resolve()
    if candidate.exists():
        return candidate
    return Path(text).resolve()
