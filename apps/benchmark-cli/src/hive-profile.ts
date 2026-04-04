import dotenv from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { HiveEngine, setHiveEngineProfileSink, type HiveEngineProfileSink, type HiveMove, type HiveState, type Player } from "@board-ai-lab/hive-engine";
import { HiveHeuristicAgent, normalizeHiveWeights, type HiveSearchProfileSink, type HiveHeuristicWeights } from "@board-ai-lab/hive-ga";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

const hiveTrainingDir = path.resolve(rootDir, "artifacts", "hive-training");
const hiveProfileDir = path.resolve(rootDir, "artifacts", "hive-profiles");
const hiveBotTiersPath = path.join(hiveTrainingDir, "hive-bot-tiers.json");

interface HiveBotTierManifest {
  updatedAtIso: string;
  latestRunId?: string;
  mediumRunId?: string;
  hardRunId?: string;
}

interface TimingAggregate {
  name: string;
  calls: number;
  totalNs: number;
  avgMs: number;
  totalMs: number;
}

interface ProfileSummary {
  runId: string;
  startedAtIso: string;
  completedAtIso: string;
  config: {
    games: number;
    maxTurns: number;
    depth: number;
    useTranspositionTable: boolean;
    profiledRunId?: string;
  };
  results: Array<{
    gameIndex: number;
    startingPlayer: Player;
    turns: number;
    winner?: Player | "draw";
    winReason?: string;
  }>;
  counters: Record<string, number>;
  timings: TimingAggregate[];
}

class AggregateProfiler implements HiveEngineProfileSink, HiveSearchProfileSink {
  private readonly timingTotals = new Map<string, bigint>();
  private readonly timingCalls = new Map<string, number>();
  private readonly counters = new Map<string, number>();

  public recordTiming(name: string, durationNs: bigint): void {
    this.timingTotals.set(name, (this.timingTotals.get(name) ?? 0n) + durationNs);
    this.timingCalls.set(name, (this.timingCalls.get(name) ?? 0) + 1);
  }

  public increment(name: string, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  public timingSummary(): TimingAggregate[] {
    return [...this.timingTotals.entries()]
      .map(([name, totalNs]) => {
        const calls = this.timingCalls.get(name) ?? 0;
        const totalMs = Number(totalNs) / 1_000_000;
        return {
          name,
          calls,
          totalNs: Number(totalNs),
          totalMs,
          avgMs: calls > 0 ? totalMs / calls : 0
        };
      })
      .sort((a, b) => b.totalMs - a.totalMs);
  }

  public counterSummary(): Record<string, number> {
    return Object.fromEntries([...this.counters.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readHiveBotTierManifest(): Promise<HiveBotTierManifest> {
  try {
    const text = await readFile(hiveBotTiersPath, "utf8");
    return JSON.parse(text) as HiveBotTierManifest;
  } catch {
    return { updatedAtIso: new Date().toISOString() };
  }
}

async function loadWeightsForRun(runId?: string): Promise<HiveHeuristicWeights | undefined> {
  if (!runId) return undefined;
  try {
    const text = await readFile(path.join(hiveTrainingDir, runId, "best-genome.json"), "utf8");
    return normalizeHiveWeights((JSON.parse(text) as { weights: HiveHeuristicWeights }).weights);
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  await mkdir(hiveProfileDir, { recursive: true });

  const tierManifest = await readHiveBotTierManifest();
  const profiledRunId = process.env.HIVE_PROFILE_RUN_ID ?? tierManifest.mediumRunId ?? tierManifest.latestRunId;
  const weights = await loadWeightsForRun(profiledRunId);
  if (!weights) {
    throw new Error("Could not load Hive heuristic weights for profiling.");
  }

  const games = Number(process.env.HIVE_PROFILE_GAMES ?? 2);
  const maxTurns = Number(process.env.HIVE_PROFILE_MAX_TURNS ?? 12);
  const depth = Number(process.env.HIVE_PROFILE_DEPTH ?? 2);
  const useTranspositionTable = process.env.HIVE_PROFILE_USE_TT !== "0";
  const runId = `hive-profile-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(hiveProfileDir, runId);
  await mkdir(runDir, { recursive: true });

  const profiler = new AggregateProfiler();
  setHiveEngineProfileSink(profiler);
  const engine = new HiveEngine();
  const whiteAgent = new HiveHeuristicAgent(weights, depth, "profile-white", profiler, useTranspositionTable);
  const blackAgent = new HiveHeuristicAgent(weights, depth, "profile-black", profiler, useTranspositionTable);
  const results: ProfileSummary["results"] = [];
  const startedAtIso = new Date().toISOString();

  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    let state: HiveState = engine.initialState({ startingPlayer: gameIndex % 2 === 0 ? "white" : "black" });
    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (state.winner) break;
      const legalMoves = engine.legalMoves(state);
      const agent = state.currentPlayer === "white" ? whiteAgent : blackAgent;
      const move: HiveMove = agent.selectMove(state, legalMoves, { seed: gameIndex * 100 + turn });
      state = engine.applyMoveUnchecked(state, move);
    }

    results.push({
      gameIndex,
      startingPlayer: gameIndex % 2 === 0 ? "white" : "black",
      turns: state.turn,
      winner: state.winner,
      winReason: state.winReason
    });
  }

  setHiveEngineProfileSink(undefined);

  const summary: ProfileSummary = {
    runId,
    startedAtIso,
    completedAtIso: new Date().toISOString(),
    config: {
      games,
      maxTurns,
      depth,
      useTranspositionTable,
      profiledRunId
    },
    results,
    counters: profiler.counterSummary(),
    timings: profiler.timingSummary()
  };

  await writeJson(path.join(runDir, "summary.json"), summary);

  console.log(`Hive profile completed: ${runDir}`);
  console.log(`Profiled run weights: ${profiledRunId ?? "unknown"}`);
  for (const timing of summary.timings.slice(0, 10)) {
    console.log(`${timing.name}: total=${timing.totalMs.toFixed(2)}ms calls=${timing.calls} avg=${timing.avgMs.toFixed(4)}ms`);
  }
  console.log(`Counters: ${JSON.stringify(summary.counters)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
