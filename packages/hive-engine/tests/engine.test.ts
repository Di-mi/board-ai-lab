import { describe, expect, it } from "vitest";
import { HiveEngine, keyOf, stateHash, topPieceAt, type HiveState } from "../src/index.js";

const engine = new HiveEngine();

describe("HiveEngine", () => {
  it("starts with five legal opening placements at the origin", () => {
    const state = engine.initialState();
    const legal = engine.legalMoves(state);

    expect(legal).toHaveLength(5);
    expect(legal.every((move) => move.type === "place")).toBe(true);
    expect(legal.every((move) => move.type !== "place" || (move.to.q === 0 && move.to.r === 0))).toBe(true);
  });

  it("requires the queen by the fourth turn for a player", () => {
    let state = engine.initialState();
    state = engine.applyMove(state, { type: "place", bug: "ant", to: { q: 0, r: 0 } });
    state = engine.applyMove(state, { type: "place", bug: "ant", to: { q: 1, r: 0 } });
    state = engine.applyMove(state, { type: "place", bug: "spider", to: { q: -1, r: 0 } });
    state = engine.applyMove(state, { type: "place", bug: "spider", to: { q: 2, r: 0 } });
    state = engine.applyMove(state, { type: "place", bug: "beetle", to: { q: -2, r: 0 } });
    state = engine.applyMove(state, { type: "place", bug: "beetle", to: { q: 3, r: 0 } });

    const legal = engine.legalMoves(state);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((move) => move.type === "place" && move.bug === "queen")).toBe(true);
  });

  it("does not allow movement before the queen is placed", () => {
    let state = engine.initialState();
    state = engine.applyMove(state, { type: "place", bug: "ant", to: { q: 0, r: 0 } });
    state = engine.applyMove(state, { type: "place", bug: "ant", to: { q: 1, r: 0 } });
    state = engine.applyMove(state, { type: "place", bug: "spider", to: { q: -1, r: 0 } });
    state = engine.applyMove(state, { type: "place", bug: "spider", to: { q: 2, r: 0 } });

    const legal = engine.legalMoves(state);
    expect(legal.some((move) => move.type === "move")).toBe(false);
  });

  it("lets a grasshopper jump over a line of occupied hexes", () => {
    const state: HiveState = {
      cells: {
        [keyOf({ q: 0, r: 0 })]: [{ id: "w-hopper", player: "white", bug: "grasshopper" }],
        [keyOf({ q: 1, r: 0 })]: [{ id: "b-ant", player: "black", bug: "ant" }],
        [keyOf({ q: 2, r: 0 })]: [{ id: "b-queen", player: "black", bug: "queen" }],
        [keyOf({ q: 1, r: -1 })]: [{ id: "w-queen", player: "white", bug: "queen" }]
      },
      reserves: {
        white: { queen: 0, beetle: 2, spider: 2, grasshopper: 2, ant: 3 },
        black: { queen: 0, beetle: 2, spider: 2, grasshopper: 3, ant: 2 }
      },
      currentPlayer: "white",
      turn: 6
    };

    const legal = engine.legalMoves(state);
    expect(
      legal.some(
        (move) => move.type === "move" && move.from.q === 0 && move.from.r === 0 && move.to.q === 3 && move.to.r === 0
      )
    ).toBe(true);
  });

  it("never generates a self-move for an ant after removing it from the hive", () => {
    const state: HiveState = {
      cells: {
        [keyOf({ q: 3, r: -3 })]: [{ id: "b-ant-1", player: "black", bug: "ant" }],
        [keyOf({ q: 3, r: -4 })]: [{ id: "b-ant-2", player: "black", bug: "ant" }],
        [keyOf({ q: 2, r: -4 })]: [{ id: "b-ant-3", player: "black", bug: "ant" }],
        [keyOf({ q: 2, r: -3 })]: [{ id: "w-queen", player: "white", bug: "queen" }],
        [keyOf({ q: 2, r: 1 })]: [{ id: "b-queen", player: "black", bug: "queen" }],
        [keyOf({ q: 1, r: 1 })]: [{ id: "b-spider", player: "black", bug: "spider" }],
        [keyOf({ q: 1, r: 0 })]: [{ id: "b-beetle", player: "black", bug: "beetle" }],
        [keyOf({ q: 1, r: -2 })]: [{ id: "w-ant-1", player: "white", bug: "ant" }],
        [keyOf({ q: 0, r: -2 })]: [{ id: "w-grasshopper", player: "white", bug: "grasshopper" }],
        [keyOf({ q: 0, r: -1 })]: [{ id: "w-ant-2", player: "white", bug: "ant" }],
        [keyOf({ q: 0, r: 0 })]: [{ id: "w-ant-3", player: "white", bug: "ant" }],
        [keyOf({ q: -1, r: -1 })]: [{ id: "w-spider", player: "white", bug: "spider" }],
        [keyOf({ q: -1, r: 1 })]: [{ id: "w-grasshopper-2", player: "white", bug: "grasshopper" }],
        [keyOf({ q: -2, r: 0 })]: [{ id: "w-grasshopper-3", player: "white", bug: "grasshopper" }],
        [keyOf({ q: -3, r: 0 })]: [{ id: "w-spider-2", player: "white", bug: "spider" }],
        [keyOf({ q: -4, r: 0 })]: [{ id: "w-beetle", player: "white", bug: "beetle" }],
        [keyOf({ q: -4, r: 1 })]: [{ id: "w-beetle-2", player: "white", bug: "beetle" }],
        [keyOf({ q: -1, r: 3 })]: [{ id: "b-grasshopper", player: "black", bug: "grasshopper" }],
        [keyOf({ q: 0, r: 2 })]: [{ id: "b-grasshopper-2", player: "black", bug: "grasshopper" }]
      },
      reserves: {
        white: { queen: 0, beetle: 0, spider: 0, grasshopper: 0, ant: 0 },
        black: { queen: 0, beetle: 1, spider: 1, grasshopper: 1, ant: 0 }
      },
      currentPlayer: "black",
      turn: 23
    };

    const legal = engine.legalMoves(state);
    expect(
      legal.some(
        (move) => move.type === "move" && move.from.q === 3 && move.from.r === -3 && move.to.q === 3 && move.to.r === -3
      )
    ).toBe(false);
  });

  it("lets a beetle climb onto an adjacent occupied hex", () => {
    const state: HiveState = {
      cells: {
        [keyOf({ q: 0, r: 0 })]: [{ id: "w-queen", player: "white", bug: "queen" }],
        [keyOf({ q: 1, r: 0 })]: [{ id: "w-beetle", player: "white", bug: "beetle" }],
        [keyOf({ q: 0, r: 1 })]: [{ id: "b-queen", player: "black", bug: "queen" }]
      },
      reserves: {
        white: { queen: 0, beetle: 1, spider: 2, grasshopper: 3, ant: 3 },
        black: { queen: 0, beetle: 2, spider: 2, grasshopper: 3, ant: 3 }
      },
      currentPlayer: "white",
      turn: 5
    };

    const legal = engine.legalMoves(state);
    expect(
      legal.some(
        (move) => move.type === "move" && move.from.q === 1 && move.from.r === 0 && move.to.q === 0 && move.to.r === 1
      )
    ).toBe(true);
  });

  it("keeps beetle climbing moves when the beetle starts on top of a stack", () => {
    const state: HiveState = {
      cells: {
        [keyOf({ q: 0, r: 0 })]: [
          { id: "w-queen", player: "white", bug: "queen" },
          { id: "w-beetle", player: "white", bug: "beetle" }
        ],
        [keyOf({ q: 1, r: 0 })]: [{ id: "b-queen", player: "black", bug: "queen" }],
        [keyOf({ q: -1, r: 0 })]: [{ id: "b-ant", player: "black", bug: "ant" }],
        [keyOf({ q: 0, r: -1 })]: [{ id: "w-ant", player: "white", bug: "ant" }]
      },
      reserves: {
        white: { queen: 0, beetle: 1, spider: 2, grasshopper: 3, ant: 2 },
        black: { queen: 0, beetle: 2, spider: 2, grasshopper: 3, ant: 2 }
      },
      currentPlayer: "white",
      turn: 8
    };

    const legal = engine.legalMoves(state);
    expect(
      legal.some(
        (move) => move.type === "move" && move.from.q === 0 && move.from.r === 0 && move.to.q === 1 && move.to.r === 0
      )
    ).toBe(true);
  });

  it("lets a beetle climb onto a height-2 opponent stack through a tight gate", () => {
    const state: HiveState = {
      cells: {
        [keyOf({ q: 1, r: 0 })]: [{ id: "w-beetle", player: "white", bug: "beetle" }],
        [keyOf({ q: 0, r: 0 })]: [
          { id: "b-queen", player: "black", bug: "queen" },
          { id: "b-beetle", player: "black", bug: "beetle" }
        ],
        [keyOf({ q: 1, r: -1 })]: [{ id: "w-ant", player: "white", bug: "ant" }],
        [keyOf({ q: 0, r: 1 })]: [{ id: "b-ant", player: "black", bug: "ant" }],
        [keyOf({ q: 1, r: 1 })]: [{ id: "w-spider", player: "white", bug: "spider" }],
        [keyOf({ q: 2, r: 0 })]: [{ id: "w-queen", player: "white", bug: "queen" }]
      },
      reserves: {
        white: { queen: 0, beetle: 1, spider: 2, grasshopper: 3, ant: 2 },
        black: { queen: 0, beetle: 1, spider: 2, grasshopper: 3, ant: 2 }
      },
      currentPlayer: "white",
      turn: 8
    };

    const legal = engine.legalMoves(state);
    expect(
      legal.some(
        (move) => move.type === "move" && move.from.q === 1 && move.from.r === 0 && move.to.q === 0 && move.to.r === 0
      )
    ).toBe(true);
  });

  it("ends the game when a queen is fully surrounded", () => {
    const state: HiveState = {
      cells: {
        [keyOf({ q: 0, r: 0 })]: [{ id: "w-queen", player: "white", bug: "queen" }],
        [keyOf({ q: 1, r: 0 })]: [{ id: "b-a1", player: "black", bug: "ant" }],
        [keyOf({ q: 1, r: -1 })]: [{ id: "b-a2", player: "black", bug: "ant" }],
        [keyOf({ q: 0, r: -1 })]: [{ id: "b-a3", player: "black", bug: "ant" }],
        [keyOf({ q: -1, r: 0 })]: [{ id: "b-s1", player: "black", bug: "spider" }],
        [keyOf({ q: -1, r: 1 })]: [{ id: "b-s2", player: "black", bug: "spider" }],
        [keyOf({ q: 1, r: 1 })]: [{ id: "b-b1", player: "black", bug: "beetle" }],
        [keyOf({ q: 2, r: -1 })]: [{ id: "b-queen", player: "black", bug: "queen" }]
      },
      reserves: {
        white: { queen: 0, beetle: 2, spider: 2, grasshopper: 3, ant: 3 },
        black: { queen: 0, beetle: 1, spider: 0, grasshopper: 3, ant: 0 }
      },
      currentPlayer: "black",
      turn: 9
    };

    const next = engine.applyMove(state, { type: "move", from: { q: 1, r: 1 }, to: { q: 0, r: 1 } });
    expect(next.winner).toBe("black");
    expect(next.winReason).toBe("surrounded-queen");
  });

  it("produces a stable state hash after legal moves", () => {
    let state = engine.initialState();
    state = engine.applyMove(state, { type: "place", bug: "queen", to: { q: 0, r: 0 } });
    state = engine.applyMove(state, { type: "place", bug: "queen", to: { q: 1, r: 0 } });
    const hash = stateHash(state);
    expect(hash).toContain("white");
    expect(topPieceAt(state, { q: 0, r: 0 })?.bug).toBe("queen");
  });
});
