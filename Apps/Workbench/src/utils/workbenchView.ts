export type WorkbenchView = "workspace" | "full-analysis" | "library" | "debug" | "threadpool";

export function initialViewFromPath(): WorkbenchView {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  if (pathname === "/full-analysis") return "full-analysis";
  if (pathname === "/library") return "library";
  if (pathname === "/debug") return "debug";
  if (pathname === "/threadpool") return "threadpool";
  return "workspace";
}

export function workbenchViewPath(view: WorkbenchView) {
  return view === "workspace" ? "/" : `/${view}`;
}

export function setWorkbenchView(view: WorkbenchView, setActiveView: (view: WorkbenchView) => void, mode: "push" | "replace" = "push") {
  setActiveView(view);
  const path = workbenchViewPath(view);
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (currentPath === path) return;
  const historyMethod = mode === "replace" ? window.history.replaceState : window.history.pushState;
  historyMethod.call(window.history, { view }, "", path);
}
