import { HiveEngine, HIVE_BUG_ORDER, type BugType, type HexCoordinate, type HiveAgent, type HiveMove, type HiveState } from "@board-ai-lab/hive-engine";

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export class RandomHiveAgent implements HiveAgent {
  public readonly name: string;
  private readonly random: () => number;

  public constructor(name = "random-hive-bot", seed = Date.now()) {
    this.name = name;
    this.random = mulberry32(seed);
  }

  public selectMove(_state: HiveState, legalMoves: HiveMove[]): HiveMove {
    if (legalMoves.length === 0) {
      throw new Error("No legal Hive moves available.");
    }
    const idx = Math.floor(this.random() * legalMoves.length);
    return legalMoves[idx] ?? legalMoves[0]!;
  }
}

export const hiveEngine = new HiveEngine();
export const HIVE_BASE_BUGS: readonly BugType[] = HIVE_BUG_ORDER;

export function makeInitialHiveState(seed = Date.now()): HiveState {
  return hiveEngine.initialState({ seed });
}

export function createRandomHiveAgent(seed = Date.now(), name = "random-hive-bot"): HiveAgent {
  return new RandomHiveAgent(name, seed);
}

export function sameHex(a: HexCoordinate, b: HexCoordinate): boolean {
  return a.q === b.q && a.r === b.r;
}
