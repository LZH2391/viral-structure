export type WorkbenchView = "workspace" | "new-ui" | "full-analysis" | "material-recognition" | "library" | "threadpool" | "active-turns" | "agent-chat";

export function initialViewFromPath(): WorkbenchView {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  if (pathname === "") return "new-ui";
  if (pathname === "/workspace") return "workspace";
  if (pathname === "/new-ui") return "new-ui";
  if (pathname === "/full-analysis") return "full-analysis";
  if (pathname === "/material-recognition") return "material-recognition";
  if (pathname === "/library") return "library";
  if (pathname === "/threadpool") return "threadpool";
  if (pathname === "/active-turns") return "active-turns";
  if (pathname === "/agent-chat") return "agent-chat";
  return "workspace";
}

export function workbenchViewPath(view: WorkbenchView) {
  return view === "workspace" ? "/workspace" : `/${view}`;
}

export function setWorkbenchView(view: WorkbenchView, setActiveView: (view: WorkbenchView) => void, mode: "push" | "replace" = "push") {
  setActiveView(view);
  const path = workbenchViewPath(view);
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (currentPath === path) return;
  const historyMethod = mode === "replace" ? window.history.replaceState : window.history.pushState;
  historyMethod.call(window.history, { view }, "", path);
}
