import React from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { WorkbenchApp } from "./components/WorkbenchApp";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary title="结构迁移工作台暂时不可用">
      <WorkbenchApp />
    </AppErrorBoundary>
  </React.StrictMode>,
);
