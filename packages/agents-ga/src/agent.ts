import { OnitamaEngine, type Agent, type AgentContext, type GameState, type Move, type Player } from "@board-ai-lab/onitama-engine";
import { DEFAULT_WEIGHTS, HeuristicEvaluator } from "./evaluator.js";
import type { HeuristicWeights } from "./types.js";

const engine = new OnitamaEngine();

function opponent(player: Player): Player {
  return player === "red" ? "blue" : "red";
}

export class HeuristicAgent implements Agent {
  public readonly name: string;
  private readonly weights: HeuristicWeights;
  private readonly depth: number;

  public constructor(weights: HeuristicWeights = DEFAULT_WEIGHTS, depth = 1, name = "heuristic") {
    this.weights = weights;
    this.depth = depth;
    this.name = name;
  }

  public selectMove(state: GameState, legalMoves: Move[], _context?: AgentContext): Move {
    if (legalMoves.length === 0) {
      throw new Error("No legal moves available.");
    }

    return this.scoreMoves(state, legalMoves)[0]?.move ?? legalMoves[0]!;
  }

  public scoreMoves(state: GameState, legalMoves: Move[]): Array<{ move: Move; score: number }> {
    const perspective = state.currentPlayer;
    const scoredMoves = legalMoves.map((move) => {
      const next = engine.applyMove(state, move);
      return {
        move,
        score: this.minimax(next, perspective, this.depth - 1)
      };
    });

    scoredMoves.sort((a, b) => b.score - a.score);
    return scoredMoves;
  }

  private minimax(state: GameState, perspective: Player, depth: number): number {
    if (depth <= 0 || state.winner) {
      return HeuristicEvaluator.score(state, perspective, this.weights);
    }

    const legal = engine.legalMoves(state);
    if (legal.length === 0) {
      const losingState: GameState = {
        ...state,
        winner: opponent(state.currentPlayer),
        winReason: "captured-master"
      };
      return HeuristicEvaluator.score(losingState, perspective, this.weights);
    }

    const maximize = state.currentPlayer === perspective;
    let best = maximize ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

    for (const move of legal) {
      const next = engine.applyMove(state, move);
      const score = this.minimax(next, perspective, depth - 1);
      if (maximize) {
        best = Math.max(best, score);
      } else {
        best = Math.min(best, score);
      }
    }

    return best;
  }
}
