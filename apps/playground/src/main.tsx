import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import HiveApp from "./HiveApp.js";
import ReviewPage from "./ReviewPage.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    {window.location.pathname === "/review" ? <ReviewPage /> : window.location.pathname === "/hive" ? <HiveApp /> : <App />}
  </StrictMode>
);
