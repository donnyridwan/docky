import React from "react";
import ReactDOM from "react-dom/client";
// Font Archivo (OFL) disertakan di dalam app supaya sama persis dengan Figma.
import "@fontsource-variable/archivo";
import "./styles/base.css";
import { Panel } from "./panel/Panel";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
