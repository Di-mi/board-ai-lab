import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { HiveEngine, stateHash, type HiveAgent, type HiveMove, type Player } from "@board-ai-lab/hive-engine";
import { RandomHiveAgent } from "@board-ai-lab/hive-play";
import { HiveHeuristicAgent } from "./agent.js";
import { DEFAULT_HIVE_WEIGHTS, HiveHeuristicEvaluator, normalizeHiveWeights } from "./evaluator.js";
import type {
  HiveGenerationStat,
  HiveGenomeEvaluationResult,
  HiveGenomeEvaluationTask,
  HiveGenome,
  HiveHeuristicWeights,
  HiveTrainingConfig,
  HiveTrainingProgressEvent,
  HiveTrainingReplay,
  HiveTrainingReplayTurn,
  HiveTrainingResult
} from "./types.js";

class SeededRandom {
  private seed: number;

  public constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  public next(): number {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  public int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.next() * Math.max(1, maxExclusive - min));
  }
}

const engine = new HiveEngine();
const WIN_SPEED_BONUS = 0.25;
const DRAW_BASE_SCORE = 0.2;
const DRAW_EVAL_WEIGHT = 0.15;
const DRAW_SPEED_WEIGHT = 0.05;
const DRAW_EVAL_SCALE = 18;
const MIN_PROMOTION_SIDE_FITNESS = 0.45;
const MAX_PROMOTION_SIDE_DRAW_RATE = 0.75;
const PROMOTION_SIDE_TOLERANCE = 0.03;

const DEFAULT_CONFIG: HiveTrainingConfig = {
  populationSize: 32,
  generations: 18,
  elitismCount: 4,
  tournamentSize: 4,
  crossoverRate: 0.7,
  mutationRate: 0.2,
  mutationScale: 0.35,
  gamesPerGenome: 6,
  searchDepth: 1,
  useTranspositionTable: false,
  maxTurnsPerGame: 100,
  useRandomOpponents: true,
  usePeerOpponents: true,
  useChampionArchive: true,
  parallelWorkers: 1,
  seed: 42
};

function createRandomWeights(rng: SeededRandom): HiveHeuristicWeights {
  const randWeight = () => rng.next() * 6 - 3;
  return {
    queenPressure: randWeight(),
    queenLiberties: randWeight(),
    mobility: randWeight(),
    reserveDevelopment: randWeight(),
    placementFreedom: randWeight(),
    stackControl: randWeight(),
    contactPressure: randWeight(),
    queenClosurePotential: randWeight(),
    beetlePressure: randWeight(),
    queenRingQuality: randWeight(),
    queenTiming: randWeight(),
    surroundLeverage: randWeight(),
    beetleLock: randWeight()
  };
}

function jitterWeights(base: HiveHeuristicWeights, rng: SeededRandom, scale: number): HiveHeuristicWeights {
  const jitter = (value: number) => Math.max(-5, Math.min(5, value + (rng.next() * 2 - 1) * scale));
  return {
    queenPressure: jitter(base.queenPressure),
    queenLiberties: jitter(base.queenLiberties),
    mobility: jitter(base.mobility),
    reserveDevelopment: jitter(base.reserveDevelopment),
    placementFreedom: jitter(base.placementFreedom),
    stackControl: jitter(base.stackControl),
    contactPressure: jitter(base.contactPressure),
    queenClosurePotential: jitter(base.queenClosurePotential),
    beetlePressure: jitter(base.beetlePressure),
    queenRingQuality: jitter(base.queenRingQuality),
    queenTiming: jitter(base.queenTiming),
    surroundLeverage: jitter(base.surroundLeverage),
    beetleLock: jitter(base.beetleLock)
  };
}

function cloneGenome(genome: HiveGenome): HiveGenome {
  return {
    id: genome.id,
    fitness: genome.fitness,
    whiteFitness: genome.whiteFitness,
    blackFitness: genome.blackFitness,
    whiteDrawRate: genome.whiteDrawRate,
    blackDrawRate: genome.blackDrawRate,
    weights: normalizeHiveWeights(genome.weights)
  };
}

function crossover(a: HiveHeuristicWeights, b: HiveHeuristicWeights, rng: SeededRandom): HiveHeuristicWeights {
  const mix = (x: number, y: number) => x * (1 - rng.next()) + y * rng.next();
  return {
    queenPressure: mix(a.queenPressure, b.queenPressure),
    queenLiberties: mix(a.queenLiberties, b.queenLiberties),
    mobility: mix(a.mobility, b.mobility),
    reserveDevelopment: mix(a.reserveDevelopment, b.reserveDevelopment),
    placementFreedom: mix(a.placementFreedom, b.placementFreedom),
    stackControl: mix(a.stackControl, b.stackControl),
    contactPressure: mix(a.contactPressure, b.contactPressure),
    queenClosurePotential: mix(a.queenClosurePotential, b.queenClosurePotential),
    beetlePressure: mix(a.beetlePressure, b.beetlePressure),
    queenRingQuality: mix(a.queenRingQuality, b.queenRingQuality),
    queenTiming: mix(a.queenTiming, b.queenTiming),
    surroundLeverage: mix(a.surroundLeverage, b.surroundLeverage),
    beetleLock: mix(a.beetleLock, b.beetleLock)
  };
}

function mutate(weights: HiveHeuristicWeights, rng: SeededRandom, config: HiveTrainingConfig): HiveHeuristicWeights {
  const mutateField = (value: number) => {
    if (rng.next() > config.mutationRate) return value;
    const delta = (rng.next() * 2 - 1) * config.mutationScale;
    return Math.max(-5, Math.min(5, value + delta));
  };

  return {
    queenPressure: mutateField(weights.queenPressure),
    queenLiberties: mutateField(weights.queenLiberties),
    mobility: mutateField(weights.mobility),
    reserveDevelopment: mutateField(weights.reserveDevelopment),
    placementFreedom: mutateField(weights.placementFreedom),
    stackControl: mutateField(weights.stackControl),
    contactPressure: mutateField(weights.contactPressure),
    queenClosurePotential: mutateField(weights.queenClosurePotential),
    beetlePressure: mutateField(weights.beetlePressure),
    queenRingQuality: mutateField(weights.queenRingQuality),
    queenTiming: mutateField(weights.queenTiming),
    surroundLeverage: mutateField(weights.surroundLeverage),
    beetleLock: mutateField(weights.beetleLock)
  };
}

function tournamentSelect(population: HiveGenome[], rng: SeededRandom, tournamentSize: number): HiveGenome {
  let best = population[rng.int(0, population.length)] as HiveGenome;
  for (let i = 1; i < tournamentSize; i += 1) {
    const candidate = population[rng.int(0, population.length)] as HiveGenome;
    if (candidate.fitness > best.fitness) best = candidate;
  }
  return best;
}

function pushRecentGame(recentGames: HiveTrainingReplay[], replay: HiveTrainingReplay, limit = 10): void {
  recentGames.push(replay);
  if (recentGames.length > limit) recentGames.splice(0, recentGames.length - limit);
}

function normalizeEvaluation(score: number | undefined): number {
  if (score === undefined) return 0;
  return Math.tanh(score / DRAW_EVAL_SCALE);
}

function scoreReplayForCandidate(replay: HiveTrainingReplay, candidateSide: Player, maxTurns: number): number {
  const turnFactor = Math.max(0, 1 - replay.turns.length / Math.max(1, maxTurns));
  if (replay.winner === candidateSide) {
    return 1 + WIN_SPEED_BONUS * turnFactor;
  }

  if (replay.winner === "draw") {
    const evaluation = candidateSide === "white" ? replay.finalEvaluationWhite : replay.finalEvaluationBlack;
    return DRAW_BASE_SCORE + DRAW_EVAL_WEIGHT * normalizeEvaluation(evaluation) + DRAW_SPEED_WEIGHT * turnFactor;
  }

  return 0;
}

function sideFitness(genome: HiveGenome, side: Player): number {
  return side === "white" ? genome.whiteFitness ?? 0 : genome.blackFitness ?? 0;
}

function sideDrawRate(genome: HiveGenome, side: Player): number {
  return side === "white" ? genome.whiteDrawRate ?? 1 : genome.blackDrawRate ?? 1;
}

function minimumSideFitness(genome: HiveGenome): number {
  return Math.min(sideFitness(genome, "white"), sideFitness(genome, "black"));
}

function shouldPromoteChampion(candidate: HiveGenome, currentChampion: HiveGenome): boolean {
  if (candidate.fitness <= currentChampion.fitness) return false;
  if (sideFitness(candidate, "white") < MIN_PROMOTION_SIDE_FITNESS) return false;
  if (sideFitness(candidate, "black") < MIN_PROMOTION_SIDE_FITNESS) return false;
  if (sideDrawRate(candidate, "white") > MAX_PROMOTION_SIDE_DRAW_RATE) return false;
  if (sideDrawRate(candidate, "black") > MAX_PROMOTION_SIDE_DRAW_RATE) return false;
  if (sideFitness(candidate, "white") + PROMOTION_SIDE_TOLERANCE < sideFitness(currentChampion, "white")) return false;
  if (sideFitness(candidate, "black") + PROMOTION_SIDE_TOLERANCE < sideFitness(currentChampion, "black")) return false;
  return minimumSideFitness(candidate) + PROMOTION_SIDE_TOLERANCE >= minimumSideFitness(currentChampion);
}

function playGame(
  whiteAgent: HiveAgent,
  blackAgent: HiveAgent,
  metadata: Omit<HiveTrainingReplay, "winner" | "winReason" | "turns">,
  maxTurns: number,
  onProgress?: (event: HiveTrainingProgressEvent) => Promise<void> | void
): Promise<HiveTrainingReplay> {
  return (async () => {
    const gameInfo = {
      generation: metadata.generation,
      genomeId: metadata.genomeId,
      gameIndex: metadata.gameIndex,
      seed: metadata.seed,
      players: metadata.players
    };
    await onProgress?.({
      kind: "game-start",
      ...gameInfo
    });

    let state = engine.initialState({ seed: metadata.seed });
    const turns: HiveTrainingReplayTurn[] = [];
    let moveCount = 0;
    let moveDurationTotalMs = 0;

    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (state.winner) {
        const replay = {
          ...metadata,
          winner: state.winner,
          winReason: state.winReason,
          finalEvaluationWhite: HiveHeuristicEvaluator.score(state, "white", DEFAULT_HIVE_WEIGHTS),
          finalEvaluationBlack: HiveHeuristicEvaluator.score(state, "black", DEFAULT_HIVE_WEIGHTS),
          turns
        };
        await onProgress?.({
          kind: "game-end",
          ...gameInfo,
          totalTurns: turns.length,
          averageMoveDurationMs: moveCount > 0 ? moveDurationTotalMs / moveCount : 0,
          winner: replay.winner,
          winReason: replay.winReason
        });
        return replay;
      }
      const legal = engine.legalMoves(state);
      const actor = state.currentPlayer === "white" ? whiteAgent : blackAgent;
      const before = stateHash(state);
      const moveStartedAt = process.hrtime.bigint();
      const move = actor.selectMove(state, legal, { seed: turn });
      const nextState = engine.applyMove(state, move);
      const moveDurationMs = Number(process.hrtime.bigint() - moveStartedAt) / 1_000_000;
      moveCount += 1;
      moveDurationTotalMs += moveDurationMs;
      turns.push({ turn: state.turn, player: state.currentPlayer, move, stateHashBefore: before, stateHashAfter: stateHash(nextState) });
      await onProgress?.({
        kind: "turn",
        ...gameInfo,
        turn: state.turn,
        player: state.currentPlayer,
        move,
        moveDurationMs,
        averageMoveDurationMs: moveDurationTotalMs / moveCount,
        winner: nextState.winner,
        winReason: nextState.winReason
      });
      state = nextState;
    }

    const replay = {
      ...metadata,
      winner: "draw" as const,
      winReason: "turn-limit-draw" as const,
      finalEvaluationWhite: HiveHeuristicEvaluator.score(state, "white", DEFAULT_HIVE_WEIGHTS),
      finalEvaluationBlack: HiveHeuristicEvaluator.score(state, "black", DEFAULT_HIVE_WEIGHTS),
      turns
    };
    await onProgress?.({
      kind: "game-end",
      ...gameInfo,
      totalTurns: turns.length,
      averageMoveDurationMs: moveCount > 0 ? moveDurationTotalMs / moveCount : 0,
      winner: replay.winner,
      winReason: replay.winReason
    });
    return replay;
  })();
}

async function evaluateGenome(
  weights: HiveHeuristicWeights,
  config: HiveTrainingConfig,
  seedOffset: number,
  generation: number,
  genomeId: string,
  recentGames: HiveTrainingReplay[],
  peerPool: HiveGenome[],
  onProgress?: (event: HiveTrainingProgressEvent) => Promise<void> | void
): Promise<HiveGenomeEvaluationResult> {
  const useTranspositionTable = config.useTranspositionTable ?? false;
  const candidateWeights = normalizeHiveWeights(weights);
  const candidate = new HiveHeuristicAgent(candidateWeights, config.searchDepth, genomeId, undefined, useTranspositionTable);
  const previousChampion = config.previousChampionWeights
    ? new HiveHeuristicAgent(normalizeHiveWeights(config.previousChampionWeights), config.searchDepth, "previous-champion", undefined, useTranspositionTable)
    : null;
  const championArchive = config.useChampionArchive
    ? (config.championArchiveWeights ?? []).map(
        (archiveWeights, idx) =>
          new HiveHeuristicAgent(normalizeHiveWeights(archiveWeights), config.searchDepth, `archive-${idx}`, undefined, useTranspositionTable)
      )
    : [];
  const peerOpponents = config.usePeerOpponents
    ? peerPool
        .filter((peer) => peer.id !== genomeId)
        .map((peer) => ({
          id: peer.id,
          agent: new HiveHeuristicAgent(normalizeHiveWeights(peer.weights), config.searchDepth, `peer-${peer.id}`, undefined, useTranspositionTable)
        }))
    : [];
  let score = 0;
  let whiteScore = 0;
  let blackScore = 0;
  let whiteGames = 0;
  let blackGames = 0;
  let whiteDraws = 0;
  let blackDraws = 0;
  const opponentModes = [
    ...(config.useRandomOpponents ? (["random"] as const) : []),
    ...(previousChampion ? (["previous-champion"] as const) : []),
    ...(championArchive.length > 0 ? (["archive"] as const) : []),
    ...(peerOpponents.length > 0 ? (["peer"] as const) : [])
  ];

  for (let i = 0; i < config.gamesPerGenome; i += 1) {
      const mode = opponentModes[i % opponentModes.length] ?? "random";
      let whiteOpponent: HiveAgent;
      let blackOpponent: HiveAgent;
      let whiteLabel: string;
      let blackLabel: string;

      if (mode === "previous-champion" && previousChampion) {
        whiteOpponent = previousChampion;
        blackOpponent = previousChampion;
        whiteLabel = "previous-champion";
        blackLabel = "previous-champion";
      } else if (mode === "archive" && championArchive.length > 0) {
        const archiveOpponent = championArchive[i % championArchive.length] as HiveHeuristicAgent;
        whiteOpponent = archiveOpponent;
        blackOpponent = archiveOpponent;
        whiteLabel = archiveOpponent.name;
        blackLabel = archiveOpponent.name;
      } else if (mode === "peer" && peerOpponents.length > 0) {
        const peerOpponent = peerOpponents[(seedOffset + i) % peerOpponents.length]!;
        whiteOpponent = peerOpponent.agent;
        blackOpponent = peerOpponent.agent;
        whiteLabel = peerOpponent.id;
        blackLabel = peerOpponent.id;
      } else {
        whiteOpponent = new RandomHiveAgent(`random-w-${i}`, seedOffset * 100 + i + 11);
        blackOpponent = new RandomHiveAgent(`random-b-${i}`, seedOffset * 100 + i + 71);
        whiteLabel = `random-w-${i}`;
        blackLabel = `random-b-${i}`;
      }

      const asWhite = await playGame(candidate, blackOpponent, {
        replayId: `${genomeId}-g${generation}-game-${i * 2}`,
        startedAtIso: new Date().toISOString(),
        seed: seedOffset * 1000 + i * 2,
        generation,
        genomeId,
        gameIndex: i * 2,
        players: { white: genomeId, black: blackLabel }
      }, config.maxTurnsPerGame, onProgress);
      pushRecentGame(recentGames, asWhite);
      {
        const replayScore = scoreReplayForCandidate(asWhite, "white", config.maxTurnsPerGame);
        score += replayScore;
        whiteScore += replayScore;
        whiteGames += 1;
        if (asWhite.winner === "draw") whiteDraws += 1;
      }

      const asBlack = await playGame(whiteOpponent, candidate, {
        replayId: `${genomeId}-g${generation}-game-${i * 2 + 1}`,
        startedAtIso: new Date().toISOString(),
        seed: seedOffset * 1000 + i * 2 + 1,
        generation,
        genomeId,
        gameIndex: i * 2 + 1,
        players: { white: whiteLabel, black: genomeId }
      }, config.maxTurnsPerGame, onProgress);
      pushRecentGame(recentGames, asBlack);
      {
        const replayScore = scoreReplayForCandidate(asBlack, "black", config.maxTurnsPerGame);
        score += replayScore;
        blackScore += replayScore;
        blackGames += 1;
        if (asBlack.winner === "draw") blackDraws += 1;
      }
  }

  return {
    fitness: score / (config.gamesPerGenome * 2),
    whiteFitness: whiteGames > 0 ? whiteScore / whiteGames : 0,
    blackFitness: blackGames > 0 ? blackScore / blackGames : 0,
    whiteDrawRate: whiteGames > 0 ? whiteDraws / whiteGames : 0,
    blackDrawRate: blackGames > 0 ? blackDraws / blackGames : 0,
    recentGames: [...recentGames]
  };
}

export async function evaluateHiveGenomeTask(
  task: HiveGenomeEvaluationTask,
  onProgress?: (event: HiveTrainingProgressEvent) => Promise<void> | void
): Promise<HiveGenomeEvaluationResult> {
  return evaluateGenome(
    task.weights,
    task.config,
    task.seedOffset,
    task.generation,
    task.genomeId,
    [],
    task.peerPool,
    onProgress
  );
}

async function evaluateGenomeInWorker(
  task: HiveGenomeEvaluationTask,
  onProgress?: (event: HiveTrainingProgressEvent) => Promise<void> | void
): Promise<HiveGenomeEvaluationResult> {
  return new Promise((resolve, reject) => {
    const workerPath = new URL("./worker.ts", import.meta.url);
    const child = spawn("pnpm", ["exec", "tsx", workerPath.pathname], {
      env: {
        ...process.env,
        HIVE_WORKER_TASK_JSON: JSON.stringify(task)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    void onProgress?.({
      kind: "worker-start",
      generation: task.generation,
      genomeId: task.genomeId,
      workerPid: child.pid ?? -1,
      workerCommand: `pnpm exec tsx ${workerPath.pathname}`
    });
    let settled = false;
    let stderr = "";
    const stdout = child.stdout;
    if (!stdout) {
      const error = "Hive worker child has no stdout pipe.";
      void onProgress?.({
        kind: "worker-error",
        generation: task.generation,
        genomeId: task.genomeId,
        workerPid: child.pid,
        error
      });
      reject(new Error(error));
      return;
    }

    const rl = createInterface({ input: stdout });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const message = JSON.parse(trimmed) as { kind: "progress"; event: HiveTrainingProgressEvent } | { kind: "result"; result: HiveGenomeEvaluationResult };
        if (message.kind === "progress") {
          void onProgress?.(message.event);
        } else {
          settled = true;
          rl.close();
          resolve(message.result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void onProgress?.({
          kind: "worker-error",
          generation: task.generation,
          genomeId: task.genomeId,
          workerPid: child.pid,
          error: `Failed to parse worker stdout: ${message}`,
          stderr: stderr.trim() || undefined,
          rawLine: trimmed
        });
        rl.close();
        reject(new Error(`Hive worker emitted non-JSON stdout for ${task.genomeId}: ${trimmed}`));
      }
    });

    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      void onProgress?.({
        kind: "worker-error",
        generation: task.generation,
        genomeId: task.genomeId,
        workerPid: child.pid,
        error: error instanceof Error ? error.message : String(error),
        stderr: stderr.trim() || undefined
      });
      reject(error);
    });
    child.on("exit", (code, signal) => {
      void onProgress?.({
        kind: "worker-exit",
        generation: task.generation,
        genomeId: task.genomeId,
        workerPid: child.pid ?? -1,
        exitCode: code,
        signal,
        hadResult: settled
      });
      if (!settled) {
        const error = `Hive worker exited with code ${code}${signal ? ` signal ${signal}` : ""}. ${stderr.trim()}`.trim();
        void onProgress?.({
          kind: "worker-error",
          generation: task.generation,
          genomeId: task.genomeId,
          workerPid: child.pid,
          error,
          stderr: stderr.trim() || undefined
        });
        reject(new Error(error));
      }
    });
  });
}

async function evaluatePopulation(
  population: HiveGenome[],
  config: HiveTrainingConfig,
  generation: number,
  onProgress?: (event: HiveTrainingProgressEvent) => Promise<void> | void
): Promise<{ evaluatedPopulation: HiveGenome[]; replays: HiveTrainingReplay[] }> {
  const workerCount = Math.max(1, Math.min(config.parallelWorkers ?? 1, population.length));
  const results: Array<HiveGenomeEvaluationResult | undefined> = new Array(population.length);
  const replays: HiveTrainingReplay[] = [];

  if (workerCount === 1) {
    for (let idx = 0; idx < population.length; idx += 1) {
      const genome = population[idx]!;
      results[idx] = await evaluateHiveGenomeTask(
        {
          weights: genome.weights,
          config,
          seedOffset: generation * config.populationSize + idx + 1,
          generation,
          genomeId: genome.id,
          peerPool: population
        },
        onProgress
      );
    }
  } else {
    let nextIndex = 0;
    const runNext = async (): Promise<void> => {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= population.length) return;
      const genome = population[idx]!;
      results[idx] = await evaluateGenomeInWorker(
        {
          weights: genome.weights,
          config,
          seedOffset: generation * config.populationSize + idx + 1,
          generation,
          genomeId: genome.id,
          peerPool: population
        },
        onProgress
      );
      await runNext();
    };

    await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  }

  const evaluatedPopulation = population.map((genome, idx) => {
    const result = results[idx];
    if (!result) {
      throw new Error(`Missing Hive genome evaluation result for index ${idx}`);
    }
    for (const replay of result.recentGames) {
      pushRecentGame(replays, replay, 10_000);
    }
    return {
      ...genome,
      fitness: result.fitness,
      whiteFitness: result.whiteFitness,
      blackFitness: result.blackFitness,
      whiteDrawRate: result.whiteDrawRate,
      blackDrawRate: result.blackDrawRate
    };
  });

  return { evaluatedPopulation, replays };
}

export async function trainHiveHeuristic(
  partialConfig: Partial<HiveTrainingConfig> = {},
  onGeneration?: (generation: number, population: HiveGenome[]) => Promise<void> | void,
  onProgress?: (event: HiveTrainingProgressEvent) => Promise<void> | void
): Promise<HiveTrainingResult> {
  const config: HiveTrainingConfig = { ...DEFAULT_CONFIG, ...partialConfig };
  const rng = new SeededRandom(config.seed);
  const recentGames: HiveTrainingReplay[] = [];
  let progressQueue = Promise.resolve();
  const emitProgress = (event: HiveTrainingProgressEvent) => {
    progressQueue = progressQueue.then(() => onProgress?.(event));
    return progressQueue;
  };

  const baselineWeights = normalizeHiveWeights(config.initialWeights ?? config.previousChampionWeights ?? DEFAULT_HIVE_WEIGHTS);
  const seedPool = [
    baselineWeights,
    ...(config.previousChampionWeights ? [normalizeHiveWeights(config.previousChampionWeights)] : []),
    ...((config.championArchiveWeights ?? []).map((weights) => normalizeHiveWeights(weights)))
  ];

  let population: HiveGenome[] = Array.from({ length: config.populationSize }, (_, idx) => {
    if (idx === 0) {
      return {
        id: `hive-genome-${idx}`,
        weights: baselineWeights,
        fitness: 0
      };
    }

    const explorationSlot = idx % 5 === 0;
    const source = seedPool[(idx - 1) % seedPool.length] ?? baselineWeights;
    return {
      id: `hive-genome-${idx}`,
      weights: explorationSlot ? createRandomWeights(rng) : jitterWeights(source, rng, Math.max(0.35, config.mutationScale * 2)),
      fitness: 0
    };
  });

  let champion = cloneGenome(population[0] as HiveGenome);
  const history: HiveGenerationStat[] = [];

  for (let generation = 0; generation < config.generations; generation += 1) {
    const { evaluatedPopulation, replays } = await evaluatePopulation(population, config, generation, emitProgress);
    population = evaluatedPopulation;
    for (const replay of replays) {
      pushRecentGame(recentGames, replay);
    }

    population.sort((a, b) => b.fitness - a.fitness);
    if (population[0] && shouldPromoteChampion(population[0], champion)) {
      champion = cloneGenome(population[0] as HiveGenome);
    }

    const meanFitness = population.reduce((sum, genome) => sum + genome.fitness, 0) / population.length;
    const meanWhiteFitness = population.reduce((sum, genome) => sum + (genome.whiteFitness ?? 0), 0) / population.length;
    const meanBlackFitness = population.reduce((sum, genome) => sum + (genome.blackFitness ?? 0), 0) / population.length;
    const meanWhiteDrawRate = population.reduce((sum, genome) => sum + (genome.whiteDrawRate ?? 0), 0) / population.length;
    const meanBlackDrawRate = population.reduce((sum, genome) => sum + (genome.blackDrawRate ?? 0), 0) / population.length;
    history.push({
      generation,
      bestFitness: population[0]?.fitness ?? 0,
      meanFitness,
      bestWhiteFitness: population[0]?.whiteFitness ?? 0,
      bestBlackFitness: population[0]?.blackFitness ?? 0,
      bestWhiteDrawRate: population[0]?.whiteDrawRate ?? 0,
      bestBlackDrawRate: population[0]?.blackDrawRate ?? 0,
      meanWhiteFitness,
      meanBlackFitness,
      meanWhiteDrawRate,
      meanBlackDrawRate,
      bestWeights: { ...(population[0] as HiveGenome).weights },
      championFitness: champion.fitness,
      championWhiteFitness: champion.whiteFitness ?? 0,
      championBlackFitness: champion.blackFitness ?? 0,
      championWhiteDrawRate: champion.whiteDrawRate ?? 0,
      championBlackDrawRate: champion.blackDrawRate ?? 0,
      championWeights: { ...champion.weights }
    });

    await onGeneration?.(generation, population.map(cloneGenome));
    await emitProgress({
      kind: "generation-complete",
      generation,
      population: population.map(cloneGenome)
    });

    const nextPopulation: HiveGenome[] = population.slice(0, config.elitismCount).map(cloneGenome);
    while (nextPopulation.length < config.populationSize) {
      const parentA = tournamentSelect(population, rng, config.tournamentSize);
      const parentB = tournamentSelect(population, rng, config.tournamentSize);
      let childWeights = { ...parentA.weights };
      if (rng.next() < config.crossoverRate) {
        childWeights = crossover(parentA.weights, parentB.weights, rng);
      }
      childWeights = mutate(childWeights, rng, config);
      nextPopulation.push({
        id: `hive-genome-${generation + 1}-${nextPopulation.length}`,
        weights: childWeights,
        fitness: 0
      });
    }
    population = nextPopulation;
  }

  await progressQueue;

  const bestGenome = cloneGenome(champion);
  return { bestGenome, history, recentGames };
}
