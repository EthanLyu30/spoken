import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Self-hosted editorial typefaces (bundled — reliable without external CDNs).
import "@fontsource-variable/fraunces";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/space-grotesk";

import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
