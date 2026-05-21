from __future__ import annotations

import json
import os
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from typing import Iterator

import msvcrt
from pydantic import BaseModel


def _json_default(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Object of type {type(value)!r} is not JSON serializable")


def read_json(path: Path) -> Any:
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            with path.open("r", encoding="utf-8-sig") as handle:
                return json.load(handle)
        except (FileNotFoundError, PermissionError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt == 4:
                raise
            time.sleep(0.02)
    if last_error is not None:
        raise last_error
    raise RuntimeError(f"failed to read json: {path}")


def write_json(path: Path, payload: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temp_path = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    os.close(file_descriptor)
    temp_file = Path(temp_path)
    try:
        with temp_file.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, default=_json_default)
        last_error: Exception | None = None
        for attempt in range(10):
            try:
                os.replace(temp_file, path)
                last_error = None
                break
            except PermissionError as exc:
                last_error = exc
                if attempt == 9:
                    raise
                time.sleep(0.02)
        if last_error is not None:
            raise last_error
    finally:
        if temp_file.exists():
            temp_file.unlink(missing_ok=True)
    return path


@contextmanager
def file_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        handle.seek(0)
        handle.write(b"0")
        handle.flush()
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        try:
            yield
        finally:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
