import type { Agent, AgentContext, GameState, Move } from "@board-ai-lab/onitama-engine";

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export class RandomAgent implements Agent {
  public readonly name: string;
  private readonly random: () => number;

  public constructor(name = "random", seed = Date.now()) {
    this.name = name;
    this.random = mulberry32(seed);
  }

  public selectMove(_state: GameState, legalMoves: Move[], _context?: AgentContext): Move {
    if (legalMoves.length === 0) {
      throw new Error("No legal moves available.");
    }
    const idx = Math.floor(this.random() * legalMoves.length);
    return legalMoves[idx] ?? legalMoves[0]!;
  }
}
