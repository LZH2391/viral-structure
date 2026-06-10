import type { NewUiAnalysisChildId, NewUiLibraryChildId, NewUiSectionId } from "./NewUiLayoutTypes";

type SectionIconProps = {
    section: NewUiSectionId;
};

type AnalysisChildIconProps = {
    child: NewUiAnalysisChildId;
};

type LibraryChildIconProps = {
    child: NewUiLibraryChildId;
};

export function SectionIcon({ section }: SectionIconProps) { if (section === "analysis") {
    return (<svg viewBox="0 0 24 24" focusable="false"> <circle className="new-ui-section-icon-main" cx="10.2" cy="10.2" r="5.7"/> <path className="new-ui-section-icon-main" d="M14.4 14.4 19.2 19.2"/> <path className="new-ui-section-icon-detail new-ui-section-icon-analysis-line" d="M7.3 11.1 9.1 9.3 11.2 11.2 13.4 8.2"/> <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="7.3" cy="11.1" r="0.55"/> <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="9.1" cy="9.3" r="0.55"/> <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="11.2" cy="11.2" r="0.55"/> <circle className="new-ui-section-icon-detail new-ui-section-icon-dot" cx="13.4" cy="8.2" r="0.55"/> <path className="new-ui-section-icon-alt new-ui-section-icon-analysis-scan" d="M7.2 10.2h6"/> <path className="new-ui-section-icon-alt new-ui-section-icon-analysis-focus" d="M10.2 7.2v6"/> <circle className="new-ui-section-icon-alt new-ui-section-icon-analysis-center" cx="10.2" cy="10.2" r="1"/> </svg>);
} if (section === "library") {
    return (<svg viewBox="0 0 24 24" focusable="false"> <path className="new-ui-section-icon-main" d="M6.1 6.2h11.8a1.7 1.7 0 0 1 1.7 1.7v8.2a1.7 1.7 0 0 1-1.7 1.7H6.1a1.7 1.7 0 0 1-1.7-1.7V7.9a1.7 1.7 0 0 1 1.7-1.7Z"/> <path className="new-ui-section-icon-detail new-ui-section-icon-library-top" d="M7.1 4.6h9.8"/> <path className="new-ui-section-icon-detail new-ui-section-icon-library-bottom" d="M7.1 19.4h9.8"/> <path className="new-ui-section-icon-detail new-ui-section-icon-library-row" d="M8 10.1h8"/> <path className="new-ui-section-icon-detail new-ui-section-icon-library-row" d="M8 13.9h5.4"/> <path className="new-ui-section-icon-alt new-ui-section-icon-library-handle" d="M9 10.1h6"/> <path className="new-ui-section-icon-alt new-ui-section-icon-library-drawer" d="M7.4 13.9h9.2"/> </svg>);
} return (<svg viewBox="0 0 24 24" focusable="false"> <rect className="new-ui-section-icon-main new-ui-section-icon-node" x="4.4" y="4.4" width="5.2" height="5.2" rx="1.4"/> <rect className="new-ui-section-icon-main new-ui-section-icon-node" x="14.4" y="4.4" width="5.2" height="5.2" rx="1.4"/> <rect className="new-ui-section-icon-main new-ui-section-icon-node" x="9.4" y="14.4" width="5.2" height="5.2" rx="1.4"/> <path className="new-ui-section-icon-detail new-ui-section-icon-link-top" d="M9.6 7h4.8"/> <path className="new-ui-section-icon-detail new-ui-section-icon-link-left" d="M7 9.6c0.4 2.3 1.8 3.9 3.8 5.1"/> <path className="new-ui-section-icon-detail new-ui-section-icon-link-right" d="M17 9.6c-0.4 2.3-1.8 3.9-3.8 5.1"/> <path className="new-ui-section-icon-alt new-ui-section-icon-link-swap-a" d="M9.4 7.2c2.6 0.8 4.2 2.6 5.2 7.2"/> <path className="new-ui-section-icon-alt new-ui-section-icon-link-swap-b" d="M14.6 7.2c-2.6 0.8-4.2 2.6-5.2 7.2"/> </svg>); }

export function AnalysisChildIcon({ child }: AnalysisChildIconProps) { if (child === "materialRecognition") {
    return (<svg viewBox="0 0 24 24" focusable="false"> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-scan-corner" d="M5 8V5h3"/> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-scan-corner" d="M16 5h3v3"/> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-scan-corner" d="M19 16v3h-3"/> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-scan-corner" d="M8 19H5v-3"/> <path className="new-ui-subnav-icon-detail new-ui-subnav-icon-scan-line" d="M7.5 12h9"/> </svg>);
} return (<svg viewBox="0 0 24 24" focusable="false"> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-structure-row" d="M4 7h16"/> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-structure-row" d="M4 12h16"/> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-structure-row" d="M4 17h16"/> <path className="new-ui-subnav-icon-detail new-ui-subnav-icon-structure-knob-a" d="M8 5.8v2.4"/> <path className="new-ui-subnav-icon-detail new-ui-subnav-icon-structure-knob-b" d="M13.5 10.8v2.4"/> <path className="new-ui-subnav-icon-detail new-ui-subnav-icon-structure-knob-c" d="M17 15.8v2.4"/> </svg>); }

export function LibraryChildIcon({ child }: LibraryChildIconProps) { if (child === "semanticGovernance") {
    return (<svg viewBox="0 0 24 24" focusable="false"> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-tag-body" d="M3 8v4.172a2 2 0 0 0 .586 1.414l5.71 5.71a2.41 2.41 0 0 0 3.408 0l3.592 -3.592a2.41 2.41 0 0 0 0 -3.408l-5.71 -5.71a2 2 0 0 0 -1.414 -.586h-4.172a2 2 0 0 0 -2 2"/> <path className="new-ui-subnav-icon-detail new-ui-subnav-icon-tag-shadow" d="M18 19l1.592 -1.592a4.82 4.82 0 0 0 0 -6.816l-4.592 -4.592"/> <path className="new-ui-subnav-icon-alt new-ui-subnav-icon-tag-dot" d="M7 10h-.01"/> </svg>);
} if (child === "planTrace") {
    return (<svg viewBox="0 0 24 24" focusable="false"> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-trace-line" d="M4 16l6 -7l5 5l5 -6"/> <path className="new-ui-subnav-icon-detail new-ui-subnav-icon-trace-dot" d="M14 14a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/> <path className="new-ui-subnav-icon-detail new-ui-subnav-icon-trace-dot" d="M9 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/> <path className="new-ui-subnav-icon-alt new-ui-subnav-icon-trace-end" d="M3 16a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/> <path className="new-ui-subnav-icon-alt new-ui-subnav-icon-trace-end" d="M19 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/> </svg>);
} return (<svg viewBox="0 0 24 24" focusable="false"> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-graph-node" d="M3 7a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-graph-node" d="M14 15a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/> <path className="new-ui-subnav-icon-detail new-ui-subnav-icon-graph-node-large" d="M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/> <path className="new-ui-subnav-icon-detail new-ui-subnav-icon-graph-node-large" d="M3 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-graph-link" d="M9 17l5 -1.5"/> <path className="new-ui-subnav-icon-main new-ui-subnav-icon-graph-link" d="M6.5 8.5l7.81 5.37"/> <path className="new-ui-subnav-icon-alt new-ui-subnav-icon-graph-link-alt" d="M7 7l8 -1"/> </svg>); }

export function NewConversationIcon() { return (<svg viewBox="0 0 18 18" focusable="false" aria-hidden="true"> <path d="M9 3.4v11.2M3.4 9h11.2"/> </svg>); }

export function SidebarTurnSpinnerIcon() { return (<svg className="new-ui-sidebar-subnav-spinner" viewBox="0 0 20 20" focusable="false" aria-hidden="true"> <circle className="new-ui-sidebar-subnav-spinner-track" cx="10" cy="10" r="6.4"/> <path className="new-ui-sidebar-subnav-spinner-arc" d="M10 3.6a6.4 6.4 0 0 1 6.2 4.8"/> </svg>); }

export function SidebarErrorIcon({ title }: {
    title: string;
}) { return (<svg className="new-ui-sidebar-subnav-error-icon" viewBox="0 0 18 18" focusable="false" role="img" aria-label={title}> <path d="M9 3.2 15.3 14H2.7L9 3.2Z"/> <path d="M9 7.1v3.7"/> <path d="M9 12.9h.01"/> </svg>); }

export function ArchiveTrashIcon() { return (<svg className="new-ui-sidebar-subnav-archive-icon new-ui-sidebar-subnav-trash-icon" viewBox="0 0 18 18" focusable="false" aria-hidden="true"> <path d="M5.2 6.8h7.6"/> <path d="M7.4 6.8V5.5a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.3"/> <path d="M6.1 6.8 6.6 13a1.3 1.3 0 0 0 1.3 1.2h2.2a1.3 1.3 0 0 0 1.3-1.2l0.5-6.2"/> <path d="M8.1 8.7v3.1M9.9 8.7v3.1"/> </svg>); }

export function ArchiveConfirmIcon() { return (<svg className="new-ui-sidebar-subnav-archive-icon" viewBox="0 0 18 18" focusable="false" aria-hidden="true"> <path d="M4.6 9.3 7.5 12.1 13.5 5.9"/> </svg>); }
