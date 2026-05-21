import React from "react";
import { createRoot } from "react-dom/client";
import { LibraryApp } from "./components/LibraryApp";
import "../styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LibraryApp />
  </React.StrictMode>,
);
