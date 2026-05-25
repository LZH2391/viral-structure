import React from "react";
import { createRoot } from "react-dom/client";
import { FullAnalysisApp } from "./components/FullAnalysisApp";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FullAnalysisApp />
  </React.StrictMode>,
);
