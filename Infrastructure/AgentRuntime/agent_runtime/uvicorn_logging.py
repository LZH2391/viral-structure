from __future__ import annotations

import copy
import logging
from typing import Any

from uvicorn.config import LOGGING_CONFIG


class SuppressHealthAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return '"GET /health ' not in message and "'GET /health " not in message


def build_uvicorn_log_config() -> dict[str, Any]:
    config = copy.deepcopy(LOGGING_CONFIG)
    filters = dict(config.get("filters") or {})
    filters["suppress_health_access"] = {"()": SuppressHealthAccessFilter}
    config["filters"] = filters
    handlers = dict(config.get("handlers") or {})
    access = dict(handlers.get("access") or {})
    access["filters"] = [*list(access.get("filters") or []), "suppress_health_access"]
    handlers["access"] = access
    config["handlers"] = handlers
    return config
