import React from "react";
import { createRoot } from "react-dom/client";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { LibraryApp } from "./components/LibraryApp";
import "../styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary title="处理库暂时不可用">
      <LibraryApp />
    </AppErrorBoundary>
  </React.StrictMode>,
);
