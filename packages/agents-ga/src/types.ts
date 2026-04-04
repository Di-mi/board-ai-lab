import type { Move, Player } from "@board-ai-lab/onitama-engine";

export interface HeuristicWeights {
  material: number;
  masterSafety: number;
  mobility: number;
  templePressure: number;
  captureThreat: number;
  centerControl: number;
  cardTempo: number;
}

export interface Genome {
  id: string;
  weights: HeuristicWeights;
  fitness: number;
}

export interface TrainingConfig {
  populationSize: number;
  generations: number;
  elitismCount: number;
  tournamentSize: number;
  crossoverRate: number;
  mutationRate: number;
  mutationScale: number;
  gamesPerGenome: number;
  searchDepth: number;
  initialWeights?: HeuristicWeights;
  previousChampionWeights?: HeuristicWeights;
  championArchiveWeights?: HeuristicWeights[];
  useRandomOpponents?: boolean;
  usePeerOpponents?: boolean;
  useChampionArchive?: boolean;
  seed: number;
}

export interface GenerationStat {
  generation: number;
  bestFitness: number;
  meanFitness: number;
  bestWeights: HeuristicWeights;
  championFitness: number;
  championWeights: HeuristicWeights;
}

export interface TrainingReplayTurn {
  turn: number;
  player: Player;
  move: Move;
  stateHashBefore: string;
  stateHashAfter: string;
}

export interface TrainingReplay {
  replayId: string;
  startedAtIso: string;
  seed: number;
  generation: number;
  genomeId: string;
  gameIndex: number;
  players: {
    red: string;
    blue: string;
  };
  winner?: Player;
  winReason?: "captured-master" | "temple-arch";
  turns: TrainingReplayTurn[];
}

export interface TrainingResult {
  bestGenome: Genome;
  history: GenerationStat[];
  recentGames: TrainingReplay[];
}
