import type {
  BugType,
  HexCoordinate,
  HiveAgent,
  HiveCell,
  HiveMove,
  HivePiece,
  HiveReserve,
  HiveState,
  InitialHiveStateConfig,
  Player,
  TerminalResult,
  Winner
} from "./types.js";

export interface HiveEngineProfileSink {
  recordTiming(name: string, durationNs: bigint): void;
}

let hiveEngineProfileSink: HiveEngineProfileSink | undefined;

export function setHiveEngineProfileSink(sink?: HiveEngineProfileSink): void {
  hiveEngineProfileSink = sink;
}

function timed<T>(name: string, fn: () => T): T {
  const sink = hiveEngineProfileSink;
  if (!sink) return fn();
  const started = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    sink.recordTiming(name, process.hrtime.bigint() - started);
  }
}

const DIRECTIONS: readonly HexCoordinate[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
] as const;

const BUG_ORDER: readonly BugType[] = ["queen", "beetle", "spider", "grasshopper", "ant"] as const;

const BUG_COUNTS: HiveReserve = {
  queen: 1,
  beetle: 2,
  spider: 2,
  grasshopper: 3,
  ant: 3
};

function reserveClone(reserve: HiveReserve): HiveReserve {
  return {
    queen: reserve.queen,
    beetle: reserve.beetle,
    spider: reserve.spider,
    grasshopper: reserve.grasshopper,
    ant: reserve.ant
  };
}

function add(a: HexCoordinate, b: HexCoordinate): HexCoordinate {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function keyOf(hex: HexCoordinate): string {
  return `${hex.q},${hex.r}`;
}

export function parseKey(key: string): HexCoordinate {
  const [qValue, rValue] = key.split(",");
  const q = Number(qValue);
  const r = Number(rValue);
  return { q, r };
}

function sameHex(a: HexCoordinate, b: HexCoordinate): boolean {
  return a.q === b.q && a.r === b.r;
}

function cloneCells(cells: Record<string, HiveCell>): Record<string, HiveCell> {
  return timed("engine.cloneCells", () =>
    Object.fromEntries(Object.entries(cells).map(([key, stack]) => [key, stack.map((piece) => ({ ...piece }))]))
  );
}

function topPiece(stack: HiveCell | undefined): HivePiece | undefined {
  return stack?.[stack.length - 1];
}

function occupiedKeys(cells: Record<string, HiveCell>): string[] {
  return Object.keys(cells).filter((key) => (cells[key]?.length ?? 0) > 0);
}

function hasOccupied(cells: Record<string, HiveCell>, hex: HexCoordinate): boolean {
  return (cells[keyOf(hex)]?.length ?? 0) > 0;
}

function topOwnerAt(cells: Record<string, HiveCell>, hex: HexCoordinate): Player | undefined {
  return topPiece(cells[keyOf(hex)])?.player;
}

function neighborsOf(hex: HexCoordinate): HexCoordinate[] {
  return DIRECTIONS.map((dir) => add(hex, dir));
}

function directionIndex(from: HexCoordinate, to: HexCoordinate): number {
  return DIRECTIONS.findIndex((dir) => from.q + dir.q === to.q && from.r + dir.r === to.r);
}

function commonGateNeighbors(from: HexCoordinate, to: HexCoordinate): [HexCoordinate, HexCoordinate] | null {
  const idx = directionIndex(from, to);
  if (idx === -1) return null;
  const left = add(from, DIRECTIONS[(idx + 5) % 6]!);
  const right = add(from, DIRECTIONS[(idx + 1) % 6]!);
  return [left, right];
}

function isGateOpen(cells: Record<string, HiveCell>, from: HexCoordinate, to: HexCoordinate): boolean {
  const common = commonGateNeighbors(from, to);
  if (!common) return false;
  const [left, right] = common;
  return !(hasOccupied(cells, left) && hasOccupied(cells, right));
}

function reserveFor(player: Player): HiveReserve {
  return reserveClone(BUG_COUNTS);
}

function countPlacedPieces(state: HiveState, player: Player): number {
  let count = 0;
  for (const stack of Object.values(state.cells)) {
    for (const piece of stack) {
      if (piece.player === player) count += 1;
    }
  }
  return count;
}

function isQueenPlaced(state: HiveState, player: Player): boolean {
  return state.reserves[player].queen === 0;
}

function makePieceId(player: Player, bug: BugType, reserveBefore: HiveReserve): string {
  const total = BUG_COUNTS[bug];
  const index = total - reserveBefore[bug] + 1;
  return `${player}-${bug}-${index}`;
}

function removeTopAt(cells: Record<string, HiveCell>, hex: HexCoordinate): HivePiece | undefined {
  const key = keyOf(hex);
  const stack = cells[key];
  if (!stack || stack.length === 0) return undefined;
  const piece = stack.pop();
  if (stack.length === 0) {
    delete cells[key];
  }
  return piece;
}

function addToCell(cells: Record<string, HiveCell>, hex: HexCoordinate, piece: HivePiece): void {
  const key = keyOf(hex);
  const stack = cells[key] ?? [];
  stack.push(piece);
  cells[key] = stack;
}

function occupiedNeighborCount(cells: Record<string, HiveCell>, hex: HexCoordinate): number {
  return neighborsOf(hex).filter((neighbor) => hasOccupied(cells, neighbor)).length;
}

function isConnected(cells: Record<string, HiveCell>): boolean {
  const keys = occupiedKeys(cells);
  if (keys.length <= 1) return true;
  const seen = new Set<string>();
  const queue = [keys[0]!];
  seen.add(keys[0]!);

  while (queue.length > 0) {
    const current = parseKey(queue.shift()!);
    for (const neighbor of neighborsOf(current)) {
      const key = keyOf(neighbor);
      if (!hasOccupied(cells, neighbor) || seen.has(key)) continue;
      seen.add(key);
      queue.push(key);
    }
  }

  return seen.size === keys.length;
}

function canRemoveWithoutBreakingHive(cells: Record<string, HiveCell>, from: HexCoordinate): boolean {
  const stack = cells[keyOf(from)];
  if (!stack || stack.length === 0) return false;
  if (stack.length > 1) return true;
  const clone = cloneCells(cells);
  removeTopAt(clone, from);
  return isConnected(clone);
}

function canPlaceAt(state: HiveState, player: Player, to: HexCoordinate): boolean {
  if (hasOccupied(state.cells, to)) return false;
  const ownPlaced = countPlacedPieces(state, player);
  const other: Player = player === "white" ? "black" : "white";

  if (ownPlaced === 0) {
    if (occupiedKeys(state.cells).length === 0) {
      return sameHex(to, { q: 0, r: 0 });
    }
    return occupiedNeighborCount(state.cells, to) > 0;
  }

  const neighbors = neighborsOf(to);
  let touchesOwn = false;
  for (const neighbor of neighbors) {
    const owner = topOwnerAt(state.cells, neighbor);
    if (!owner) continue;
    if (owner === other) return false;
    if (owner === player) touchesOwn = true;
  }
  return touchesOwn;
}

function queenPlacementRequired(state: HiveState, player: Player): boolean {
  return !isQueenPlaced(state, player) && countPlacedPieces(state, player) >= 3;
}

function emptyNeighborTargets(cells: Record<string, HiveCell>): HexCoordinate[] {
  const result = new Map<string, HexCoordinate>();
  for (const key of occupiedKeys(cells)) {
    const cell = parseKey(key);
    for (const neighbor of neighborsOf(cell)) {
      if (hasOccupied(cells, neighbor)) continue;
      result.set(keyOf(neighbor), neighbor);
    }
  }
  return [...result.values()];
}

function legalPlacementMoves(state: HiveState, player: Player): HiveMove[] {
  return timed("engine.legalPlacementMoves", () => {
    const moves: HiveMove[] = [];
    const targets = occupiedKeys(state.cells).length === 0 ? [{ q: 0, r: 0 }] : emptyNeighborTargets(state.cells);
    const forcedQueen = queenPlacementRequired(state, player);
    const reserve = state.reserves[player];
    const placeableBugs = forcedQueen ? (["queen"] as const) : BUG_ORDER;

    for (const bug of placeableBugs) {
      if (reserve[bug] <= 0) continue;
      for (const to of targets) {
        if (canPlaceAt(state, player, to)) {
          moves.push({ type: "place", bug, to });
        }
      }
    }

    return moves;
  });
}

function queenLikeTargets(cells: Record<string, HiveCell>, from: HexCoordinate): HexCoordinate[] {
  const targets: HexCoordinate[] = [];
  for (const neighbor of neighborsOf(from)) {
    if (hasOccupied(cells, neighbor)) continue;
    if (occupiedNeighborCount(cells, neighbor) === 0) continue;
    if (!isGateOpen(cells, from, neighbor)) continue;
    targets.push(neighbor);
  }
  return targets;
}

function grasshopperTargets(cells: Record<string, HiveCell>, from: HexCoordinate): HexCoordinate[] {
  const targets: HexCoordinate[] = [];
  for (const dir of DIRECTIONS) {
    let cursor = add(from, dir);
    if (!hasOccupied(cells, cursor)) continue;
    while (hasOccupied(cells, cursor)) {
      cursor = add(cursor, dir);
    }
    targets.push(cursor);
  }
  return targets;
}

function spiderTargets(cells: Record<string, HiveCell>, from: HexCoordinate): HexCoordinate[] {
  return timed("engine.spiderTargets", () => {
    const targets = new Map<string, HexCoordinate>();
    const visit = (current: HexCoordinate, depth: number, seen: Set<string>) => {
      if (depth === 3) {
        targets.set(keyOf(current), current);
        return;
      }
      for (const next of queenLikeTargets(cells, current)) {
        const key = keyOf(next);
        if (seen.has(key)) continue;
        seen.add(key);
        visit(next, depth + 1, seen);
        seen.delete(key);
      }
    };

    const seen = new Set<string>([keyOf(from)]);
    visit(from, 0, seen);
    targets.delete(keyOf(from));
    return [...targets.values()];
  });
}

function antTargets(cells: Record<string, HiveCell>, from: HexCoordinate): HexCoordinate[] {
  return timed("engine.antTargets", () => {
    const result = new Map<string, HexCoordinate>();
    const queue = queenLikeTargets(cells, from);
    const originKey = keyOf(from);
    const seen = new Set<string>([originKey, ...queue.map(keyOf)]);
    for (const hex of queue) result.set(keyOf(hex), hex);

    let index = 0;
    while (index < queue.length) {
      const current = queue[index]!;
      index += 1;
      for (const next of queenLikeTargets(cells, current)) {
        const key = keyOf(next);
        if (seen.has(key)) continue;
        seen.add(key);
        result.set(key, next);
        queue.push(next);
      }
    }

    result.delete(originKey);
    return [...result.values()];
  });
}

function beetleTargets(cells: Record<string, HiveCell>, from: HexCoordinate, sourceHeight = 1): HexCoordinate[] {
  const targets: HexCoordinate[] = [];

  for (const neighbor of neighborsOf(from)) {
    const destinationOccupied = hasOccupied(cells, neighbor);
    const elevated = sourceHeight > 1 || destinationOccupied;
    if (!destinationOccupied) {
      if (!elevated) {
        if (occupiedNeighborCount(cells, neighbor) === 0) continue;
        if (!isGateOpen(cells, from, neighbor)) continue;
      }
      targets.push(neighbor);
      continue;
    }

    if (!elevated && !isGateOpen(cells, from, neighbor)) continue;
    targets.push(neighbor);
  }

  return targets;
}

function movableTargetsForBug(
  cells: Record<string, HiveCell>,
  from: HexCoordinate,
  bug: BugType,
  sourceHeight = 1
): HexCoordinate[] {
  switch (bug) {
    case "queen":
      return queenLikeTargets(cells, from);
    case "grasshopper":
      return grasshopperTargets(cells, from);
    case "spider":
      return spiderTargets(cells, from);
    case "ant":
      return antTargets(cells, from);
    case "beetle":
      return beetleTargets(cells, from, sourceHeight);
    default:
      return [];
  }
}

function legalMovementMoves(state: HiveState, player: Player): HiveMove[] {
  return timed("engine.legalMovementMoves", () => {
    if (!isQueenPlaced(state, player) || queenPlacementRequired(state, player)) {
      return [];
    }

    const moves: HiveMove[] = [];

    for (const key of occupiedKeys(state.cells)) {
      const from = parseKey(key);
      const stack = state.cells[key]!;
      const sourceHeight = stack.length;
      const top = topPiece(stack);
      if (!top || top.player !== player) continue;
      if (!canRemoveWithoutBreakingHive(state.cells, from)) continue;

      const withoutSource = cloneCells(state.cells);
      const removed = removeTopAt(withoutSource, from);
      if (!removed) continue;

      for (const to of movableTargetsForBug(withoutSource, from, removed.bug, sourceHeight)) {
        if (sameHex(from, to)) continue;
        moves.push({ type: "move", from, to });
      }
    }

    return moves;
  });
}

function moveEquals(a: HiveMove, b: HiveMove): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "pass" && b.type === "pass") return true;
  if (a.type === "place" && b.type === "place") {
    return a.bug === b.bug && sameHex(a.to, b.to);
  }
  if (a.type === "move" && b.type === "move") {
    return sameHex(a.from, b.from) && sameHex(a.to, b.to);
  }
  return false;
}

function isQueenSurrounded(cells: Record<string, HiveCell>, player: Player): boolean {
  let queenHex: HexCoordinate | null = null;
  for (const [key, stack] of Object.entries(cells)) {
    for (const piece of stack) {
      if (piece.player === player && piece.bug === "queen") {
        queenHex = parseKey(key);
        break;
      }
    }
    if (queenHex) break;
  }

  if (!queenHex) return false;
  return neighborsOf(queenHex).every((neighbor) => hasOccupied(cells, neighbor));
}

function winnerAfterMove(cells: Record<string, HiveCell>): Winner | undefined {
  const whiteSurrounded = isQueenSurrounded(cells, "white");
  const blackSurrounded = isQueenSurrounded(cells, "black");

  if (whiteSurrounded && blackSurrounded) return "draw";
  if (whiteSurrounded) return "black";
  if (blackSurrounded) return "white";
  return undefined;
}

function nextPlayer(player: Player): Player {
  return player === "white" ? "black" : "white";
}

function stateCellsSummary(state: HiveState): string {
  return occupiedKeys(state.cells)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const stack = state.cells[key]!;
      return `${key}:${stack.map((piece) => `${piece.player[0]}${piece.bug[0]}`).join("/")}`;
    })
    .join("|");
}

export function stateHash(state: HiveState): string {
  return timed("engine.stateHash", () => {
    const whiteReserve = BUG_ORDER.map((bug) => `${bug[0]}${state.reserves.white[bug]}`).join("");
    const blackReserve = BUG_ORDER.map((bug) => `${bug[0]}${state.reserves.black[bug]}`).join("");
    return [
      state.currentPlayer,
      String(state.turn),
      whiteReserve,
      blackReserve,
      state.winner ?? "none",
      state.winReason ?? "none",
      stateCellsSummary(state)
    ].join("|");
  });
}

export class HiveEngine {
  public initialState(config?: InitialHiveStateConfig): HiveState {
    return {
      cells: {},
      reserves: {
        white: reserveFor("white"),
        black: reserveFor("black")
      },
      currentPlayer: config?.startingPlayer ?? "white",
      turn: 0
    };
  }

  public legalMoves(state: HiveState): HiveMove[] {
    return timed("engine.legalMoves", () => {
      if (state.winner) return [];
      const player = state.currentPlayer;
      const placements = legalPlacementMoves(state, player);
      const movements = legalMovementMoves(state, player);
      const moves = [...placements, ...movements];
      return moves.length > 0 ? moves : [{ type: "pass" }];
    });
  }

  public applyMove(state: HiveState, move: HiveMove): HiveState {
    const legal = this.legalMoves(state);
    if (!legal.some((candidate) => moveEquals(candidate, move))) {
      throw new Error(`Illegal Hive move: ${JSON.stringify(move)}`);
    }

    return this.applyMoveUnchecked(state, move);
  }

  public applyMoveUnchecked(state: HiveState, move: HiveMove): HiveState {
    return timed("engine.applyMoveUnchecked", () => {
      if (state.winner) {
        throw new Error("Cannot apply a move to a finished Hive game.");
      }

      const cells = cloneCells(state.cells);
      const reserves = {
        white: reserveClone(state.reserves.white),
        black: reserveClone(state.reserves.black)
      };

      if (move.type === "place") {
        const reserve = reserves[state.currentPlayer];
        if (reserve[move.bug] <= 0) {
          throw new Error(`No ${move.bug} remaining in reserve.`);
        }
        const piece: HivePiece = {
          id: makePieceId(state.currentPlayer, move.bug, reserve),
          player: state.currentPlayer,
          bug: move.bug
        };
        reserve[move.bug] -= 1;
        addToCell(cells, move.to, piece);
      } else if (move.type === "move") {
        if (sameHex(move.from, move.to)) {
          throw new Error("Relocation move must change hex.");
        }
        const piece = removeTopAt(cells, move.from);
        if (!piece) {
          throw new Error("No top piece at source hex.");
        }
        addToCell(cells, move.to, piece);
      }

      const winner = winnerAfterMove(cells);

      return {
        cells,
        reserves,
        currentPlayer: nextPlayer(state.currentPlayer),
        turn: state.turn + 1,
        winner,
        winReason: winner ? "surrounded-queen" : undefined
      };
    });
  }

  public isTerminal(state: HiveState): TerminalResult {
    return {
      done: Boolean(state.winner),
      winner: state.winner,
      reason: state.winReason
    };
  }
}

export const HIVE_DIRECTIONS = DIRECTIONS;
export const HIVE_BUG_ORDER = BUG_ORDER;

export function topPieceAt(state: HiveState, hex: HexCoordinate): HivePiece | undefined {
  return topPiece(state.cells[keyOf(hex)]);
}

export function stackAt(state: HiveState, hex: HexCoordinate): HiveCell {
  return [...(state.cells[keyOf(hex)] ?? [])];
}

export function surroundingHexes(hex: HexCoordinate): HexCoordinate[] {
  return neighborsOf(hex);
}

export function chooseRandomMove(agent: HiveAgent, state: HiveState, legalMoves: HiveMove[]): HiveMove {
  return agent.selectMove(state, legalMoves);
}
