import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/base.css";
import { PickerWindow } from "./picker/Picker";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PickerWindow />
  </React.StrictMode>,
);
