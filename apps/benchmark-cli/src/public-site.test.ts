import { describe, expect, test, vi } from "vitest";
import {
  buildPublicBenchmarksPayload,
  computeNormalizedMoveQuality,
  inferDifficultyId,
  mapSessionToPublicRecord
} from "./public-site.js";

describe("public site exporter helpers", () => {
  test("maps curated difficulty ids from opponent config and run id", () => {
    expect(inferDifficultyId({ opponentMode: "random", opponentDepth: 2, gameCount: 3 })).toBe("easy");
    expect(inferDifficultyId({ opponentMode: "trained", opponentDepth: 2, gameCount: 3 }, "train-1772783009731")).toBe("standard");
    expect(inferDifficultyId({ opponentMode: "trained", opponentDepth: 2, gameCount: 3 }, "train-1772878297644")).toBe("hard");
  });

  test("falls back to opponent depth when run id is unknown", () => {
    expect(inferDifficultyId({ opponentMode: "trained", opponentDepth: 1, gameCount: 3 })).toBe("standard");
    expect(inferDifficultyId({ opponentMode: "trained", opponentDepth: 2, gameCount: 3 })).toBe("hard");
  });

  test("normalizes move quality by rank", () => {
    expect(computeNormalizedMoveQuality(1, 5)).toBe(1);
    expect(computeNormalizedMoveQuality(5, 5)).toBe(0);
    expect(computeNormalizedMoveQuality(1, 1)).toBe(1);
  });

  test("maps a completed graded session into one public record", () => {
    const record = mapSessionToPublicRecord({
      sessionId: "llm-session-1",
      status: "completed",
      updatedAtIso: "2026-03-11T12:00:00.000Z",
      provider: "openrouter",
      modelId: "openai/gpt-5.3-codex",
      opponentRunId: "train-1772783009731",
      config: {
        gameCount: 3,
        opponentDepth: 2,
        opponentMode: "trained"
      },
      matches: [
        {
          status: "completed",
          winner: "red",
          llmSide: "red",
          turns: [
            { actor: "llm", latencyMs: 1200, grade: { rank: 1, legalMoveCount: 4 } },
            { actor: "heuristic" }
          ]
        },
        {
          status: "completed",
          winner: undefined,
          llmSide: "blue",
          turns: [{ actor: "llm", latencyMs: 1800, grade: { rank: 2, legalMoveCount: 4 } }]
        }
      ]
    });

    expect(record).toMatchObject({
      modelId: "openai/gpt-5.3-codex",
      difficultyId: "standard",
      scheduledGames: 3,
      completedGames: 2,
      wins: 1,
      draws: 1,
      losses: 0,
      gradedMoveCount: 2
    });
    expect(record?.moveQualitySum).toBeCloseTo(1 + (1 - 1 / 3));
    expect(record?.avgLatencyPerMoveMs).toBe(1500);
  });

  test("skips incomplete sessions when building payload", () => {
    const log = vi.fn();
    const payload = buildPublicBenchmarksPayload(
      [
        {
          sessionId: "llm-valid",
          status: "completed",
          updatedAtIso: "2026-03-11T12:00:00.000Z",
          provider: "openrouter",
          modelId: "anthropic/claude-opus-4.6",
          config: {
            gameCount: 1,
            opponentDepth: 2,
            opponentMode: "random"
          },
          matches: [
            {
              status: "completed",
              winner: "red",
              llmSide: "red",
              turns: [{ actor: "llm", latencyMs: 900, grade: { rank: 1, legalMoveCount: 3 } }]
            }
          ]
        },
        {
          sessionId: "llm-invalid",
          status: "completed",
          updatedAtIso: "2026-03-11T12:05:00.000Z",
          provider: "openrouter",
          modelId: "openai/gpt-5.4",
          config: {
            gameCount: 1,
            opponentDepth: 2,
            opponentMode: "random"
          },
          matches: [
            {
              status: "completed",
              winner: "blue",
              llmSide: "red",
              turns: [{ actor: "llm" }]
            }
          ]
        }
      ],
      [],
      log
    );

    expect(payload.records).toHaveLength(1);
    expect(payload.models).toHaveLength(1);
    expect(log).toHaveBeenCalled();
  });
});
