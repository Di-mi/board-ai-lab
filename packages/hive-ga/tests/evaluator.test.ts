import { describe, expect, it } from "vitest";
import { HiveEngine } from "@board-ai-lab/hive-engine";
import { HiveHeuristicAgent } from "../src/agent.js";
import { DEFAULT_HIVE_WEIGHTS, HiveHeuristicEvaluator } from "../src/evaluator.js";

const engine = new HiveEngine();

describe("HiveHeuristicEvaluator", () => {
  it("scores the initial state without crashing", () => {
    const state = engine.initialState();
    const score = HiveHeuristicEvaluator.score(state, "white", DEFAULT_HIVE_WEIGHTS);
    expect(Number.isFinite(score)).toBe(true);
  });

  it("agent chooses a legal move", () => {
    const state = engine.initialState();
    const legal = engine.legalMoves(state);
    const agent = new HiveHeuristicAgent(DEFAULT_HIVE_WEIGHTS, 1);
    const move = agent.selectMove(state, legal);
    expect(legal).toContainEqual(move);
  });
});
