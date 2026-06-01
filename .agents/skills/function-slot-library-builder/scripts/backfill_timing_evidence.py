#!/usr/bin/env python3
"""Backfill rhythm timingEvidence from runtime sample artifacts."""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Dict, List

from common import (
    as_list,
    discover_sample_dirs,
    find_file,
    read_json,
    resolve_corpus_root,
    write_json,
)
from timing_evidence import build_timing_evidence


def backfill(root: Path, runtime_root: Path, write: bool = False) -> Dict[str, Any]:
    corpus_root = resolve_corpus_root(root)
    sample_dirs = discover_sample_dirs(corpus_root)
    updated_atoms = 0
    updated_samples = 0
    skipped = []
    samples = []

    for sample_dir in sample_dirs:
        manifest_path = find_file(sample_dir, "manifest")
        rhythm_path = find_file(sample_dir, "rhythmAtoms")
        if not manifest_path or not rhythm_path:
            skipped.append({"sampleDir": str(sample_dir), "reason": "missing_manifest_or_rhythm_atoms"})
            continue
        manifest = read_json(manifest_path)
        sample_id = str(manifest.get("sampleVideoId") or "")
        if not sample_id:
            skipped.append({"sampleDir": str(sample_dir), "reason": "missing_sampleVideoId"})
            continue
        runtime_artifact_path = runtime_root / "Artifacts" / sample_id / "artifact.json"
        if not runtime_artifact_path.exists():
            skipped.append({"sampleVideoId": sample_id, "reason": "runtime_artifact_missing"})
            continue
        runtime_artifact = read_json(runtime_artifact_path)
        shots = shots_by_ref(runtime_artifact)
        subtitles = as_list((runtime_artifact.get("subtitles") or {}).get("segments"))
        atoms = as_list(read_json(rhythm_path))
        changed = False
        sample_updated_atoms = 0
        for atom in atoms:
            if not isinstance(atom, dict):
                continue
            shot_refs = as_list((atom.get("sourceRefs") or {}).get("shotRefs"))
            evidence = build_timing_evidence([str(ref) for ref in shot_refs], shots, subtitles)
            if not evidence:
                continue
            if atom.get("timingEvidence") == evidence:
                continue
            atom["timingEvidence"] = evidence
            changed = True
            sample_updated_atoms += 1
        if changed:
            updated_samples += 1
            updated_atoms += sample_updated_atoms
            if write:
                write_json(rhythm_path, atoms)
        samples.append({
            "sampleVideoId": sample_id,
            "artifactId": manifest.get("artifactId"),
            "rhythmAtomCount": len(atoms),
            "updatedRhythmAtomCount": sample_updated_atoms,
            "written": bool(write and changed),
        })

    return {
        "ok": True,
        "mode": "write" if write else "dry-run",
        "sampleCount": len(sample_dirs),
        "updatedSampleCount": updated_samples,
        "updatedRhythmAtomCount": updated_atoms,
        "samples": samples,
        "skipped": skipped,
    }


def shots_by_ref(artifact: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    shots = {}
    for shot in as_list((artifact.get("shotBoundaryAnalysis") or {}).get("shots")):
        if not isinstance(shot, dict):
            continue
        for key in [shot.get("id"), shot.get("shotNo")]:
            if key:
                shots[str(key)] = shot
    return shots


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus_dir", help="Repo root, Artifacts/FunctionSlotLibrary, or one sample library")
    parser.add_argument("--runtime-root", default="Runtime", help="Runtime root containing Artifacts/<sampleVideoId>/artifact.json")
    parser.add_argument("--write", action="store_true", help="Write timingEvidence into atoms.rhythm.json")
    parser.add_argument("--out", help="Optional report JSON path")
    args = parser.parse_args()

    report = backfill(Path(args.corpus_dir), Path(args.runtime_root), args.write)
    if args.out:
        write_json(Path(args.out), report)
    else:
        import json
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
