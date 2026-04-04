import type { BugType, HiveMove, Player, TerminalReason } from "@board-ai-lab/hive-engine";

export interface HiveHeuristicWeights {
  queenPressure: number;
  queenLiberties: number;
  mobility: number;
  reserveDevelopment: number;
  placementFreedom: number;
  stackControl: number;
  contactPressure: number;
  queenClosurePotential: number;
  beetlePressure: number;
  queenRingQuality: number;
  queenTiming: number;
  surroundLeverage: number;
  beetleLock: number;
}

export interface HiveGenome {
  id: string;
  weights: HiveHeuristicWeights;
  fitness: number;
  whiteFitness?: number;
  blackFitness?: number;
  whiteDrawRate?: number;
  blackDrawRate?: number;
}

export interface HiveTrainingConfig {
  populationSize: number;
  generations: number;
  elitismCount: number;
  tournamentSize: number;
  crossoverRate: number;
  mutationRate: number;
  mutationScale: number;
  gamesPerGenome: number;
  searchDepth: number;
  useTranspositionTable?: boolean;
  maxTurnsPerGame: number;
  initialWeights?: HiveHeuristicWeights;
  previousChampionWeights?: HiveHeuristicWeights;
  championArchiveWeights?: HiveHeuristicWeights[];
  useRandomOpponents?: boolean;
  usePeerOpponents?: boolean;
  useChampionArchive?: boolean;
  parallelWorkers?: number;
  seed: number;
}

export interface HiveGenerationStat {
  generation: number;
  bestFitness: number;
  meanFitness: number;
  bestWhiteFitness: number;
  bestBlackFitness: number;
  bestWhiteDrawRate: number;
  bestBlackDrawRate: number;
  meanWhiteFitness: number;
  meanBlackFitness: number;
  meanWhiteDrawRate: number;
  meanBlackDrawRate: number;
  bestWeights: HiveHeuristicWeights;
  championFitness: number;
  championWhiteFitness: number;
  championBlackFitness: number;
  championWhiteDrawRate: number;
  championBlackDrawRate: number;
  championWeights: HiveHeuristicWeights;
}

export interface HiveTrainingReplayTurn {
  turn: number;
  player: Player;
  move: HiveMove;
  stateHashBefore: string;
  stateHashAfter: string;
}

export interface HiveTrainingReplay {
  replayId: string;
  startedAtIso: string;
  seed: number;
  generation: number;
  genomeId: string;
  gameIndex: number;
  players: {
    white: string;
    black: string;
  };
  winner?: Player | "draw";
  winReason?: TerminalReason | "turn-limit-draw";
  finalEvaluationWhite?: number;
  finalEvaluationBlack?: number;
  turns: HiveTrainingReplayTurn[];
}

export interface HiveTrainingResult {
  bestGenome: HiveGenome;
  history: HiveGenerationStat[];
  recentGames: HiveTrainingReplay[];
}

export interface HiveTrainingProgressGameInfo {
  generation: number;
  genomeId: string;
  gameIndex: number;
  seed: number;
  players: {
    white: string;
    black: string;
  };
}

export type HiveTrainingProgressEvent =
  | {
      kind: "generation-complete";
      generation: number;
      population: HiveGenome[];
    }
  | {
      kind: "worker-start";
      generation: number;
      genomeId: string;
      workerPid: number;
      workerCommand: string;
    }
  | {
      kind: "worker-exit";
      generation: number;
      genomeId: string;
      workerPid: number;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      hadResult: boolean;
    }
  | {
      kind: "worker-error";
      generation: number;
      genomeId: string;
      workerPid?: number;
      error: string;
      stderr?: string;
      rawLine?: string;
    }
  | ({
      kind: "game-start";
    } & HiveTrainingProgressGameInfo)
  | ({
      kind: "turn";
      turn: number;
      player: Player;
      move: HiveMove;
      moveDurationMs: number;
      averageMoveDurationMs: number;
      winner?: Player | "draw";
      winReason?: TerminalReason | "turn-limit-draw";
    } & HiveTrainingProgressGameInfo)
  | ({
      kind: "game-end";
      totalTurns: number;
      averageMoveDurationMs: number;
      winner?: Player | "draw";
      winReason?: TerminalReason | "turn-limit-draw";
    } & HiveTrainingProgressGameInfo);

export type HiveBugCountMap = Record<BugType, number>;

export interface HiveGenomeEvaluationTask {
  weights: HiveHeuristicWeights;
  config: HiveTrainingConfig;
  seedOffset: number;
  generation: number;
  genomeId: string;
  peerPool: HiveGenome[];
}

export interface HiveGenomeEvaluationResult {
  fitness: number;
  whiteFitness: number;
  blackFitness: number;
  whiteDrawRate: number;
  blackDrawRate: number;
  recentGames: HiveTrainingReplay[];
}
