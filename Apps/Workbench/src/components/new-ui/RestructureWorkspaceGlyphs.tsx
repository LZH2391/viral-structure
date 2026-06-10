import type { RestructureTimelineActivityItem } from "./restructureWorkspaceTypes";

export function RestructureTimelineIcon({ kind }: { kind: RestructureTimelineActivityItem["kind"] }) {
  if (kind === "reasoning") {
    return (
      <svg viewBox="0 0 20 20" focusable="false">
        <path d="M10 3.2a5 5 0 0 0-2.8 9.1v2.2h5.6v-2.2A5 5 0 0 0 10 3.2Z" />
        <path d="M7.6 17h4.8" />
        <path d="M8.1 9.3h3.8" />
      </svg>
    );
  }
  if (kind === "context_compacted") {
    return (
      <svg viewBox="0 0 20 20" focusable="false">
        <path d="M4.2 5.2h11.6" />
        <path d="M6.2 9.1h7.6" />
        <path d="M8.1 13h3.8" />
        <path d="m7 3-2.8 2.2L7 7.4" />
        <path d="m13 16.9 2.8-2.2-2.8-2.2" />
      </svg>
    );
  }
  if (kind === "context_compacting") {
    return (
      <svg viewBox="0 0 20 20" focusable="false">
        <path d="M5.1 5.2h9.8" />
        <path d="M6.8 9.6h6.4" />
        <path d="M8.3 14h3.4" />
        <path d="M4.2 3.6v3.2h3.2" />
        <path d="M15.8 16.4v-3.2h-3.2" />
        <path d="M4.6 6.8a6.3 6.3 0 0 1 10.2-2" />
        <path d="M15.4 13.2a6.3 6.3 0 0 1-10.2 2" />
      </svg>
    );
  }
  if (kind === "dialogue_review") {
    return (
      <svg viewBox="0 0 20 20" focusable="false">
        <path d="M5.3 3.8h9.4a1 1 0 0 1 1 1v10.4a1 1 0 0 1-1 1H5.3a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1Z" />
        <path d="M7.2 7.2h5.8" />
        <path d="M7.2 10h3.8" />
        <path d="m7.2 13.4 1.4 1.3 3.2-3.2" />
        <path d="M13.8 11.7h.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" focusable="false">
      <path d="M7.2 6.4 3.8 10l3.4 3.6" />
      <path d="m12.8 6.4 3.4 3.6-3.4 3.6" />
      <path d="m11.2 4.8-2.4 10.4" />
    </svg>
  );
}

export function ChevronGlyph() {
  return (
    <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
      <path d="m6.2 3.8 5 5.2-5 5.2" />
    </svg>
  );
}

export function NewConversationGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

export function StopTurnGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <rect x="6.2" y="6.2" width="7.6" height="7.6" rx="1.4" />
    </svg>
  );
}

export function ErrorAlertGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M10 3.5 17 15.5H3L10 3.5Z" />
      <path d="M10 7.5v4" />
      <path d="M10 14.1h.01" />
    </svg>
  );
}

export function CloseGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="m6 6 8 8M14 6l-8 8" />
    </svg>
  );
}

export function SendGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M4 10.2 16 4.5l-3.6 11-2.2-4.1L6 9.2l10-4.7" />
    </svg>
  );
}

export function UploadMaterialGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M7.2 10.4 11 6.6a2.9 2.9 0 0 1 4.1 4.1l-5.5 5.5a4.1 4.1 0 0 1-5.8-5.8l5.7-5.7" />
      <path d="M8.7 12 13 7.7" />
    </svg>
  );
}

export function ReferenceStructureGlyph() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M4.5 4.5h4.2v4.2H4.5zM11.3 4.5h4.2v4.2h-4.2zM4.5 11.3h4.2v4.2H4.5zM11.3 11.3h4.2v4.2h-4.2z" />
    </svg>
  );
}
