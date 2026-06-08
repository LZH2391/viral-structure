import React from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { FunctionSlotGraphApp } from "./components/FunctionSlotGraphApp";
import "../styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary title="结构图谱暂时不可用">
      <FunctionSlotGraphApp />
    </AppErrorBoundary>
  </React.StrictMode>,
);
