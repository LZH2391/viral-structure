from __future__ import annotations

import hashlib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RoleInitProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template: str
    ready_text: str | None = Field(default=None, alias="readyText")

    @field_validator("template")
    @classmethod
    def ensure_template(cls, value: str) -> str:
        text = str(value).strip()
        if not text:
            raise ValueError("field cannot be empty")
        return text

    @field_validator("ready_text", mode="before")
    @classmethod
    def alias_ready_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


class RoleTurnTemplateProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template: str
    version: str

    @field_validator("template", "version")
    @classmethod
    def ensure_text(cls, value: str) -> str:
        text = str(value).strip()
        if not text:
            raise ValueError("field cannot be empty")
        return text


class RoleProfileDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str
    profile_version: str = Field(alias="profileVersion")
    workspace_root: str | None = Field(default=None, alias="workspaceRoot")
    skill_path: str | None = Field(default=None, alias="skillPath")
    init: RoleInitProfile
    turn_templates: dict[str, RoleTurnTemplateProfile] = Field(default_factory=dict, alias="turnTemplates")

    @field_validator("role", "profile_version")
    @classmethod
    def ensure_text(cls, value: str) -> str:
        text = str(value).strip()
        if not text:
            raise ValueError("field cannot be empty")
        return text

    @field_validator("workspace_root", "skill_path", mode="before")
    @classmethod
    def normalize_optional_path(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


class LoadedRoleProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str
    profile_path: str
    profile_version: str
    workspace_root: str | None = None
    skill_path: str | None = None
    init_prompt: str
    init_ready_text: str | None = None
    init_template_path: str
    init_template_hash: str
    turn_templates: dict[str, RoleTurnTemplateProfile] = {}


def load_role_profile(workspace_root: Path, role_name: str, profile_path: str | Path) -> LoadedRoleProfile:
    resolved_profile_path = _resolve_profile_path(workspace_root, profile_path)
    if not resolved_profile_path.exists() or not resolved_profile_path.is_file():
        raise ValueError(f"role profile missing: {resolved_profile_path}")
    document = RoleProfileDocument.model_validate_json(resolved_profile_path.read_text(encoding="utf-8"))
    if document.role != str(role_name).strip():
        raise ValueError(f"role profile mismatch: expected {role_name}, got {document.role}")
    base_dir = resolved_profile_path.parent
    init_template_path = (base_dir / document.init.template).resolve()
    if not init_template_path.exists() or not init_template_path.is_file():
        raise ValueError(f"role init template missing: {init_template_path}")
    init_prompt = init_template_path.read_text(encoding="utf-8").strip()
    if not init_prompt:
        raise ValueError(f"role init template cannot be empty: {init_template_path}")
    for template_name, template_profile in document.turn_templates.items():
        resolved_template_path = (base_dir / template_profile.template).resolve()
        if not resolved_template_path.exists() or not resolved_template_path.is_file():
            raise ValueError(f"role turn template missing: {template_name} -> {resolved_template_path}")
    return LoadedRoleProfile(
        role=document.role,
        profile_path=str(resolved_profile_path),
        profile_version=document.profile_version,
        workspace_root=str(_resolve_optional_workspace_root(workspace_root, document.workspace_root)) if document.workspace_root else None,
        skill_path=document.skill_path,
        init_prompt=init_prompt,
        init_ready_text=document.init.ready_text,
        init_template_path=str(init_template_path),
        init_template_hash=_sha256_text(init_prompt),
        turn_templates=document.turn_templates,
    )


def _resolve_profile_path(workspace_root: Path, profile_path: str | Path) -> Path:
    candidate = Path(profile_path)
    if not candidate.is_absolute():
        candidate = (workspace_root / candidate).resolve()
    else:
        candidate = candidate.resolve()
    return candidate


def _resolve_optional_workspace_root(workspace_root: Path, role_workspace_root: str | Path) -> Path:
    candidate = Path(role_workspace_root)
    if not candidate.is_absolute():
        candidate = (workspace_root / candidate).resolve()
    else:
        candidate = candidate.resolve()
    return candidate


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
