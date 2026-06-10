import type { GraphMode } from "../FunctionSlotGraphApp";
import type { NewUiRestructureSendContext } from "./NewUiRestructureWorkspace";
import { NEW_UI_SECTIONS, type NewUiAnalysisChildId, type NewUiLibraryChildId, type NewUiSectionId } from "./NewUiLayoutTypes";

export function resolveSectionLabel(section: NewUiSectionId, analysisChild: NewUiAnalysisChildId, libraryChild: NewUiLibraryChildId) { const active = NEW_UI_SECTIONS.find((item) => item.id === section); if (section === "analysis") {
    return active?.children?.find((child) => child.id === analysisChild)?.label ?? active?.label ?? "分析";
} if (section === "library") {
    return active?.children?.find((child) => child.id === libraryChild)?.label ?? active?.label ?? "库";
} return active?.label ?? "分析"; }

export function libraryChildToGraphMode(child: NewUiLibraryChildId): GraphMode { if (child === "semanticGovernance")
    return "governance"; if (child === "planTrace")
    return "planTrace"; return "structure"; }

export function resolveRestructureUserInputOrigin(context: NewUiRestructureSendContext) { if (context.materialPackRef && context.structureRef)
    return "material_and_structure_context"; if (context.materialPackRef)
    return "material_context"; if (context.structureRef)
    return "structure_context"; return null; }
