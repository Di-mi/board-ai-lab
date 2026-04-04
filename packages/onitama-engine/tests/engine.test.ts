import { describe, expect, test } from "vitest";
import { OnitamaEngine, stateHash } from "../src/index.js";

describe("OnitamaEngine", () => {
  test("initial state has expected setup", () => {
    const engine = new OnitamaEngine();
    const state = engine.initialState();

    expect(state.turn).toBe(0);
    expect(state.board.filter(Boolean)).toHaveLength(10);
    expect(state.currentPlayer).toBe("blue");
    expect(state.cards.red).toEqual(["tiger", "dragon"]);
    expect(state.cards.blue).toEqual(["frog", "rabbit"]);
    expect(state.cards.side).toBe("crab");
  });

  test("applyMove rotates cards and switches turn", () => {
    const engine = new OnitamaEngine();
    const state = engine.initialState({ startingPlayer: "red" });
    const move = engine.legalMoves(state)[0];
    if (!move) throw new Error("Expected at least one legal move");

    const next = engine.applyMove(state, move);

    expect(next.currentPlayer).toBe("blue");
    expect(next.turn).toBe(1);
    expect(next.cards.side).toBe(move.card);
    expect(next.cards.red.includes("crab")).toBe(true);
  });

  test("seeded initial state draws a deterministic 5-card subset from the base deck", () => {
    const engine = new OnitamaEngine();
    const a = engine.initialState({ seed: 12345 });
    const b = engine.initialState({ seed: 12345 });
    const cards = [...a.cards.red, ...a.cards.blue, a.cards.side];

    expect(a.cards).toEqual(b.cards);
    expect(new Set(cards).size).toBe(5);
    expect(cards).toEqual(["mantis", "dragon", "monkey", "crane", "eel"]);
  });

  test("state hash is deterministic with same move policy", () => {
    const engine = new OnitamaEngine();
    const run = () => {
      let state = engine.initialState();
      const hashes: string[] = [stateHash(state)];

      for (let i = 0; i < 8; i += 1) {
        const legal = engine.legalMoves(state);
        const move = [...legal].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))[0];
        if (!move) {
          break;
        }
        state = engine.applyMove(state, move);
        hashes.push(stateHash(state));
      }

      return hashes;
    };

    expect(run()).toEqual(run());
  });

  test("capturing master ends game", () => {
    const engine = new OnitamaEngine();
    const state = engine.initialState({
      startingPlayer: "red"
    });

    const custom = {
      ...state,
      board: Array(25).fill(null),
      cards: {
        red: ["crab", "dragon"] as ["crab", "dragon"],
        blue: ["frog", "rabbit"] as ["frog", "rabbit"],
        side: "tiger" as const
      }
    };

    custom.board[22] = { player: "red", type: "master" };
    custom.board[17] = { player: "blue", type: "master" };

    const move = { card: "crab" as const, from: { x: 2, y: 4 }, to: { x: 2, y: 3 } };
    const next = engine.applyMove(custom, move);

    expect(next.winner).toBe("red");
    expect(next.winReason).toBe("captured-master");
  });
});
