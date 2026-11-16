import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/base.css";
import { Panel } from "./panel/Panel";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
