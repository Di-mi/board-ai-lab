import { OnitamaEngine, type GameState, type Move, type Piece, type Player } from "@board-ai-lab/onitama-engine";
import type { HeuristicWeights } from "./types.js";

export const DEFAULT_WEIGHTS: HeuristicWeights = {
  material: 1.0,
  masterSafety: 1.2,
  mobility: 0.8,
  templePressure: 0.6,
  captureThreat: 1.0,
  centerControl: 0.5,
  cardTempo: 0.4
};

const engine = new OnitamaEngine();

function opponent(player: Player): Player {
  return player === "red" ? "blue" : "red";
}

function piecesOf(state: GameState, player: Player): Piece[] {
  return state.board.filter((piece): piece is Piece => Boolean(piece && piece.player === player));
}

function studentsOf(state: GameState, player: Player): number {
  return piecesOf(state, player).filter((piece) => piece.type === "student").length;
}

function masterPos(state: GameState, player: Player): { x: number; y: number } | undefined {
  const idx = state.board.findIndex((piece) => piece?.player === player && piece?.type === "master");
  if (idx === -1) {
    return undefined;
  }
  return { x: idx % 5, y: Math.floor(idx / 5) };
}

function legalMovesFor(state: GameState, player: Player): Move[] {
  const switched = { ...state, currentPlayer: player };
  return engine.legalMoves(switched);
}

function capturingMoves(state: GameState, player: Player): number {
  const opp = opponent(player);
  const legal = legalMovesFor(state, player);
  let count = 0;
  for (const move of legal) {
    const target = state.board[move.to.y * 5 + move.to.x];
    if (target?.player === opp) {
      count += 1;
    }
  }
  return count;
}

function centerControl(state: GameState, player: Player): number {
  let own = 0;
  let opp = 0;
  const oppPlayer = opponent(player);
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 3; x += 1) {
      const piece = state.board[y * 5 + x];
      if (piece?.player === player) own += 1;
      if (piece?.player === oppPlayer) opp += 1;
    }
  }
  return own - opp;
}

function templeDistance(state: GameState, player: Player): number {
  const mPos = masterPos(state, player);
  if (!mPos) {
    return 10;
  }
  const temple = player === "red" ? { x: 2, y: 0 } : { x: 2, y: 4 };
  return Math.abs(mPos.x - temple.x) + Math.abs(mPos.y - temple.y);
}

function masterThreatCount(state: GameState, player: Player): number {
  const mPos = masterPos(state, player);
  if (!mPos) {
    return 10;
  }
  const opp = opponent(player);
  const oppLegal = legalMovesFor(state, opp);
  return oppLegal.filter((move) => move.to.x === mPos.x && move.to.y === mPos.y).length;
}

function cardTempo(state: GameState, player: Player): number {
  const ownMoves = legalMovesFor(state, player).length;
  const oppMoves = legalMovesFor(state, opponent(player)).length;
  return ownMoves - oppMoves;
}

export class HeuristicEvaluator {
  public static score(state: GameState, perspective: Player, weights: HeuristicWeights): number {
    const opp = opponent(perspective);

    if (state.winner) {
      if (state.winner === perspective) return 1000;
      return -1000;
    }

    const fMaterial = studentsOf(state, perspective) - studentsOf(state, opp);
    const fMasterSafety = -masterThreatCount(state, perspective) + masterThreatCount(state, opp);
    const fMobility = legalMovesFor(state, perspective).length - legalMovesFor(state, opp).length;
    const fTemplePressure = templeDistance(state, opp) - templeDistance(state, perspective);
    const fCaptureThreat = capturingMoves(state, perspective) - capturingMoves(state, opp);
    const fCenterControl = centerControl(state, perspective);
    const fCardTempo = cardTempo(state, perspective);

    return (
      weights.material * fMaterial +
      weights.masterSafety * fMasterSafety +
      weights.mobility * fMobility +
      weights.templePressure * fTemplePressure +
      weights.captureThreat * fCaptureThreat +
      weights.centerControl * fCenterControl +
      weights.cardTempo * fCardTempo
    );
  }
}
