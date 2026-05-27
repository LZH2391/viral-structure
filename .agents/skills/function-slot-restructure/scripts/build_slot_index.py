#!/usr/bin/env python3
"""Build a searchable slot index from a corpus of sample-video libraries."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from common import as_list, by_id, discover_sample_dirs, load_sample, slot_key, text_blob, write_json


def build_index(root: Path) -> Dict[str, Any]:
    sample_dirs = discover_sample_dirs(root)
    samples: List[Dict[str, Any]] = []
    slot_variants: List[Dict[str, Any]] = []
    atom_variants: List[Dict[str, Any]] = []
    bindings: List[Dict[str, Any]] = []
    rules: List[Dict[str, Any]] = []
    templates: List[Dict[str, Any]] = []

    slot_type_counter: Counter[str] = Counter()
    chain_counter: Counter[str] = Counter()
    rule_text_counter: Counter[str] = Counter()
    slot_type_to_variants: Dict[str, List[str]] = defaultdict(list)

    for sample_dir in sample_dirs:
        meta, files = load_sample(sample_dir)
        sample_id = meta["sampleId"]
        manifest = files.get("manifest") or {}
        slots = as_list(files.get("slots"))
        script_atoms = by_id(as_list(files.get("scriptAtoms")))
        rhythm_atoms = by_id(as_list(files.get("rhythmAtoms")))
        packaging_atoms = by_id(as_list(files.get("packagingAtoms")))

        samples.append({
            "sampleId": sample_id,
            "artifactId": meta.get("artifactId"),
            "sampleDir": meta["sampleDir"],
            "schemaVersion": meta.get("schemaVersion"),
            "counts": manifest.get("counts", {}),
        })

        for atom_kind, atoms in [
            ("script", script_atoms),
            ("rhythm", rhythm_atoms),
            ("packaging", packaging_atoms),
        ]:
            for atom_id, atom in atoms.items():
                slot_type = atom.get("slot")
                atom_variants.append({
                    "variantId": f"{sample_id}::{atom_kind}::{atom_id}",
                    "sampleId": sample_id,
                    "kind": atom_kind,
                    "sourceAtomId": atom_id,
                    "slotType": slot_type,
                    "label": atom.get("label"),
                    "function": atom.get("function") or atom.get("packagingFunction"),
                    "confidence": atom.get("confidence"),
                    "needReview": atom.get("needReview", False),
                    "claimType": atom.get("claimType"),
                    "proofNeed": atom.get("proofNeed"),
                    "pace": atom.get("pace"),
                    "densityType": atom.get("densityType"),
                    "avoidFor": atom.get("avoidFor", []),
                    "packagingFunction": atom.get("packagingFunction"),
                    "visualHierarchy": atom.get("visualHierarchy"),
                    "risk": atom.get("risk"),
                    "raw": atom,
                })

        for slot in slots:
            slot_id = slot.get("slotId")
            slot_type = slot.get("slotType")
            script_ids = [str(x) for x in as_list(slot.get("scriptAtomIds"))]
            rhythm_ids = [str(x) for x in as_list(slot.get("rhythmAtomIds"))]
            packaging_ids = [str(x) for x in as_list(slot.get("packagingAtomIds"))]
            script = [script_atoms[x] for x in script_ids if x in script_atoms]
            rhythm = [rhythm_atoms[x] for x in rhythm_ids if x in rhythm_atoms]
            packaging = [packaging_atoms[x] for x in packaging_ids if x in packaging_atoms]
            variant_id = f"{sample_id}::{slot_id}"
            slot_type_counter[str(slot_type)] += 1
            slot_type_to_variants[str(slot_type)].append(variant_id)
            slot_variants.append({
                "variantId": variant_id,
                "sampleId": sample_id,
                "sourceSlotId": slot_id,
                "slotType": slot_type,
                "slotName": slot.get("slotName"),
                "slotOrder": slot.get("slotOrder"),
                "viewerStateBefore": slot.get("viewerStateBefore"),
                "viewerStateAfter": slot.get("viewerStateAfter"),
                "persuasionTask": slot.get("persuasionTask"),
                "requiredSyncPoints": slot.get("requiredSyncPoints", []),
                "substitutionRules": slot.get("substitutionRules", []),
                "confidence": slot.get("confidence"),
                "needReview": slot.get("needReview", False),
                "scriptAtoms": script,
                "rhythmAtoms": rhythm,
                "packagingAtoms": packaging,
                "sourceRefs": slot.get("sourceRefs", {}),
                "searchText": text_blob(slot) + " " + text_blob(script) + " " + text_blob(rhythm) + " " + text_blob(packaging),
                "raw": slot,
            })

        for binding in as_list(files.get("bindings")):
            item = dict(binding)
            item["sampleId"] = sample_id
            item["variantId"] = f"{sample_id}::binding::{binding.get('id')}"
            bindings.append(item)
            if binding.get("rule"):
                rule_text_counter[str(binding.get("rule"))] += 1

        rule_doc = files.get("rules") or {}
        if isinstance(rule_doc, dict):
            for rule_kind in ["conflictChecks", "recombinationRules"]:
                for rule in as_list(rule_doc.get(rule_kind)):
                    item = dict(rule)
                    item["sampleId"] = sample_id
                    item["ruleKind"] = rule_kind
                    item["variantId"] = f"{sample_id}::rule::{rule.get('id')}"
                    rules.append(item)
                    if item.get("reason"):
                        rule_text_counter[str(item.get("reason"))] += 1

        for template in as_list(files.get("templates")):
            seq = [str(x) for x in as_list(template.get("sequence"))]
            chain_key = " > ".join(seq)
            if chain_key:
                chain_counter[chain_key] += 1
            item = dict(template)
            item["sampleId"] = sample_id
            item["variantId"] = f"{sample_id}::template::{template.get('templateId')}"
            item["chainKey"] = chain_key
            templates.append(item)

    canonical_slots = []
    for slot_type, count in sorted(slot_type_counter.items()):
        variants = [v for v in slot_variants if v["slotType"] == slot_type]
        sample_ids = sorted({v["sampleId"] for v in variants})
        canonical_slots.append({
            "canonicalSlotId": f"CS_{slot_key(slot_type)}",
            "slotType": slot_type,
            "support": {
                "variantCount": count,
                "sampleCount": len(sample_ids),
                "sampleIds": sample_ids,
            },
            "commonNames": sorted({v.get("slotName") for v in variants if v.get("slotName")}),
            "variantIds": slot_type_to_variants[slot_type],
        })

    return {
        "schemaVersion": "short_video_slot_index.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceRoot": str(root.resolve()),
        "summary": {
            "sampleCount": len(samples),
            "slotVariantCount": len(slot_variants),
            "atomVariantCount": len(atom_variants),
            "bindingCount": len(bindings),
            "ruleCount": len(rules),
            "templateCount": len(templates),
            "slotTypeSupport": dict(slot_type_counter),
            "chainPatternSupport": dict(chain_counter.most_common()),
        },
        "samples": samples,
        "canonicalSlots": canonical_slots,
        "slotVariants": slot_variants,
        "atomVariants": atom_variants,
        "bindings": bindings,
        "rules": rules,
        "templates": templates,
        "ruleSupport": dict(rule_text_counter.most_common()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus_dir", help="Directory containing one or many sample-video libraries")
    parser.add_argument("--out", default="slot_index.json", help="Output index JSON path")
    args = parser.parse_args()
    index = build_index(Path(args.corpus_dir))
    write_json(Path(args.out), index)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
