import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { SiteView } from "./PublicSite.js";
import type { PublicBenchmarks } from "./lib/benchmarks.js";

const fixture: PublicBenchmarks = {
  updatedAtIso: "2026-03-11T12:00:00.000Z",
  siteName: "Meeples & Models",
  games: [
    {
      id: "onitama",
      label: "Onitama",
      status: "playable"
    }
  ],
  difficulties: [
    { id: "easy", label: "Easy", description: "Random", sortOrder: 1 },
    { id: "hard", label: "Hard", description: "Deep heuristic", sortOrder: 3 }
  ],
  models: [
    { id: "openai/gpt-5.3-codex", label: "Openai GPT 5.3 Codex", provider: "openai", family: "GPT", status: "active" },
    { id: "anthropic/claude-opus-4.6", label: "Anthropic Claude Opus 4.6", provider: "anthropic", family: "Claude", status: "active" }
  ],
  records: [
    {
      id: "record-a1",
      gameId: "onitama",
      scoreModel: "onitama-v1",
      modelId: "openai/gpt-5.3-codex",
      difficultyId: "easy",
      playedAtIso: "2026-03-11T10:00:00.000Z",
      scheduledGames: 2,
      completedGames: 2,
      wins: 2,
      draws: 0,
      losses: 0,
      gradedMoveCount: 4,
      moveQualitySum: 3.2,
      latencySamplesMs: [900, 1000, 1100, 1200],
      avgLatencyPerMoveMs: 1050,
      source: { kind: "llm-session", id: "record-a1" }
    },
    {
      id: "record-b1",
      gameId: "onitama",
      scoreModel: "onitama-v1",
      modelId: "anthropic/claude-opus-4.6",
      difficultyId: "hard",
      playedAtIso: "2026-03-11T09:00:00.000Z",
      scheduledGames: 3,
      completedGames: 3,
      wins: 1,
      draws: 0,
      losses: 2,
      gradedMoveCount: 6,
      moveQualitySum: 4.8,
      latencySamplesMs: [2500, 2600, 2800],
      avgLatencyPerMoveMs: 2633.33,
      source: { kind: "llm-session", id: "record-b1" }
    }
  ]
};

describe("PublicSite", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  test("updates leaderboard and latency tables from shared filters and resets play", () => {
    window.history.replaceState({}, "", "/index.html");
    act(() => {
      root.render(<SiteView page="leaderboard" data={fixture} />);
    });

    expect(container.querySelector("h1")?.textContent).toContain("Leaderboard");

    const filterButtons = container.querySelectorAll('button[aria-haspopup="listbox"]');
    const difficultyButton = filterButtons[1] as HTMLButtonElement | undefined;
    const modelButton = filterButtons[2] as HTMLButtonElement | undefined;

    act(() => {
      difficultyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const hardOption = Array.from(container.querySelectorAll('[role="option"]')).find((option) => option.textContent?.trim() === "Hard");

    act(() => {
      hardOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      modelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const modelOption = Array.from(container.querySelectorAll('[role="option"]')).find((option) =>
      option.textContent?.trim() === "Anthropic Claude Opus 4.6"
    );

    act(() => {
      modelOption?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);

    act(() => {
      root.render(<SiteView page="play" data={fixture} />);
    });

    expect(container.querySelector('[aria-label="Onitama board"]')).not.toBeNull();

    const buttons = Array.from(container.querySelectorAll("button"));
    const hardButton = buttons.find((button) => button.textContent?.trim() === "Hard");
    const newMatchButton = buttons.find((button) => button.textContent?.trim() === "New match");

    act(() => {
      hardButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      newMatchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector(".play-status")?.textContent).toContain("New match loaded");
  });
});
