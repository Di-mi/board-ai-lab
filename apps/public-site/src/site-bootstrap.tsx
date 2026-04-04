import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SiteLoader, type PublicSitePage } from "./PublicSite.js";
import "./styles.css";

export function renderPage(page?: PublicSitePage): void {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Root element not found");
  }

  createRoot(root).render(
    <StrictMode>
      <SiteLoader page={page} />
    </StrictMode>
  );
}
