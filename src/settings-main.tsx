import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/archivo";
import "./styles/base.css";
import { SettingsWindow } from "./settings/Settings";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsWindow />
  </React.StrictMode>,
);
