import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { NewUiAnalysisChildId, NewUiLibraryChildId, NewUiSection, NewUiSectionId } from "./NewUiLayoutTypes";
import { AnalysisChildIcon, ArchiveConfirmIcon, ArchiveTrashIcon, LibraryChildIcon, NewConversationIcon, SectionIcon, SidebarErrorIcon, SidebarTurnSpinnerIcon } from "./NewUiSidebarIcons";

export type SidebarNavProps = {
    activeAnalysisChild: NewUiAnalysisChildId;
    activeLibraryChild: NewUiLibraryChildId;
    activeRestructureConversationId: string | null;
    activeSection: NewUiSectionId;
    archiveConfirmConversationId: string | null;
    archivingConversationId: string | null;
    collapsed: boolean;
    sections: NewUiSection[];
    onArchiveConfirmLeave: (conversationId: string) => void;
    onArchiveRestructureConversation: (conversationId: string) => void;
    loadingMoreRestructureConversations: boolean;
    onAnalysisChildChange: (child: NewUiAnalysisChildId) => void;
    onLibraryChildChange: (child: NewUiLibraryChildId) => void;
    onLoadMoreRestructureConversations: () => void;
    onNewRestructureConversation: () => void;
    onRestructureConversationChange: (conversationId: string) => void;
    onSectionChange: (section: NewUiSectionId) => void;
    restructureConversationsHasMore: boolean;
    runningRestructureConversationIds: Record<string, boolean>;
};

export const DEFAULT_EXPANDED_SIDEBAR_SECTIONS: NewUiSectionId[] = ["analysis", "library", "restructure"];

export function SidebarNav({ activeAnalysisChild, activeLibraryChild, activeRestructureConversationId, activeSection, archiveConfirmConversationId, archivingConversationId, collapsed, sections, onArchiveConfirmLeave, onArchiveRestructureConversation, loadingMoreRestructureConversations, onAnalysisChildChange, onLibraryChildChange, onLoadMoreRestructureConversations, onNewRestructureConversation, onRestructureConversationChange, onSectionChange, restructureConversationsHasMore, runningRestructureConversationIds, }: SidebarNavProps) { const [expandedSections, setExpandedSections] = useState<NewUiSectionId[]>(DEFAULT_EXPANDED_SIDEBAR_SECTIONS); const expandedSectionsBeforeCollapseRef = useRef<NewUiSectionId[] | null>(DEFAULT_EXPANDED_SIDEBAR_SECTIONS); useEffect(() => { setExpandedSections((current) => { if (collapsed) {
    expandedSectionsBeforeCollapseRef.current = current;
    return [];
} return current.length ? current : expandedSectionsBeforeCollapseRef.current ?? DEFAULT_EXPANDED_SIDEBAR_SECTIONS; }); }, [collapsed]); return (<nav className="new-ui-sidebar-nav" aria-label="新 UI 功能导航"> {sections.map((section) => { const isActive = section.id === activeSection; const hasChildren = Boolean(section.children?.length); const isExpanded = hasChildren && !collapsed && expandedSections.includes(section.id); const childCount = section.children?.length ?? 0; const hasLoadMore = section.id === "restructure" && restructureConversationsHasMore; const subnavItemCount = childCount + (hasLoadMore ? 1 : 0); const subnavStyle = hasChildren ? { "--new-ui-sidebar-subnav-expanded-height": `${(subnavItemCount * 40) + 4}px`, } as CSSProperties : undefined; const navItemClassName = `new-ui-sidebar-nav-item ${isActive ? "is-active" : ""} ${hasChildren ? "has-children is-static" : ""}`.trim(); const navContent = (<> <span className="new-ui-sidebar-nav-icon" aria-hidden="true"> <SectionIcon section={section.id}/> </span> <span className="new-ui-sidebar-nav-label"> <span className="new-ui-sidebar-nav-label-text">{section.label}</span> </span> </>); const navButton = hasChildren ? (<div className={navItemClassName} data-section={section.id} aria-current={isActive ? "page" : undefined}> {navContent} </div>) : (<button key={section.id} className={navItemClassName} data-section={section.id} type="button" aria-current={isActive ? "page" : undefined} aria-label={collapsed ? section.label : undefined} data-tooltip={collapsed ? section.label : undefined} onClick={() => onSectionChange(section.id)}> {navContent} </button>); if (!hasChildren) {
    return navButton;
} return (<div key={section.id} className={`new-ui-sidebar-nav-group ${isExpanded ? "is-expanded" : ""}`.trim()} data-section={section.id}> <div className="new-ui-sidebar-nav-row"> {navButton} {section.id === "restructure" ? (<button className="new-ui-sidebar-nav-action" type="button" aria-label="新建重组会话" data-tooltip="新会话" onClick={(event) => { event.stopPropagation(); onNewRestructureConversation(); }}> <NewConversationIcon /> </button>) : null} </div> <div className="new-ui-sidebar-subnav" style={subnavStyle} aria-label={`${section.label}子类`}> {section.children?.map((child) => { const isChildActive = isActive && (section.id === "analysis" ? activeAnalysisChild === child.id : section.id === "library" ? activeLibraryChild === child.id : activeRestructureConversationId === child.id); if (section.id === "restructure") {
    const confirmingArchive = archiveConfirmConversationId === child.id;
    const archiving = archivingConversationId === child.id;
    const runningTurn = Boolean(runningRestructureConversationIds[child.id]);
    const hasError = Boolean(child.errorMessage);
    return (<div key={child.id} className={`new-ui-sidebar-subnav-item has-meta has-archive ${isChildActive ? "is-active" : ""} ${confirmingArchive ? "is-confirming-archive" : ""} ${runningTurn ? "is-running-turn" : ""} ${hasError ? "has-error" : ""}`.trim()} onMouseLeave={confirmingArchive ? () => onArchiveConfirmLeave(child.id) : undefined}> <button className="new-ui-sidebar-subnav-select" type="button" aria-current={isChildActive ? "page" : undefined} data-tooltip={child.updatedAgoLabel ? `${child.label}，最新更新 ${child.updatedAgoLabel}前` : child.label} onClick={() => { onSectionChange(section.id); onRestructureConversationChange(child.id); }}> <span className="new-ui-sidebar-subnav-label">{child.label}</span> </button> <button className="new-ui-sidebar-subnav-archive" type="button" aria-label={confirmingArchive ? `确认归档${child.label}` : `归档${child.label}`} data-tooltip={confirmingArchive ? "确认归档" : "归档会话"} disabled={Boolean(archivingConversationId)} onClick={() => onArchiveRestructureConversation(child.id)}> <span className="new-ui-sidebar-subnav-time" aria-hidden={confirmingArchive || archiving || runningTurn ? "true" : undefined}> {child.updatedAgoLabel} </span> {runningTurn ? <SidebarTurnSpinnerIcon /> : null} {hasError ? <SidebarErrorIcon title={child.errorMessage ?? "发送失败"}/> : null} {confirmingArchive ? <ArchiveConfirmIcon /> : <ArchiveTrashIcon />} </button> </div>);
} return (<button key={child.id} className={`new-ui-sidebar-subnav-item has-icon ${isChildActive ? "is-active" : ""}`.trim()} type="button" aria-current={isChildActive ? "page" : undefined} data-child={child.id} data-tooltip={child.label} onClick={() => { onSectionChange(section.id); if (section.id === "analysis")
    onAnalysisChildChange(child.id as NewUiAnalysisChildId); if (section.id === "library")
    onLibraryChildChange(child.id as NewUiLibraryChildId); }}> <span className="new-ui-sidebar-subnav-icon" aria-hidden="true"> {section.id === "analysis" ? <AnalysisChildIcon child={child.id as NewUiAnalysisChildId}/> : <LibraryChildIcon child={child.id as NewUiLibraryChildId}/>} </span> <span className="new-ui-sidebar-subnav-label">{child.label}</span> </button>); })} {section.id === "restructure" && restructureConversationsHasMore ? (<button className="new-ui-sidebar-load-more" type="button" disabled={loadingMoreRestructureConversations} data-tooltip="继续加载重组会话" onClick={onLoadMoreRestructureConversations}> <span>{loadingMoreRestructureConversations ? "加载中" : "加载更多"}</span> </button>) : null} </div> </div>); })} </nav>); }
