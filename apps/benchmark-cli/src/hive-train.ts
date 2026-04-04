import dotenv from "dotenv";
import os from "node:os";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  normalizeHiveWeights,
  type HiveGenome,
  type HiveHeuristicWeights,
  type HiveTrainingProgressEvent,
  type HiveTrainingReplay
} from "@board-ai-lab/hive-ga";
import { trainHiveHeuristic } from "@board-ai-lab/hive-ga/trainer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

const hiveTrainingDir = path.resolve(rootDir, "artifacts", "hive-training");
const playgroundPublicDir = path.resolve(rootDir, "apps", "playground", "public");
const hiveBotTiersPath = path.join(hiveTrainingDir, "hive-bot-tiers.json");
let activeRunId: string | undefined;
let activeRunDir: string | undefined;
let activeTrainingLogPath: string | undefined;
let activeRunStartedAtIso: string | undefined;

interface HiveTrainingManifestEntry {
  runId: string;
  createdAtIso: string;
  fitness: number;
  weights: HiveHeuristicWeights;
}

interface HiveBotTierManifest {
  updatedAtIso: string;
  latestRunId?: string;
  mediumRunId?: string;
  hardRunId?: string;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function appendLogLine(filePath: string, line: string): Promise<void> {
  await appendFile(filePath, `${line}\n`, "utf8");
}

function createRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function listCompletedHiveTrainingRunDirs(): Promise<string[]> {
  try {
    const entries = await readdir(hiveTrainingDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("hive-train-"))
      .map((entry) => path.join(hiveTrainingDir, entry.name))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

async function loadBestHiveWeights(runDir?: string): Promise<HiveHeuristicWeights | undefined> {
  if (!runDir) return undefined;
  try {
    const bestText = await readFile(path.join(runDir, "best-genome.json"), "utf8");
    const parsed = JSON.parse(bestText) as HiveGenome;
    return normalizeHiveWeights(parsed.weights);
  } catch {
    return undefined;
  }
}

async function loadHiveChampionArchiveWeights(limit = 3, excludeRunDir?: string): Promise<HiveHeuristicWeights[]> {
  const runDirs = await listCompletedHiveTrainingRunDirs();
  const selected = runDirs.filter((runDir) => runDir !== excludeRunDir).slice(0, limit);
  const weights: HiveHeuristicWeights[] = [];
  for (const runDir of selected) {
    const current = await loadBestHiveWeights(runDir);
    if (current) weights.push(current);
  }
  return weights;
}

async function writeHiveTrainingManifest(): Promise<void> {
  const manifest: HiveTrainingManifestEntry[] = [];
  const runDirs = await listCompletedHiveTrainingRunDirs();
  for (const runDir of runDirs) {
    const runId = path.basename(runDir);
    try {
      const bestText = await readFile(path.join(runDir, "best-genome.json"), "utf8");
      const bestGenome = JSON.parse(bestText) as HiveGenome;
      const timestampPart = runId.split("-").slice(2, 3)[0];
      const createdAtIso = timestampPart ? new Date(Number(timestampPart)).toISOString() : new Date().toISOString();
      manifest.push({
        runId,
        createdAtIso,
        fitness: bestGenome.fitness,
        weights: normalizeHiveWeights(bestGenome.weights)
      });
    } catch {
      // skip incomplete runs
    }
  }
  await writeJson(path.join(playgroundPublicDir, "hive-training-manifest.json"), manifest);
}

async function readHiveBotTierManifest(): Promise<HiveBotTierManifest> {
  try {
    const text = await readFile(hiveBotTiersPath, "utf8");
    return JSON.parse(text) as HiveBotTierManifest;
  } catch {
    return {
      updatedAtIso: new Date().toISOString()
    };
  }
}

async function writeHiveBotTierManifest(manifest: HiveBotTierManifest): Promise<void> {
  await writeJson(hiveBotTiersPath, manifest);
  await writeJson(path.join(playgroundPublicDir, "hive-bot-tiers.json"), manifest);
}

async function main(): Promise<void> {
  await mkdir(hiveTrainingDir, { recursive: true });
  await mkdir(playgroundPublicDir, { recursive: true });

  const tierManifest = await readHiveBotTierManifest();
  const mediumRunDir = tierManifest.mediumRunId ? path.join(hiveTrainingDir, tierManifest.mediumRunId) : undefined;
  const selectedRunDir = process.env.HIVE_TRAINING_RUN_DIR ?? mediumRunDir ?? (await listCompletedHiveTrainingRunDirs())[0];
  const previousChampionWeights = await loadBestHiveWeights(selectedRunDir);
  const championArchiveWeights = await loadHiveChampionArchiveWeights(3, selectedRunDir);
  const runId = process.env.HIVE_GA_RUN_ID ?? createRunId("hive-train");
  const runDir = path.join(hiveTrainingDir, runId);
  await mkdir(runDir, { recursive: true });
  const trainingLogPath = path.join(runDir, "training.log");
  activeRunId = runId;
  activeRunDir = runDir;
  activeTrainingLogPath = trainingLogPath;

  const trainingConfig = {
    initialWeights: previousChampionWeights,
    previousChampionWeights,
    championArchiveWeights,
    populationSize: Number(process.env.HIVE_GA_POPULATION ?? 24),
    generations: Number(process.env.HIVE_GA_GENERATIONS ?? 12),
    elitismCount: Number(process.env.HIVE_GA_ELITISM ?? 4),
    gamesPerGenome: Number(process.env.HIVE_GA_GAMES ?? 4),
    searchDepth: Number(process.env.HIVE_GA_DEPTH ?? 1),
    useTranspositionTable: process.env.HIVE_GA_USE_TT === "1",
    maxTurnsPerGame: Number(process.env.HIVE_GA_MAX_TURNS ?? 100),
    useRandomOpponents: process.env.HIVE_GA_USE_RANDOM !== "0",
    usePeerOpponents: process.env.HIVE_GA_USE_PEERS !== "0",
    useChampionArchive: process.env.HIVE_GA_USE_ARCHIVE !== "0",
    parallelWorkers: Number(process.env.HIVE_GA_WORKERS ?? Math.max(1, Math.min(4, os.availableParallelism() - 1))),
    seed: Number(process.env.HIVE_GA_SEED ?? 42)
  };

  const runStartedAt = new Date();
  activeRunStartedAtIso = runStartedAt.toISOString();
  await writeJson(path.join(runDir, "meta.json"), {
    runId,
    startedAtIso: runStartedAt.toISOString(),
    status: "running",
    trainingConfig: {
      ...trainingConfig,
      hasPreviousChampion: Boolean(previousChampionWeights),
      championArchiveSize: championArchiveWeights.length
    }
  });
  await writeJson(path.join(runDir, "status.json"), {
    runId,
    status: "running",
    startedAtIso: runStartedAt.toISOString(),
    currentGeneration: 0,
    completedGenerations: 0
  });
  await appendLogLine(trainingLogPath, `[${runStartedAt.toISOString()}] run-start ${JSON.stringify({
    runId,
    populationSize: trainingConfig.populationSize,
    generations: trainingConfig.generations,
    gamesPerGenome: trainingConfig.gamesPerGenome,
    searchDepth: trainingConfig.searchDepth,
    useTranspositionTable: trainingConfig.useTranspositionTable,
    parallelWorkers: trainingConfig.parallelWorkers,
    maxTurnsPerGame: trainingConfig.maxTurnsPerGame,
    hasPreviousChampion: Boolean(previousChampionWeights),
    championArchiveSize: championArchiveWeights.length
  })}`);

  const generationStartMs = Date.now();
  const writeRunningStatus = async (partial: Record<string, unknown>) => {
    await writeJson(path.join(runDir, "status.json"), {
      runId,
      status: "running",
      startedAtIso: runStartedAt.toISOString(),
      ...partial
    });
  };

  const onGeneration = async (generation: number, population: HiveGenome[]) => {
    const bestGenome = population[0];
    const meanFitness = population.reduce((sum, genome) => sum + genome.fitness, 0) / Math.max(1, population.length);
    const meanWhiteFitness = population.reduce((sum, genome) => sum + (genome.whiteFitness ?? 0), 0) / Math.max(1, population.length);
    const meanBlackFitness = population.reduce((sum, genome) => sum + (genome.blackFitness ?? 0), 0) / Math.max(1, population.length);
    const meanWhiteDrawRate = population.reduce((sum, genome) => sum + (genome.whiteDrawRate ?? 0), 0) / Math.max(1, population.length);
    const meanBlackDrawRate = population.reduce((sum, genome) => sum + (genome.blackDrawRate ?? 0), 0) / Math.max(1, population.length);
    const elapsedSeconds = ((Date.now() - generationStartMs) / 1000).toFixed(1);
    await writeJson(path.join(runDir, `checkpoint-g${generation}.json`), {
      generation,
      best: population[0]
    });
    await writeRunningStatus({
      currentGeneration: generation,
      completedGenerations: generation + 1,
      bestFitness: bestGenome?.fitness ?? 0,
      meanFitness,
      bestWhiteFitness: bestGenome?.whiteFitness ?? 0,
      bestBlackFitness: bestGenome?.blackFitness ?? 0,
      bestWhiteDrawRate: bestGenome?.whiteDrawRate ?? 0,
      bestBlackDrawRate: bestGenome?.blackDrawRate ?? 0,
      meanWhiteFitness,
      meanBlackFitness,
      meanWhiteDrawRate,
      meanBlackDrawRate,
      elapsedSeconds: Number(elapsedSeconds)
    });
    const line = `[${new Date().toISOString()}] generation=${generation} bestFitness=${(bestGenome?.fitness ?? 0).toFixed(4)} bestWhiteFitness=${(bestGenome?.whiteFitness ?? 0).toFixed(4)} bestBlackFitness=${(bestGenome?.blackFitness ?? 0).toFixed(4)} bestWhiteDrawRate=${(bestGenome?.whiteDrawRate ?? 0).toFixed(4)} bestBlackDrawRate=${(bestGenome?.blackDrawRate ?? 0).toFixed(4)} meanFitness=${meanFitness.toFixed(4)} meanWhiteFitness=${meanWhiteFitness.toFixed(4)} meanBlackFitness=${meanBlackFitness.toFixed(4)} bestGenome=${bestGenome?.id ?? "n/a"} elapsedSeconds=${elapsedSeconds}`;
    console.log(line);
    await appendLogLine(trainingLogPath, line);
  };

  const onProgress = async (event: HiveTrainingProgressEvent) => {
    if (event.kind === "game-start") {
      const line = `[${new Date().toISOString()}] game-start generation=${event.generation} genome=${event.genomeId} gameIndex=${event.gameIndex} white=${event.players.white} black=${event.players.black} seed=${event.seed}`;
      await appendLogLine(trainingLogPath, line);
      await writeRunningStatus({
        currentGeneration: event.generation,
        completedGenerations: event.generation,
        currentGenomeId: event.genomeId,
        currentGameIndex: event.gameIndex,
        currentGameSeed: event.seed,
        currentGamePlayers: event.players,
        currentTurn: 0
      });
      return;
    }

    if (event.kind === "turn") {
      const line = `[${new Date().toISOString()}] turn generation=${event.generation} genome=${event.genomeId} gameIndex=${event.gameIndex} turn=${event.turn} player=${event.player} moveMs=${event.moveDurationMs.toFixed(2)} avgMoveMs=${event.averageMoveDurationMs.toFixed(2)}`;
      await appendLogLine(trainingLogPath, line);
      await writeRunningStatus({
        currentGeneration: event.generation,
        completedGenerations: event.generation,
        currentGenomeId: event.genomeId,
        currentGameIndex: event.gameIndex,
        currentGameSeed: event.seed,
        currentGamePlayers: event.players,
        currentTurn: event.turn,
        currentPlayer: event.player,
        lastMoveDurationMs: Number(event.moveDurationMs.toFixed(3)),
        averageMoveDurationMs: Number(event.averageMoveDurationMs.toFixed(3)),
        pendingWinner: event.winner,
        pendingWinReason: event.winReason
      });
      return;
    }

    if (event.kind === "game-end") {
      const line = `[${new Date().toISOString()}] game-end generation=${event.generation} genome=${event.genomeId} gameIndex=${event.gameIndex} totalTurns=${event.totalTurns} avgMoveMs=${event.averageMoveDurationMs.toFixed(2)} winner=${event.winner ?? "none"} winReason=${event.winReason ?? "none"}`;
      await appendLogLine(trainingLogPath, line);
      await writeRunningStatus({
        currentGeneration: event.generation,
        completedGenerations: event.generation,
        currentGenomeId: event.genomeId,
        currentGameIndex: event.gameIndex,
        currentGameSeed: event.seed,
        currentGamePlayers: event.players,
        currentTurn: event.totalTurns,
        averageMoveDurationMs: Number(event.averageMoveDurationMs.toFixed(3)),
        latestGameWinner: event.winner,
        latestGameWinReason: event.winReason
      });
      return;
    }

    if (event.kind === "generation-complete") {
      return;
    }

    if (event.kind === "worker-start") {
      const line = `[${new Date().toISOString()}] worker-start generation=${event.generation} genome=${event.genomeId} pid=${event.workerPid} command=${JSON.stringify(event.workerCommand)}`;
      await appendLogLine(trainingLogPath, line);
      return;
    }

    if (event.kind === "worker-exit") {
      const line = `[${new Date().toISOString()}] worker-exit generation=${event.generation} genome=${event.genomeId} pid=${event.workerPid} exitCode=${event.exitCode ?? "null"} signal=${event.signal ?? "null"} hadResult=${event.hadResult}`;
      await appendLogLine(trainingLogPath, line);
      return;
    }

    if (event.kind === "worker-error") {
      const line = `[${new Date().toISOString()}] worker-error generation=${event.generation} genome=${event.genomeId} pid=${event.workerPid ?? "unknown"} error=${JSON.stringify(event.error)} stderr=${JSON.stringify(event.stderr ?? "")} rawLine=${JSON.stringify(event.rawLine ?? "")}`;
      await appendLogLine(trainingLogPath, line);
      await writeRunningStatus({
        currentGeneration: event.generation,
        completedGenerations: event.generation,
        currentGenomeId: event.genomeId,
        workerError: event.error,
        workerPid: event.workerPid ?? null
      });
      return;
    }
  };

  const result = await trainHiveHeuristic(trainingConfig, onGeneration, onProgress);

  await writeJson(path.join(runDir, "best-genome.json"), result.bestGenome);
  await writeJson(path.join(runDir, "history.json"), result.history);
  await writeJson(path.join(runDir, "last-10-games.json"), result.recentGames);
  await writeJson(path.join(runDir, "meta.json"), {
    runId,
    startedAtIso: runStartedAt.toISOString(),
    completedAtIso: new Date().toISOString(),
    status: "completed",
    trainingConfig: {
      ...trainingConfig,
      hasPreviousChampion: Boolean(previousChampionWeights),
      championArchiveSize: championArchiveWeights.length
    }
  });
  await writeJson(path.join(runDir, "status.json"), {
    runId,
    status: "completed",
    startedAtIso: runStartedAt.toISOString(),
    completedAtIso: new Date().toISOString(),
    completedGenerations: result.history.length,
    bestFitness: result.bestGenome.fitness
  });
  await appendLogLine(trainingLogPath, `[${new Date().toISOString()}] run-complete bestFitness=${result.bestGenome.fitness.toFixed(4)}`);

  const recentGamesDir = path.join(runDir, "last-10-games");
  await mkdir(recentGamesDir, { recursive: true });
  await Promise.all(
    result.recentGames.map((replay: HiveTrainingReplay, idx) =>
      writeJson(path.join(recentGamesDir, `${String(idx + 1).padStart(2, "0")}-${replay.replayId}.json`), replay)
    )
  );

  await writeHiveTrainingManifest();
  await writeHiveBotTierManifest({
    updatedAtIso: new Date().toISOString(),
    latestRunId: runId,
    mediumRunId: tierManifest.mediumRunId,
    hardRunId: tierManifest.hardRunId
  });

  console.log(`Hive training completed: ${runDir}`);
  console.log(`Best fitness: ${result.bestGenome.fitness.toFixed(4)}`);
  console.log(`Last 10 training replays: ${recentGamesDir}`);
}

main().catch((error) => {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const completedAtIso = new Date().toISOString();
  const writes: Promise<unknown>[] = [];
  if (activeTrainingLogPath) {
    writes.push(
      appendLogLine(activeTrainingLogPath, `[${completedAtIso}] run-error message=${JSON.stringify(message)} stack=${JSON.stringify(stack ?? "")}`)
    );
  }
  if (activeRunDir && activeRunId) {
    writes.push(
      writeJson(path.join(activeRunDir, "status.json"), {
        runId: activeRunId,
        status: "error",
        startedAtIso: activeRunStartedAtIso,
        completedAtIso,
        error: message,
        stack
      })
    );
    writes.push(
      writeJson(path.join(activeRunDir, "meta.json"), {
        runId: activeRunId,
        startedAtIso: activeRunStartedAtIso,
        completedAtIso,
        status: "error",
        error: message,
        stack
      })
    );
  }
  void Promise.allSettled(writes);
  process.exitCode = 1;
});
