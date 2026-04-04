import { HiveEngine, keyOf, surroundingHexes, topPieceAt, type HexCoordinate, type HiveState, type Player } from "@board-ai-lab/hive-engine";
import type { HiveHeuristicWeights } from "./types.js";

export const DEFAULT_HIVE_WEIGHTS: HiveHeuristicWeights = {
  queenPressure: 2.2,
  queenLiberties: 1.8,
  mobility: 0.5,
  reserveDevelopment: 0.35,
  placementFreedom: 0.25,
  stackControl: 0.75,
  contactPressure: 0.9,
  queenClosurePotential: 1.0,
  beetlePressure: 1.3,
  queenRingQuality: 1.2,
  queenTiming: 0.9,
  surroundLeverage: 1.5,
  beetleLock: 2.2
};

export function normalizeHiveWeights(weights?: Partial<HiveHeuristicWeights> | null): HiveHeuristicWeights {
  return {
    ...DEFAULT_HIVE_WEIGHTS,
    ...weights
  };
}

const engine = new HiveEngine();

function opponent(player: Player): Player {
  return player === "white" ? "black" : "white";
}

function legalMovesFor(state: HiveState, player: Player) {
  return engine.legalMoves({ ...state, currentPlayer: player });
}

function countPlayableMoves(state: HiveState, player: Player): number {
  const legal = legalMovesFor(state, player);
  return legal[0]?.type === "pass" && legal.length === 1 ? 0 : legal.length;
}

function countPlacementMoves(state: HiveState, player: Player): number {
  return legalMovesFor(state, player).filter((move) => move.type === "place").length;
}

function queenHex(state: HiveState, player: Player): HexCoordinate | undefined {
  for (const key of Object.keys(state.cells)) {
    const top = topPieceAt(state, stateKeyToHex(key));
    const stack = state.cells[key] ?? [];
    for (const piece of stack) {
      if (piece.player === player && piece.bug === "queen") {
        return stateKeyToHex(key);
      }
    }
    if (top?.player === player && top.bug === "queen") {
      return stateKeyToHex(key);
    }
  }
  return undefined;
}

function stateKeyToHex(key: string): HexCoordinate {
  const [qRaw, rRaw] = key.split(",");
  return { q: Number(qRaw), r: Number(rRaw) };
}

function countPlacedPieces(state: HiveState, player: Player): number {
  let count = 0;
  for (const stack of Object.values(state.cells)) {
    for (const piece of stack) {
      if (piece.player === player) count += 1;
    }
  }
  return count;
}

function occupiedNeighborCount(state: HiveState, hex: HexCoordinate): number {
  return surroundingHexes(hex).filter((neighbor) => (state.cells[keyOf(neighbor)]?.length ?? 0) > 0).length;
}

function queenPressure(state: HiveState, player: Player): number {
  const ownQueen = queenHex(state, player);
  const oppQueen = queenHex(state, opponent(player));
  const ownPressure = ownQueen ? occupiedNeighborCount(state, ownQueen) : 0;
  const oppPressure = oppQueen ? occupiedNeighborCount(state, oppQueen) : 0;
  return oppPressure - ownPressure;
}

function queenLiberties(state: HiveState, player: Player): number {
  const ownQueen = queenHex(state, player);
  const oppQueen = queenHex(state, opponent(player));
  const ownLiberties = ownQueen ? 6 - occupiedNeighborCount(state, ownQueen) : 6;
  const oppLiberties = oppQueen ? 6 - occupiedNeighborCount(state, oppQueen) : 6;
  return ownLiberties - oppLiberties;
}

function reservesRemaining(state: HiveState, player: Player): number {
  const reserve = state.reserves[player];
  return reserve.queen + reserve.beetle + reserve.spider + reserve.grasshopper + reserve.ant;
}

function reserveDevelopment(state: HiveState, player: Player): number {
  return reservesRemaining(state, opponent(player)) - reservesRemaining(state, player);
}

function stackControl(state: HiveState, player: Player): number {
  let own = 0;
  let opp = 0;
  for (const stack of Object.values(state.cells)) {
    if (stack.length <= 1) continue;
    const top = stack[stack.length - 1];
    if (!top) continue;
    if (top.player === player) own += stack.length - 1;
    else opp += stack.length - 1;
  }
  return own - opp;
}

function contactPressure(state: HiveState, player: Player): number {
  const oppQueen = queenHex(state, opponent(player));
  const ownQueen = queenHex(state, player);
  const aroundOpp = oppQueen
    ? surroundingHexes(oppQueen).filter((hex) => topPieceAt(state, hex)?.player === player).length
    : 0;
  const aroundOwn = ownQueen
    ? surroundingHexes(ownQueen).filter((hex) => topPieceAt(state, hex)?.player === opponent(player)).length
    : 0;
  return aroundOpp - aroundOwn;
}

function queenClosurePotential(state: HiveState, player: Player): number {
  const ownQueen = queenHex(state, player);
  const oppQueen = queenHex(state, opponent(player));
  const countPlacablePressure = (target: HexCoordinate | undefined, owner: Player): number => {
    if (!target) return 0;
    let total = 0;
    for (const neighbor of surroundingHexes(target)) {
      if ((state.cells[keyOf(neighbor)]?.length ?? 0) > 0) continue;
      const supportedByOwner = surroundingHexes(neighbor).some((adjacent) => topPieceAt(state, adjacent)?.player === owner);
      if (supportedByOwner) total += 1;
    }
    return total;
  };

  return countPlacablePressure(oppQueen, player) - countPlacablePressure(ownQueen, opponent(player));
}

function beetlePressure(state: HiveState, player: Player): number {
  const ownQueen = queenHex(state, player);
  const oppQueen = queenHex(state, opponent(player));
  let own = 0;
  let opp = 0;

  for (const [key, stack] of Object.entries(state.cells)) {
    const top = stack[stack.length - 1];
    if (!top || top.bug !== "beetle") continue;
    const hex = stateKeyToHex(key);
    const pressure =
      1 +
      (stack.length > 1 ? 1 : 0) +
      (oppQueen && surroundingHexes(oppQueen).some((neighbor) => keyOf(neighbor) === key) ? 2 : 0) +
      (ownQueen && surroundingHexes(ownQueen).some((neighbor) => keyOf(neighbor) === key) ? -2 : 0);

    if (top.player === player) own += pressure;
    else opp += pressure;
  }

  return own - opp;
}

function queenRingQuality(state: HiveState, player: Player): number {
  const ownQueen = queenHex(state, player);
  const oppQueen = queenHex(state, opponent(player));

  const ringScore = (target: HexCoordinate | undefined, attacker: Player): number => {
    if (!target) return 0;
    return surroundingHexes(target).reduce((sum, neighbor) => {
      const top = topPieceAt(state, neighbor);
      if (!top) return sum;
      if (top.player === attacker) {
        return sum + (top.bug === "beetle" ? 1.5 : 1.0);
      }
      return sum + 0.35;
    }, 0);
  };

  return ringScore(oppQueen, player) - ringScore(ownQueen, opponent(player));
}

function queenTiming(state: HiveState, player: Player): number {
  const unplacedPenalty = (side: Player) => {
    if (queenHex(state, side)) return 0;
    return Math.max(0, countPlacedPieces(state, side) - 1);
  };

  return unplacedPenalty(opponent(player)) - unplacedPenalty(player);
}

function surroundLeverage(state: HiveState, player: Player): number {
  const ownQueen = queenHex(state, player);
  const oppQueen = queenHex(state, opponent(player));

  const leverage = (target: HexCoordinate | undefined, attacker: Player): number => {
    if (!target) return 0;
    let total = 0;
    for (const gap of surroundingHexes(target)) {
      if ((state.cells[keyOf(gap)]?.length ?? 0) > 0) continue;
      const support = surroundingHexes(gap).reduce((count, adjacent) => {
        return count + (topPieceAt(state, adjacent)?.player === attacker ? 1 : 0);
      }, 0);
      total += support;
    }
    return total;
  };

  return leverage(oppQueen, player) - leverage(ownQueen, opponent(player));
}

function beetleLock(state: HiveState, player: Player): number {
  let own = 0;
  let opp = 0;

  for (const stack of Object.values(state.cells)) {
    if (stack.length < 2) continue;
    const top = stack[stack.length - 1];
    if (!top || top.bug !== "beetle") continue;

    const locksWhiteQueen = stack.some((piece) => piece.player === "white" && piece.bug === "queen");
    const locksBlackQueen = stack.some((piece) => piece.player === "black" && piece.bug === "queen");
    const score = 3 + (stack.length - 2) * 0.5;

    if (locksWhiteQueen) {
      if (top.player === player && player === "black") own += score;
      else if (player === "white") opp += score;
    }
    if (locksBlackQueen) {
      if (top.player === player && player === "white") own += score;
      else if (player === "black") opp += score;
    }
  }

  return own - opp;
}

export class HiveHeuristicEvaluator {
  public static score(state: HiveState, perspective: Player, weights: HiveHeuristicWeights): number {
    const normalizedWeights = normalizeHiveWeights(weights);
    if (state.winner) {
      if (state.winner === perspective) return 10_000;
      if (state.winner === "draw") return 0;
      return -10_000;
    }

    const fQueenPressure = queenPressure(state, perspective);
    const fQueenLiberties = queenLiberties(state, perspective);
    const fMobility = countPlayableMoves(state, perspective) - countPlayableMoves(state, opponent(perspective));
    const fReserveDevelopment = reserveDevelopment(state, perspective);
    const fPlacementFreedom = countPlacementMoves(state, perspective) - countPlacementMoves(state, opponent(perspective));
    const fStackControl = stackControl(state, perspective);
    const fContactPressure = contactPressure(state, perspective);
    const fQueenClosurePotential = queenClosurePotential(state, perspective);
    const fBeetlePressure = beetlePressure(state, perspective);
    const fQueenRingQuality = queenRingQuality(state, perspective);
    const fQueenTiming = queenTiming(state, perspective);
    const fSurroundLeverage = surroundLeverage(state, perspective);
    const fBeetleLock = beetleLock(state, perspective);

    return (
      normalizedWeights.queenPressure * fQueenPressure +
      normalizedWeights.queenLiberties * fQueenLiberties +
      normalizedWeights.mobility * fMobility +
      normalizedWeights.reserveDevelopment * fReserveDevelopment +
      normalizedWeights.placementFreedom * fPlacementFreedom +
      normalizedWeights.stackControl * fStackControl +
      normalizedWeights.contactPressure * fContactPressure +
      normalizedWeights.queenClosurePotential * fQueenClosurePotential +
      normalizedWeights.beetlePressure * fBeetlePressure +
      normalizedWeights.queenRingQuality * fQueenRingQuality +
      normalizedWeights.queenTiming * fQueenTiming +
      normalizedWeights.surroundLeverage * fSurroundLeverage +
      normalizedWeights.beetleLock * fBeetleLock
    );
  }
}
