#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image


LAYOUTS = {
    "storyboard-layout-9x16-4grid.png": {
        "size": (900, 1600),
        # Content boxes exclude the red guide lines in storyboard-layout-*-4grid.png.
        "boxes": [
            (0, 0, 447, 797),
            (454, 0, 900, 797),
            (0, 804, 447, 1600),
            (454, 804, 900, 1600),
        ],
    },
    "storyboard-layout-16x9-4grid.png": {
        "size": (1600, 900),
        # Content boxes exclude the red guide lines in storyboard-layout-*-4grid.png.
        "boxes": [
            (0, 0, 797, 447),
            (804, 0, 1600, 447),
            (0, 454, 797, 900),
            (804, 454, 1600, 900),
        ],
    },
}


def main() -> None:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Crop generated 4-grid storyboard images into shotId PNG files.")
    parser.add_argument("--artifact", required=True, help="image-generation artifact.json")
    parser.add_argument("--manifest", required=True, help="shot-storyboard-manifest.json")
    parser.add_argument("--output-dir", help="Output directory; defaults to <shot-design dir>/shot-storyboard-frames")
    parser.add_argument("--root", default=".", help="Repository root used to resolve /runtime URIs")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    artifact_path = Path(args.artifact).resolve()
    manifest_path = Path(args.manifest).resolve()
    artifact = read_json(artifact_path)
    manifest = read_json(manifest_path)
    output_dir = Path(args.output_dir).resolve() if args.output_dir else default_output_dir(manifest_path, manifest)
    output_dir.mkdir(parents=True, exist_ok=True)

    result = crop_storyboard_artifact({
        "artifact": artifact,
        "artifactPath": artifact_path,
        "manifest": manifest,
        "manifestPath": manifest_path,
        "outputDir": output_dir,
        "root": root,
    })
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))


def configure_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def default_output_dir(manifest_path: Path, manifest: dict[str, Any]) -> Path:
    shot_design_path = Path(str(manifest.get("source", {}).get("shotDesignFinalPath") or ""))
    if shot_design_path.exists():
        return shot_design_path.parent / "shot-storyboard-frames"
    return manifest_path.parent / "shot-storyboard-frames"


def crop_storyboard_artifact(context: dict[str, Any]) -> dict[str, Any]:
    manifest = context["manifest"]
    artifact = context["artifact"]
    group_map = {group.get("groupId"): group for group in manifest.get("storyboardGroups", [])}
    cropped = []
    warnings = list(manifest.get("warnings") or [])
    for artifact_group in artifact.get("storyboardGroups", []) or []:
        group_id = artifact_group.get("groupId")
        manifest_group = group_map.get(group_id)
        if not manifest_group:
            warnings.append(f"{group_id}: manifest 中找不到对应 storyboard group")
            continue
        image_path = resolve_group_image_path(artifact_group, context["root"])
        if not image_path or not image_path.exists():
            warnings.append(f"{group_id}: 找不到 storyboard group 图片")
            continue
        if manifest_group.get("isCover"):
            cropped.extend(crop_cover_group({
                "groupId": group_id,
                "manifestGroup": manifest_group,
                "imagePath": image_path,
                "outputDir": context["outputDir"],
                "warnings": warnings,
            }))
            continue
        layout_name = str(artifact_group.get("referenceImage") or artifact.get("storyboardRun", {}).get("referenceImage") or "")
        layout = layout_for_reference(layout_name, artifact.get("aspect") or manifest.get("aspect") or {})
        with Image.open(image_path) as image:
            source = image.convert("RGB")
            boxes = scale_boxes(layout["boxes"], layout["size"], source.size)
            for shot in manifest_group.get("shots", []):
                if shot.get("isPad"):
                    continue
                cell_index = int(shot.get("cellIndex") or 0)
                if cell_index < 1 or cell_index > len(boxes):
                    warnings.append(f"{group_id}/{shot.get('shotId')}: cellIndex 不合法")
                    continue
                shot_id = safe_filename(str(shot.get("shotId") or f"{group_id}_{cell_index}"))
                output_path = context["outputDir"] / f"{shot_id}.png"
                cropped_image = source.crop(boxes[cell_index - 1])
                cropped_image.save(output_path)
                cropped.append({
                    "shotId": shot.get("shotId"),
                    "groupId": group_id,
                    "cellIndex": cell_index,
                    "sourceImage": str(image_path),
                    "referenceImage": layout_name or layout["name"],
                    "cropBox": list(boxes[cell_index - 1]),
                    "path": str(output_path),
                })
    result = {
        "type": "shot-storyboard-crops",
        "schemaVersion": "shot-storyboard-crops.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "artifactPath": str(context["artifactPath"]),
            "manifestPath": str(context["manifestPath"]),
            "artifactId": artifact.get("artifactId"),
            "traceId": artifact.get("traceId"),
            "parentArtifactId": artifact.get("parentArtifactId"),
        },
        "outputDir": str(context["outputDir"]),
        "croppedCount": len(cropped),
        "crops": cropped,
        "warnings": warnings,
    }
    output_manifest = context["outputDir"] / "shot-storyboard-crops.json"
    output_manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    result["output"] = str(output_manifest)
    return result


def crop_cover_group(context: dict[str, Any]) -> list[dict[str, Any]]:
    shots = context["manifestGroup"].get("shots") or []
    cover_shot = next((shot for shot in shots if not shot.get("isPad")), None)
    if not cover_shot:
        context["warnings"].append(f"{context['groupId']}: cover group 缺少封面项")
        return []
    shot_id = safe_filename(str(cover_shot.get("shotId") or "cover_image"))
    output_path = context["outputDir"] / f"{shot_id}.png"
    with Image.open(context["imagePath"]) as image:
        source = image.convert("RGB")
        source.save(output_path)
        width, height = source.size
    return [{
        "shotId": cover_shot.get("shotId") or "cover_image",
        "groupId": context["groupId"],
        "cellIndex": None,
        "isCover": True,
        "sourceImage": str(context["imagePath"]),
        "referenceImage": "cover-full-image",
        "cropBox": [0, 0, width, height],
        "path": str(output_path),
    }]


def resolve_group_image_path(group: dict[str, Any], root: Path) -> Path | None:
    images = group.get("images") or []
    if not images:
        return None
    image = images[0]
    direct = image.get("path")
    if direct:
        return Path(str(direct)).resolve()
    uri = str(image.get("uri") or "").strip()
    if uri.startswith("/runtime/"):
        return (root / "Runtime" / uri[len("/runtime/") :]).resolve()
    if uri.startswith("runtime/"):
        return (root / "Runtime" / uri[len("runtime/") :]).resolve()
    if uri:
        return Path(uri).resolve()
    return None


def layout_for_reference(reference_name: str, aspect: dict[str, Any]) -> dict[str, Any]:
    name = Path(reference_name).name if reference_name else ""
    if name in LAYOUTS:
        return {"name": name, **LAYOUTS[name]}
    ratio = aspect.get("ratio")
    orientation = aspect.get("orientation")
    if ratio == "16:9" or orientation == "横屏":
        return {"name": "storyboard-layout-16x9-4grid.png", **LAYOUTS["storyboard-layout-16x9-4grid.png"]}
    return {"name": "storyboard-layout-9x16-4grid.png", **LAYOUTS["storyboard-layout-9x16-4grid.png"]}


def scale_boxes(boxes: list[tuple[int, int, int, int]], layout_size: tuple[int, int], image_size: tuple[int, int]) -> list[tuple[int, int, int, int]]:
    layout_width, layout_height = layout_size
    image_width, image_height = image_size
    x_scale = image_width / layout_width
    y_scale = image_height / layout_height
    return [
        (
            round(left * x_scale),
            round(top * y_scale),
            round(right * x_scale),
            round(bottom * y_scale),
        )
        for left, top, right, bottom in boxes
    ]


def safe_filename(value: str) -> str:
    cleaned = re_sub_filename(value)
    return cleaned or "shot"


def re_sub_filename(value: str) -> str:
    return "".join("_" if char in '<>:"/\\|?*' or ord(char) < 32 else char for char in value).strip(" .")


if __name__ == "__main__":
    main()
