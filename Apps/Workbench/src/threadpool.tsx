import React from "react";
import { createRoot } from "react-dom/client";
import { ThreadPoolApp } from "./components/ThreadPoolApp";
import "../styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThreadPoolApp />
  </React.StrictMode>,
);
