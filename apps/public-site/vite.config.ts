import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        leaderboard: path.resolve(__dirname, "index.html"),
        latency: path.resolve(__dirname, "latency/index.html"),
        play: path.resolve(__dirname, "play/index.html"),
        methodology: path.resolve(__dirname, "methodology/index.html"),
        rulebook: path.resolve(__dirname, "rulebook/index.html"),
        latencyLegacy: path.resolve(__dirname, "latency.html"),
        playLegacy: path.resolve(__dirname, "play.html"),
        methodologyLegacy: path.resolve(__dirname, "methodology.html"),
        rulebookLegacy: path.resolve(__dirname, "rulebook.html")
      }
    }
  },
  test: {
    environment: "jsdom"
  }
});
