import type { BugType, HexCoordinate, HiveMove, HiveState, Player } from "@board-ai-lab/hive-engine";

function playerPrefix(player: Player): string {
  return player === "white" ? "W" : "B";
}

function bugCode(bug: BugType): string {
  switch (bug) {
    case "queen":
      return "Q";
    case "beetle":
      return "B";
    case "spider":
      return "S";
    case "grasshopper":
      return "G";
    case "ant":
      return "A";
  }
}

function hexLabel(hex: HexCoordinate): string {
  return `(${hex.q}, ${hex.r})`;
}

function reserveLine(state: HiveState, player: Player): string {
  const reserve = state.reserves[player];
  return `${player}: queen=${reserve.queen} beetle=${reserve.beetle} spider=${reserve.spider} grasshopper=${reserve.grasshopper} ant=${reserve.ant}`;
}

function stackLabel(state: HiveState, key: string): string {
  const stack = state.cells[key] ?? [];
  const pieces = stack.map((piece) => `${playerPrefix(piece.player)}${bugCode(piece.bug)}`).join(">");
  return `${key}: [${pieces}] h=${stack.length}`;
}

function moveLabel(move: HiveMove): string {
  if (move.type === "place") {
    return `place ${move.bug} to ${hexLabel(move.to)}`;
  }
  if (move.type === "move") {
    return `move from ${hexLabel(move.from)} to ${hexLabel(move.to)}`;
  }
  return "pass";
}

export function renderHiveBoardSummary(state: HiveState): string {
  const occupied = Object.keys(state.cells)
    .filter((key) => (state.cells[key]?.length ?? 0) > 0)
    .sort((a, b) => {
      const [aq = 0, ar = 0] = a.split(",").map(Number);
      const [bq = 0, br = 0] = b.split(",").map(Number);
      if (aq !== bq) return aq - bq;
      return ar - br;
    });

  if (occupied.length === 0) {
    return "No pieces on board.";
  }

  return occupied.map((key) => stackLabel(state, key)).join("\n");
}

export function renderHiveReserveGuide(state: HiveState): string {
  return [reserveLine(state, "white"), reserveLine(state, "black")].join("\n");
}

export function renderHiveLegalMoveList(legalMoves: HiveMove[]): string {
  return legalMoves.map((move, index) => `m${index + 1}: ${moveLabel(move)}`).join("\n");
}

export const HIVE_LLM_SKILL_TEXT = `You are playing base Hive.

Rules summary:
- Players are White and Black.
- Win by surrounding the opposing queen on all 6 neighboring hexes.
- If both queens become surrounded on the same move, the game is a draw.
- You must place your queen by your fourth turn.
- Before your queen is placed, you may not move your existing pieces.
- The hive must always remain one connected group.
- Beetles can climb onto occupied stacks.
- Grasshoppers jump in a straight line over one or more occupied hexes to the first empty hex.
- Ants can slide to many reachable hexes around the hive.
- Spiders move exactly three sliding steps.
- If a pass move appears in the legal move list, it is legal.

Board format:
- Hex coordinates are axial (q, r).
- Each occupied coordinate is listed with its full stack from bottom to top.
- Piece codes use W/B for player and Q/B/S/G/A for bug type.

Move protocol:
- You will receive a numbered legal move list.
- You must answer with JSON only.
- Valid response format: {"command":"play","moveId":"m7"}
- Do not explain your choice.
- Do not include markdown fences.
- Do not invent a move that is not in the legal move list.`;

export function buildHivePrompt(state: HiveState, legalMoves: HiveMove[]): { system: string; user: string } {
  return {
    system: HIVE_LLM_SKILL_TEXT,
    user: [
      `Turn ${state.turn}. Current player: ${state.currentPlayer}.`,
      "Reserves:",
      renderHiveReserveGuide(state),
      "Board stacks:",
      renderHiveBoardSummary(state),
      "Legal moves:",
      renderHiveLegalMoveList(legalMoves),
      'Respond with JSON only in the format {"command":"play","moveId":"mN"}.'
    ].join("\n\n")
  };
}
