import React from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DebugApp } from "./components/DebugApp";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary title="Debug 页面暂时不可用">
      <DebugApp />
    </AppErrorBoundary>
  </React.StrictMode>,
);
