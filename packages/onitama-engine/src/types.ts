export type Player = "red" | "blue";
export type PieceType = "master" | "student";
export type CardId =
  | "tiger"
  | "dragon"
  | "frog"
  | "rabbit"
  | "crab"
  | "elephant"
  | "goose"
  | "rooster"
  | "monkey"
  | "mantis"
  | "horse"
  | "ox"
  | "crane"
  | "boar"
  | "eel"
  | "cobra";
export type TerminalReason = "captured-master" | "temple-arch";

export interface Piece {
  player: Player;
  type: PieceType;
}

export interface Position {
  x: number;
  y: number;
}

export interface Move {
  card: CardId;
  from: Position;
  to: Position;
}

export interface CardSet {
  red: [CardId, CardId];
  blue: [CardId, CardId];
  side: CardId;
}

export interface GameState {
  board: Array<Piece | null>;
  currentPlayer: Player;
  cards: CardSet;
  turn: number;
  winner?: Player;
  winReason?: TerminalReason;
}

export interface InitialStateConfig {
  cards?: CardSet;
  startingPlayer?: Player;
  seed?: number;
}

export interface TerminalResult {
  done: boolean;
  winner?: Player;
  reason?: TerminalReason;
}

export interface AgentContext {
  seed?: number;
  timeoutMs?: number;
}

export interface Agent {
  name: string;
  selectMove(state: GameState, legalMoves: Move[], context?: AgentContext): Move;
}
