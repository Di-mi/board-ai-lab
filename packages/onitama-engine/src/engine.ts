import { BASE_GAME_CARD_IDS, CARD_DEFINITIONS, FIXED_CARD_SET, orientedDeltas } from "./cards.js";
import type {
  CardId,
  CardSet,
  GameState,
  InitialStateConfig,
  Move,
  Piece,
  Player,
  Position,
  TerminalResult
} from "./types.js";

const BOARD_SIZE = 5;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;

const RED_TEMPLE: Position = { x: 2, y: 4 };
const BLUE_TEMPLE: Position = { x: 2, y: 0 };

function toIndex(pos: Position): number {
  return pos.y * BOARD_SIZE + pos.x;
}

function inBounds(pos: Position): boolean {
  return pos.x >= 0 && pos.x < BOARD_SIZE && pos.y >= 0 && pos.y < BOARD_SIZE;
}

function cloneBoard(board: Array<Piece | null>): Array<Piece | null> {
  return board.map((piece) => (piece ? { ...piece } : null));
}

function isSamePos(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

function serializePiece(piece: Piece | null): string {
  if (!piece) {
    return "..";
  }
  const p = piece.player === "red" ? "r" : "b";
  const t = piece.type === "master" ? "M" : "S";
  return `${p}${t}`;
}

export function stateHash(state: GameState): string {
  const boardStr = state.board.map(serializePiece).join("");
  const cards = `${state.cards.red.join(",")}|${state.cards.blue.join(",")}|${state.cards.side}`;
  return `${state.currentPlayer}|${state.turn}|${cards}|${boardStr}|${state.winner ?? "none"}|${state.winReason ?? "none"}`;
}

function defaultCardSet(): CardSet {
  const [redA, redB, blueA, blueB, side] = FIXED_CARD_SET;
  return {
    red: [redA, redB],
    blue: [blueA, blueB],
    side
  };
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function drawCardSet(seed: number): CardSet {
  const random = mulberry32(seed);
  const deck = [...BASE_GAME_CARD_IDS];

  for (let idx = deck.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(random() * (idx + 1));
    const tmp = deck[idx]!;
    deck[idx] = deck[swapIdx]!;
    deck[swapIdx] = tmp;
  }

  const [redA, redB, blueA, blueB, side] = deck.slice(0, 5) as [CardId, CardId, CardId, CardId, CardId];
  return {
    red: [redA, redB],
    blue: [blueA, blueB],
    side
  };
}

function defaultStartingPlayer(cardSet: CardSet): Player {
  return CARD_DEFINITIONS[cardSet.side].stamp;
}

function initialBoard(): Array<Piece | null> {
  const board = Array<Piece | null>(BOARD_CELLS).fill(null);
  const blueBackRank: Piece[] = [
    { player: "blue", type: "student" },
    { player: "blue", type: "student" },
    { player: "blue", type: "master" },
    { player: "blue", type: "student" },
    { player: "blue", type: "student" }
  ];
  const redBackRank: Piece[] = [
    { player: "red", type: "student" },
    { player: "red", type: "student" },
    { player: "red", type: "master" },
    { player: "red", type: "student" },
    { player: "red", type: "student" }
  ];

  for (let x = 0; x < BOARD_SIZE; x += 1) {
    board[toIndex({ x, y: 0 })] = blueBackRank[x] ?? null;
    board[toIndex({ x, y: 4 })] = redBackRank[x] ?? null;
  }

  return board;
}

function playerCards(state: GameState, player: Player): [CardId, CardId] {
  return player === "red" ? state.cards.red : state.cards.blue;
}

function findPiece(state: GameState, pos: Position): Piece | null {
  if (!inBounds(pos)) {
    return null;
  }
  return state.board[toIndex(pos)] ?? null;
}

function getTemple(player: Player): Position {
  return player === "red" ? BLUE_TEMPLE : RED_TEMPLE;
}

export class OnitamaEngine {
  public initialState(config?: InitialStateConfig): GameState {
    const cards = config?.cards ?? (typeof config?.seed === "number" ? drawCardSet(config.seed) : defaultCardSet());
    const startingPlayer = config?.startingPlayer ?? defaultStartingPlayer(cards);

    return {
      board: initialBoard(),
      currentPlayer: startingPlayer,
      cards,
      turn: 0
    };
  }

  public legalMoves(state: GameState): Move[] {
    if (state.winner) {
      return [];
    }

    const moves: Move[] = [];
    const cards = playerCards(state, state.currentPlayer);

    for (let idx = 0; idx < state.board.length; idx += 1) {
      const piece = state.board[idx];
      if (!piece || piece.player !== state.currentPlayer) {
        continue;
      }

      const from: Position = {
        x: idx % BOARD_SIZE,
        y: Math.floor(idx / BOARD_SIZE)
      };

      for (const card of cards) {
        for (const [dx, dy] of orientedDeltas(card, state.currentPlayer)) {
          const to: Position = { x: from.x + dx, y: from.y + dy };
          if (!inBounds(to)) {
            continue;
          }

          const occupying = findPiece(state, to);
          if (occupying && occupying.player === state.currentPlayer) {
            continue;
          }

          moves.push({ card, from, to });
        }
      }
    }

    return moves;
  }

  public isTerminal(state: GameState): TerminalResult {
    return {
      done: Boolean(state.winner),
      winner: state.winner,
      reason: state.winReason
    };
  }

  public applyMove(state: GameState, move: Move): GameState {
    const legal = this.legalMoves(state);
    const isLegal = legal.some(
      (candidate) =>
        candidate.card === move.card &&
        isSamePos(candidate.from, move.from) &&
        isSamePos(candidate.to, move.to)
    );

    if (!isLegal) {
      throw new Error(`Illegal move: ${JSON.stringify(move)}`);
    }

    const board = cloneBoard(state.board);
    const fromIndex = toIndex(move.from);
    const toIndexTarget = toIndex(move.to);
    const movingPiece = board[fromIndex];

    if (!movingPiece) {
      throw new Error("Source square does not contain a piece.");
    }

    const targetPiece = board[toIndexTarget];

    board[fromIndex] = null;
    board[toIndexTarget] = movingPiece;

    const winnerByCapture = targetPiece?.type === "master" ? movingPiece.player : undefined;
    const temple = getTemple(movingPiece.player);
    const winnerByTemple = movingPiece.type === "master" && isSamePos(move.to, temple) ? movingPiece.player : undefined;
    const winner = winnerByCapture ?? winnerByTemple;

    const redCards: [CardId, CardId] = [...state.cards.red] as [CardId, CardId];
    const blueCards: [CardId, CardId] = [...state.cards.blue] as [CardId, CardId];
    const currentCards = state.currentPlayer === "red" ? redCards : blueCards;
    const usedCardIndex = currentCards.findIndex((card) => card === move.card);

    if (usedCardIndex === -1) {
      throw new Error(`Current player does not own card ${move.card}.`);
    }

    const sideCard = state.cards.side;
    currentCards[usedCardIndex] = sideCard;

    const nextState: GameState = {
      board,
      currentPlayer: state.currentPlayer === "red" ? "blue" : "red",
      cards: {
        red: redCards,
        blue: blueCards,
        side: move.card
      },
      turn: state.turn + 1,
      winner,
      winReason: winner ? (winnerByCapture ? "captured-master" : "temple-arch") : undefined
    };

    return nextState;
  }
}
