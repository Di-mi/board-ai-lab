import { HiveEngine, stateHash, type AgentContext, type HiveAgent, type HiveMove, type HiveState, type Player } from "@board-ai-lab/hive-engine";
import { DEFAULT_HIVE_WEIGHTS, HiveHeuristicEvaluator } from "./evaluator.js";
import type { HiveHeuristicWeights } from "./types.js";

const engine = new HiveEngine();

export interface HiveSearchProfileSink {
  recordTiming(name: string, durationNs: bigint): void;
  increment(name: string, amount?: number): void;
}

interface TranspositionEntry {
  depth: number;
  score: number;
}

interface OrderedMoveEntry {
  move: HiveMove;
  nextState: HiveState;
  scoreHint: number;
}

interface AxialHex {
  q: number;
  r: number;
}

export class HiveHeuristicAgent implements HiveAgent {
  public readonly name: string;
  private readonly weights: HiveHeuristicWeights;
  private readonly depth: number;
  private readonly profileSink?: HiveSearchProfileSink;
  private readonly useTranspositionTable: boolean;

  public constructor(
    weights: HiveHeuristicWeights = DEFAULT_HIVE_WEIGHTS,
    depth = 1,
    name = "hive-heuristic",
    profileSink?: HiveSearchProfileSink,
    useTranspositionTable = true
  ) {
    this.weights = weights;
    this.depth = depth;
    this.name = name;
    this.profileSink = profileSink;
    this.useTranspositionTable = useTranspositionTable;
  }

  public selectMove(state: HiveState, legalMoves: HiveMove[], _context?: AgentContext): HiveMove {
    if (legalMoves.length === 0) {
      throw new Error("No legal Hive moves available.");
    }
    return this.scoreMoves(state, legalMoves)[0]?.move ?? legalMoves[0]!;
  }

  public scoreMoves(state: HiveState, legalMoves: HiveMove[]): Array<{ move: HiveMove; score: number }> {
    return this.timed("search.scoreMoves", () => {
      this.increment("search.calls");
      const perspective = state.currentPlayer;
      const table = this.useTranspositionTable ? new Map<string, TranspositionEntry>() : undefined;
      const orderedMoves = this.orderMoves(state, legalMoves, perspective, true);
      const scored = orderedMoves.map((entry) => ({
        move: entry.move,
        score: this.alphaBeta(
          entry.nextState,
          perspective,
          this.depth - 1,
          Number.NEGATIVE_INFINITY,
          Number.POSITIVE_INFINITY,
          table
        )
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored;
    });
  }

  private orderMoves(state: HiveState, legalMoves: HiveMove[], perspective: Player, maximizing: boolean): OrderedMoveEntry[] {
    return this.timed("search.orderMoves", () => {
      const ordered = [...legalMoves]
        .map((move) => ({
          move,
          nextState: engine.applyMoveUnchecked(state, move),
          scoreHint: 0
        }))
        .map((entry) => ({
          ...entry,
          scoreHint: HiveHeuristicEvaluator.score(entry.nextState, perspective, this.weights)
        }))
        .sort((a, b) => (maximizing ? b.scoreHint - a.scoreHint : a.scoreHint - b.scoreHint));

      return this.pruneAntMoveEntries(state, ordered, maximizing);
    });
  }

  private transpositionKey(state: HiveState, perspective: Player): string {
    return `${perspective}|${stateHash(state)}`;
  }

  private alphaBeta(
    state: HiveState,
    perspective: Player,
    depth: number,
    alpha: number,
    beta: number,
    table?: Map<string, TranspositionEntry>
  ): number {
    return this.timed("search.alphaBeta", () => {
      this.increment("search.nodes");
      let key: string | undefined;
      if (table) {
        key = this.transpositionKey(state, perspective);
        const cached = table.get(key);
        if (cached && cached.depth >= depth) {
          this.increment("search.cacheHits");
          return cached.score;
        }
      }

      if (depth <= 0 || state.winner) {
        this.increment("search.leaves");
        const score = HiveHeuristicEvaluator.score(state, perspective, this.weights);
        if (table && key) {
          table.set(key, { depth, score });
          this.increment("search.cacheStores");
        }
        return score;
      }

      const legal = engine.legalMoves(state);
      if (legal.length === 0) {
        this.increment("search.leaves");
        const score = HiveHeuristicEvaluator.score(state, perspective, this.weights);
        if (table && key) {
          table.set(key, { depth, score });
          this.increment("search.cacheStores");
        }
        return score;
      }

      const maximize = state.currentPlayer === perspective;
      let best = maximize ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
      let fullySearched = true;
      const orderedMoves = this.orderMoves(state, legal, perspective, maximize);

      for (const entry of orderedMoves) {
        const score = this.alphaBeta(entry.nextState, perspective, depth - 1, alpha, beta, table);
        if (maximize) {
          best = Math.max(best, score);
          alpha = Math.max(alpha, best);
        } else {
          best = Math.min(best, score);
          beta = Math.min(beta, best);
        }
        if (beta <= alpha) {
          fullySearched = false;
          this.increment("search.prunes");
          break;
        }
      }

      if (fullySearched) {
        if (table && key) {
          table.set(key, { depth, score: best });
          this.increment("search.cacheStores");
        }
      }
      return best;
    });
  }

  private timed<T>(name: string, fn: () => T): T {
    if (!this.profileSink) return fn();
    const started = process.hrtime.bigint();
    try {
      return fn();
    } finally {
      this.profileSink.recordTiming(name, process.hrtime.bigint() - started);
    }
  }

  private increment(name: string, amount = 1): void {
    this.profileSink?.increment(name, amount);
  }

  private pruneAntMoveEntries(state: HiveState, entries: OrderedMoveEntry[], maximizing: boolean): OrderedMoveEntry[] {
    const antEntries = entries.filter((entry) => this.isAntMove(state, entry.move));
    if (antEntries.length <= 3) {
      return entries;
    }

    this.increment("search.antMovePruneCandidates", antEntries.length);
    const mover = state.currentPlayer;
    const opponent = mover === "white" ? "black" : "white";
    const ownQueen = this.findQueenHex(state, mover);
    const oppQueen = this.findQueenHex(state, opponent);
    const selected = new Set<OrderedMoveEntry>();

    const pickBest = (selector: (entry: OrderedMoveEntry) => number) => {
      const candidate = antEntries.reduce<OrderedMoveEntry | null>((best, entry) => {
        if (!best) return entry;
        return selector(entry) < selector(best) ? entry : best;
      }, null);
      if (candidate) selected.add(candidate);
    };

    if (oppQueen) {
      pickBest((entry) => this.hexDistance((entry.move as Extract<HiveMove, { type: "move" }>).to, oppQueen));
    }
    if (ownQueen) {
      pickBest((entry) => this.hexDistance((entry.move as Extract<HiveMove, { type: "move" }>).to, ownQueen));
    }
    if (ownQueen && oppQueen) {
      pickBest((entry) => {
        const to = (entry.move as Extract<HiveMove, { type: "move" }>).to;
        return Math.abs(this.hexDistance(to, ownQueen) - this.hexDistance(to, oppQueen));
      });
    }

    if (selected.size < 3) {
      for (const entry of antEntries) {
        selected.add(entry);
        if (selected.size >= 3) break;
      }
    }

    const keptAntEntries = antEntries.filter((entry) => selected.has(entry));
    this.increment("search.antMovePruned", antEntries.length - keptAntEntries.length);

    return entries
      .filter((entry) => !this.isAntMove(state, entry.move) || selected.has(entry))
      .sort((a, b) => (maximizing ? b.scoreHint - a.scoreHint : a.scoreHint - b.scoreHint));
  }

  private isAntMove(state: HiveState, move: HiveMove): boolean {
    if (move.type !== "move") return false;
    const stack = state.cells[`${move.from.q},${move.from.r}`];
    const top = stack?.[stack.length - 1];
    return top?.bug === "ant";
  }

  private findQueenHex(state: HiveState, player: Player): AxialHex | undefined {
    for (const [key, stack] of Object.entries(state.cells)) {
      for (const piece of stack) {
        if (piece.player === player && piece.bug === "queen") {
          const [qRaw, rRaw] = key.split(",");
          return { q: Number(qRaw), r: Number(rRaw) };
        }
      }
    }
    return undefined;
  }

  private hexDistance(a: AxialHex, b: AxialHex): number {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }
}
