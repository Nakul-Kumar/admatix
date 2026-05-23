import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("AdMatix cockpit: missing #root element in index.html");
}

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
