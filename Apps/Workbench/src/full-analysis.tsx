import React from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { FullAnalysisApp } from "./components/FullAnalysisApp";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary title="完整分析暂时不可用">
      <FullAnalysisApp />
    </AppErrorBoundary>
  </React.StrictMode>,
);
