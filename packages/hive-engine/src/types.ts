export type Player = "white" | "black";
export type Winner = Player | "draw";
export type BugType = "queen" | "beetle" | "spider" | "grasshopper" | "ant";
export type TerminalReason = "surrounded-queen" | "no-moves";

export interface HexCoordinate {
  q: number;
  r: number;
}

export interface HivePiece {
  id: string;
  player: Player;
  bug: BugType;
}

export type HiveCell = HivePiece[];

export interface HiveReserve {
  queen: number;
  beetle: number;
  spider: number;
  grasshopper: number;
  ant: number;
}

export interface HiveState {
  cells: Record<string, HiveCell>;
  reserves: Record<Player, HiveReserve>;
  currentPlayer: Player;
  turn: number;
  winner?: Winner;
  winReason?: TerminalReason;
}

export interface PlacementMove {
  type: "place";
  bug: BugType;
  to: HexCoordinate;
}

export interface RelocationMove {
  type: "move";
  from: HexCoordinate;
  to: HexCoordinate;
}

export interface PassMove {
  type: "pass";
}

export type HiveMove = PlacementMove | RelocationMove | PassMove;

export interface AgentContext {
  seed?: number;
  timeoutMs?: number;
}

export interface HiveAgent {
  name: string;
  selectMove(state: HiveState, legalMoves: HiveMove[], context?: AgentContext): HiveMove;
}

export interface InitialHiveStateConfig {
  seed?: number;
  startingPlayer?: Player;
}

export interface TerminalResult {
  done: boolean;
  winner?: Winner;
  reason?: TerminalReason;
}
