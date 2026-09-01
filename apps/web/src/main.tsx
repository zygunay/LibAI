import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) throw new Error("LibAI root element was not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
