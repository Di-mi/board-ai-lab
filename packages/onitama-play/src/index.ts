import { HeuristicAgent, DEFAULT_WEIGHTS, type HeuristicWeights } from "@board-ai-lab/agents-ga";
import { RandomAgent } from "@board-ai-lab/agents-random";
import { OnitamaEngine, CARD_DEFINITIONS, type Agent, type CardId, type GameState, type Move, type Player } from "@board-ai-lab/onitama-engine";

export const onitamaEngine = new OnitamaEngine();
export const TRAINED_BOT_DEPTH = 2;
export const RED_TEMPLE = { x: 2, y: 4 } as const;
export const BLUE_TEMPLE = { x: 2, y: 0 } as const;

export interface OnitamaDifficulty {
  id: "easy" | "standard" | "hard";
  label: string;
  description: string;
}

export const PUBLIC_ONITAMA_DIFFICULTIES: readonly OnitamaDifficulty[] = [
  {
    id: "easy",
    label: "Easy",
    description: "Random bot that makes legal moves without search."
  },
  {
    id: "standard",
    label: "Standard",
    description: "Heuristic bot with default weights and shallow search."
  },
  {
    id: "hard",
    label: "Hard",
    description: "Heuristic bot with default weights and deeper search."
  }
] as const;

export type OnitamaDifficultyId = (typeof PUBLIC_ONITAMA_DIFFICULTIES)[number]["id"];

export function samePosition(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

export function makeInitialState(seed = Date.now()): GameState {
  return onitamaEngine.initialState({ seed });
}

export function cardListFor(state: GameState, player: Player): [CardId, CardId] {
  return player === "red" ? state.cards.red : state.cards.blue;
}

export function allMovesForSelection(legalMoves: Move[], from: { x: number; y: number }, card: CardId): Move[] {
  return legalMoves.filter((move) => samePosition(move.from, from) && move.card === card);
}

export function orientCard(card: CardId, perspective: Player): Array<readonly [number, number]> {
  const deltas = CARD_DEFINITIONS[card].deltas;
  if (perspective === "red") return deltas;
  return deltas.map(([dx, dy]) => [-dx, -dy] as const);
}

export function isTemple(x: number, y: number): "red" | "blue" | null {
  if (x === RED_TEMPLE.x && y === RED_TEMPLE.y) return "red";
  if (x === BLUE_TEMPLE.x && y === BLUE_TEMPLE.y) return "blue";
  return null;
}

export function createRandomOnitamaAgent(seed = Date.now(), name = "random-bot"): Agent {
  return new RandomAgent(name, seed);
}

export function createHeuristicOnitamaAgent(
  weights: HeuristicWeights = DEFAULT_WEIGHTS,
  depth = 1,
  name = "heuristic-bot"
): Agent {
  return new HeuristicAgent(weights, depth, name);
}

export function createPublicOnitamaBot(
  difficultyId: OnitamaDifficultyId,
  options?: {
    seed?: number;
    standardWeights?: HeuristicWeights;
    hardWeights?: HeuristicWeights;
  }
): Agent {
  const seed = options?.seed ?? Date.now();

  if (difficultyId === "easy") {
    return createRandomOnitamaAgent(seed, "public-easy-bot");
  }

  if (difficultyId === "standard") {
    return createHeuristicOnitamaAgent(options?.standardWeights ?? DEFAULT_WEIGHTS, 1, "public-standard-bot");
  }

  return createHeuristicOnitamaAgent(options?.hardWeights ?? DEFAULT_WEIGHTS, TRAINED_BOT_DEPTH, "public-hard-bot");
}
