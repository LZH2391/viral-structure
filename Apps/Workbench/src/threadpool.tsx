import React from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ThreadPoolApp } from "./components/ThreadPoolApp";
import "../styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary title="ThreadPool 暂时不可用">
      <ThreadPoolApp />
    </AppErrorBoundary>
  </React.StrictMode>,
);
