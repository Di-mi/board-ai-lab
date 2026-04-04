import { describe, expect, test } from "vitest";
import { OnitamaEngine } from "@board-ai-lab/onitama-engine";
import { DEFAULT_WEIGHTS, HeuristicEvaluator, trainHeuristic } from "../src/index.js";

describe("HeuristicEvaluator", () => {
  test("produces finite score", () => {
    const engine = new OnitamaEngine();
    const state = engine.initialState();
    const score = HeuristicEvaluator.score(state, "red", DEFAULT_WEIGHTS);
    expect(Number.isFinite(score)).toBe(true);
  });

  test("training returns a best genome", () => {
    const result = trainHeuristic({
      populationSize: 10,
      generations: 3,
      elitismCount: 2,
      gamesPerGenome: 2,
      searchDepth: 1,
      seed: 7
    });

    expect(result.bestGenome.weights.material).toBeTypeOf("number");
    expect(result.history.length).toBe(3);
    expect(result.recentGames.length).toBeGreaterThan(0);
    expect(result.recentGames.length).toBeLessThanOrEqual(10);
  });
});
