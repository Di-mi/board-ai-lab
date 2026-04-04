import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        leaderboard: path.resolve(__dirname, "index.html"),
        latency: path.resolve(__dirname, "latency.html"),
        play: path.resolve(__dirname, "play.html"),
        methodology: path.resolve(__dirname, "methodology.html"),
        rulebook: path.resolve(__dirname, "rulebook.html")
      }
    }
  },
  test: {
    environment: "jsdom"
  }
});
