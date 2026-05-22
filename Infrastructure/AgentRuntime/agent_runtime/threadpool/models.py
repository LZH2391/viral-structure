from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


ThreadStatus = Literal["initializing", "idle", "leased", "retired", "discarded"]
LeaseStatus = Literal["active", "released"]


class RoleConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    min_idle: int = 4
    init_prompt: str | None = None
    profile_path: str | None = None
    profile_version: str | None = None
    init_template_path: str | None = None
    init_template_hash: str | None = None
    skill_path: str | None = None
    init_ready_text: str | None = None

    @field_validator("name")
    @classmethod
    def ensure_text(cls, value: str) -> str:
        text = str(value).strip()
        if not text:
            raise ValueError("field cannot be empty")
        return text

    @field_validator("init_prompt", "profile_path", "profile_version", "init_template_path", "init_template_hash", "skill_path", "init_ready_text")
    @classmethod
    def normalize_skill_path(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


class ThreadRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    thread_id: str
    role: str
    status: ThreadStatus
    is_seed: bool = False
    lease_id: str | None = None
    lease_count: int = 0
    retire_on_release: bool = False
    discard_reason: str | None = None
    init_turn_id: str | None = None
    init_fingerprint: str | None = None
    created_at: str
    updated_at: str
    last_validated_at: str | None = None

    @field_validator("thread_id", "role", "created_at", "updated_at")
    @classmethod
    def ensure_text(cls, value: str) -> str:
        text = str(value).strip()
        if not text:
            raise ValueError("field cannot be empty")
        return text

    @field_validator("lease_id", "discard_reason", "init_turn_id", "init_fingerprint", "last_validated_at")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


class LeaseRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lease_id: str
    role: str
    owner_id: str
    thread_id: str
    status: LeaseStatus = "active"
    created_at: str
    last_seen_at: str
    released_at: str | None = None

    @field_validator("lease_id", "role", "owner_id", "thread_id", "created_at", "last_seen_at")
    @classmethod
    def ensure_text(cls, value: str) -> str:
        text = str(value).strip()
        if not text:
            raise ValueError("field cannot be empty")
        return text

    @field_validator("released_at")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def is_orphaned(self, *, now: datetime, ttl_seconds: int) -> bool:
        if self.status != "active":
            return False
        return (now - datetime.fromisoformat(self.last_seen_at)).total_seconds() > ttl_seconds


class AcquireLeaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str
    owner_id: str


class TouchLeaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_id: str


class ReleaseLeaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_id: str


class DiscardThreadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1)
