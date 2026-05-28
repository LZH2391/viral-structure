#!/usr/bin/env python3
"""Compatibility wrapper for the builder-owned FunctionSlotLibrary index script."""
from __future__ import annotations

import runpy
import sys
from pathlib import Path


BUILDER_SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "function-slot-library-builder"
    / "scripts"
    / "build_slot_index.py"
)


if __name__ == "__main__":
    sys.path.insert(0, str(BUILDER_SCRIPT.parent))
    runpy.run_path(str(BUILDER_SCRIPT), run_name="__main__")
