import { CARD_DEFINITIONS, type CardId, type GameState, type Move, type Player } from "@board-ai-lab/onitama-engine";

const CELL_LABELS: Record<string, string> = {
  "red-master": "RM",
  "red-student": "RS",
  "blue-master": "BM",
  "blue-student": "BS"
};

function pieceLabel(piece: GameState["board"][number]): string {
  if (!piece) return "..";
  return CELL_LABELS[`${piece.player}-${piece.type}`] ?? "??";
}

function orientCard(card: CardId, perspective: Player): Array<readonly [number, number]> {
  const deltas = CARD_DEFINITIONS[card].deltas;
  if (perspective === "red") return deltas;
  return deltas.map(([dx, dy]) => [-dx, -dy] as const);
}

export function renderBoardTable(state: GameState): string {
  const rows: string[] = [];
  rows.push("     x=0  x=1  x=2  x=3  x=4");
  for (let y = 0; y < 5; y += 1) {
    const cells: string[] = [];
    for (let x = 0; x < 5; x += 1) {
      cells.push(pieceLabel(state.board[y * 5 + x] ?? null));
    }
    rows.push(`y=${y}  ${cells.join("   ")}`);
  }
  return rows.join("\n");
}

export function renderCardGuide(state: GameState, player: Player): string {
  const ownCards = player === "red" ? state.cards.red : state.cards.blue;
  const oppCards = player === "red" ? state.cards.blue : state.cards.red;
  const describe = (card: CardId) => {
    const deltas = orientCard(card, player)
      .map(([dx, dy]) => `(${dx >= 0 ? "+" : ""}${dx}, ${dy >= 0 ? "+" : ""}${dy})`)
      .join(", ");
    return `${CARD_DEFINITIONS[card].name} [${card}] => ${deltas}`;
  };

  return [
    `You are ${player}.`,
    `Your cards: ${ownCards.map(describe).join(" | ")}`,
    `Opponent cards: ${oppCards.map(describe).join(" | ")}`,
    `Side card: ${describe(state.cards.side)}`
  ].join("\n");
}

export function renderLegalMoveList(legalMoves: Move[]): string {
  return legalMoves
    .map(
      (move, index) =>
        `m${index + 1}: ${move.card} from (${move.from.x}, ${move.from.y}) to (${move.to.x}, ${move.to.y})`
    )
    .join("\n");
}

export const ONITAMA_LLM_SKILL_TEXT = `You are playing Onitama.

Rules summary:
- Board size: 5x5.
- Each side has 1 master and 4 students.
- Red starts at y=4 and wants to reach the blue temple at (2, 0).
- Blue starts at y=0 and wants to reach the red temple at (2, 4).
- You win by either capturing the opponent master or moving your master onto the opponent temple.
- On each turn you choose one of your two cards and make one legal move with one of your pieces.
- After using a card, that card becomes the side card and you take the previous side card into your hand.
- You may capture by landing on an enemy piece.
- You may not land on your own piece.

Board format:
- Coordinates are (x, y).
- x increases left to right.
- y increases top to bottom.
- Cell codes: RM = red master, RS = red student, BM = blue master, BS = blue student, .. = empty.

Move protocol:
- You will receive a numbered legal move list.
- You must answer with JSON only.
- Valid response format: {"command":"play","moveId":"m7"}
- Do not explain your choice.
- Do not include markdown fences.
- Do not invent a move that is not in the legal move list.`;

export function buildOnitamaPrompt(state: GameState, legalMoves: Move[]): { system: string; user: string } {
  const player = state.currentPlayer;
  return {
    system: ONITAMA_LLM_SKILL_TEXT,
    user: [
      `Turn ${state.turn}. Current player: ${player}.`,
      renderCardGuide(state, player),
      "Board:",
      renderBoardTable(state),
      "Legal moves:",
      renderLegalMoveList(legalMoves),
      'Respond with JSON only in the format {"command":"play","moveId":"mN"}.'
    ].join("\n\n")
  };
}
