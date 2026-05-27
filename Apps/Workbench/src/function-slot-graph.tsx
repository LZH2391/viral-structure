import React from "react";
import { createRoot } from "react-dom/client";
import { FunctionSlotGraphApp } from "./components/FunctionSlotGraphApp";
import "../styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <FunctionSlotGraphApp />
  </React.StrictMode>,
);
