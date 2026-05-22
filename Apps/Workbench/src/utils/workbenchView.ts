export type WorkbenchView = "workspace" | "create" | "library" | "debug" | "threadpool";

export function initialViewFromPath(): WorkbenchView {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  if (pathname === "/create") return "create";
  if (pathname === "/library") return "library";
  if (pathname === "/debug") return "debug";
  if (pathname === "/threadpool") return "threadpool";
  return "workspace";
}

export function setWorkbenchView(view: WorkbenchView, setActiveView: (view: WorkbenchView) => void) {
  setActiveView(view);
  const path = view === "workspace" ? "/" : `/${view}`;
  window.history.replaceState(null, "", path);
}
