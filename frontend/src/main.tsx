import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Self-hosted rounded typefaces (bundled — reliable without external CDNs).
import "@fontsource-variable/fredoka";
import "@fontsource-variable/nunito";

import App from "./App";
import "./index.css";
import "./ui.css";
import { bootstrapLocalSpeechModels } from "./lib/localSpeech/bootstrap";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

// Download and warm local speech models only after the first paint/idle slot.
// This is deliberately fire-and-forget: cloud speech remains the live fallback.
bootstrapLocalSpeechModels();
