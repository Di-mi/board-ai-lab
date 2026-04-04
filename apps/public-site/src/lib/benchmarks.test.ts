import { describe, expect, test } from "vitest";
import { buildLeaderboardRows, computeDisplayedScore, computeLatencyStats, type PublicBenchmarks } from "./benchmarks.js";

const fixture: PublicBenchmarks = {
  updatedAtIso: "2026-03-11T12:00:00.000Z",
  siteName: "Meeples & Models",
  games: [
    {
      id: "onitama",
      label: "Onitama",
      status: "playable"
    },
    {
      id: "hive",
      label: "Hive",
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
      id: "record-a2",
      gameId: "onitama",
      scoreModel: "onitama-v1",
      modelId: "openai/gpt-5.3-codex",
      difficultyId: "hard",
      playedAtIso: "2026-03-11T11:00:00.000Z",
      scheduledGames: 1,
      completedGames: 1,
      wins: 0,
      draws: 1,
      losses: 0,
      gradedMoveCount: 2,
      moveQualitySum: 1.2,
      latencySamplesMs: [1500, 1700],
      avgLatencyPerMoveMs: 1600,
      source: { kind: "llm-session", id: "record-a2" }
    },
    {
      id: "record-a3",
      gameId: "hive",
      scoreModel: "hive-v1",
      modelId: "openai/gpt-5.3-codex",
      difficultyId: "hard",
      playedAtIso: "2026-03-11T11:30:00.000Z",
      scheduledGames: 2,
      completedGames: 2,
      wins: 1,
      draws: 1,
      losses: 0,
      gradedMoveCount: 0,
      moveQualitySum: 0,
      latencySamplesMs: [1300, 1450, 1520, 1580],
      avgLatencyPerMoveMs: 1462.5,
      maxTurns: 60,
      sideStats: {
        white: { scheduledGames: 1, completedGames: 1, wins: 1, draws: 0, losses: 0, pointSum: 1.12 },
        black: { scheduledGames: 1, completedGames: 1, wins: 0, draws: 1, losses: 0, pointSum: 0.45 }
      },
      source: { kind: "llm-session", id: "record-a3" }
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

describe("benchmark utilities", () => {
  test("aggregates rows across multiple records for a model", () => {
    const rows = buildLeaderboardRows(fixture, {
      gameId: "all",
      difficultyId: "all",
      modelId: "all"
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.modelId).toBe("openai/gpt-5.3-codex");
    expect(rows[0]?.completedGames).toBe(5);
    expect(rows[0]?.gameLabel).toBe("All games");
    expect(rows[0]?.difficultyLabel).toBe("Multiple");
    expect(rows[0]?.latency.samples).toBe(10);
  });

  test("filters rows by difficulty and model", () => {
    const rows = buildLeaderboardRows(fixture, {
      gameId: "all",
      difficultyId: "hard",
      modelId: "openai/gpt-5.3-codex"
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.completedGames).toBe(3);
    expect(rows[0]?.difficultyLabel).toBe("Hard");
  });

  test("computes latency stats from merged samples", () => {
    const stats = computeLatencyStats([900, 1100, 1700, 2500, 2600]);
    expect(stats.avg).toBeCloseTo(1760);
    expect(stats.median).toBe(1700);
    expect(stats.p90).toBe(2600);
    expect(stats.slowest).toBe(2600);
  });

  test("computes displayed score from the hybrid formula", () => {
    const score = computeDisplayedScore({
      gameId: "onitama",
      scoreModel: "onitama-v1",
      wins: 2,
      draws: 1,
      losses: 1,
      scheduledGames: 4,
      completedGames: 3,
      gradedMoveCount: 6,
      moveQualitySum: 4.5,
      avgLatencyPerMoveMs: 1600
    });

    expect(score.outcomeScore).toBe(0.625);
    expect(score.moveQuality).toBe(0.75);
    expect(score.reliability).toBe(0.75);
    expect(score.speedScore).toBe(1);
    expect(score.displayedScore).toBeCloseTo(71.3);
  });
});
