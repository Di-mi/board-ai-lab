import dotenv from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { HiveEngine, type HiveState, type Player, type TerminalReason } from "@board-ai-lab/hive-engine";
import { HiveHeuristicAgent, normalizeHiveWeights, type HiveGenome, type HiveHeuristicWeights } from "@board-ai-lab/hive-ga";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

const hiveTrainingDir = path.resolve(rootDir, "artifacts", "hive-training");

type Side = Player;

interface HeadToHeadResult {
  gameIndex: number;
  seed: number;
  latestSide: Side;
  winner?: Player | "draw";
  winReason?: TerminalReason | "turn-limit-draw";
  turns: number;
}

async function loadWeights(runId: string): Promise<HiveHeuristicWeights> {
  const text = await readFile(path.join(hiveTrainingDir, runId, "best-genome.json"), "utf8");
  const parsed = JSON.parse(text) as HiveGenome;
  return normalizeHiveWeights(parsed.weights);
}

async function main(): Promise<void> {
  const latestRunId = process.env.HIVE_HEADTOHEAD_LATEST_RUN_ID ?? "hive-train-1774507376-depth2-parallel";
  const mediumRunId = process.env.HIVE_HEADTOHEAD_MEDIUM_RUN_ID ?? "hive-train-1774249511386-325b414d";
  const games = Number(process.env.HIVE_HEADTOHEAD_GAMES ?? 12);
  const depth = Number(process.env.HIVE_HEADTOHEAD_DEPTH ?? 2);
  const maxTurns = Number(process.env.HIVE_HEADTOHEAD_MAX_TURNS ?? 100);
  const seedBase = Number(process.env.HIVE_HEADTOHEAD_SEED_BASE ?? 9000);
  const runId = `hive-headtohead-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const outDir = path.join(hiveTrainingDir, runId);
  await mkdir(outDir, { recursive: true });

  const latestWeights = await loadWeights(latestRunId);
  const mediumWeights = await loadWeights(mediumRunId);
  const engine = new HiveEngine();
  const results: HeadToHeadResult[] = [];

  for (let i = 0; i < games; i += 1) {
    const latestSide: Side = i % 2 === 0 ? "white" : "black";
    const latest = new HiveHeuristicAgent(latestWeights, depth, "latest", undefined, false);
    const medium = new HiveHeuristicAgent(mediumWeights, depth, "medium", undefined, false);
    let state: HiveState = engine.initialState({ seed: seedBase + i, startingPlayer: "white" });

    for (let turn = 0; turn < maxTurns; turn += 1) {
      if (state.winner) break;
      const legal = engine.legalMoves(state);
      const actor = state.currentPlayer === latestSide ? latest : medium;
      const move = actor.selectMove(state, legal, { seed: i * 1000 + turn });
      state = engine.applyMove(state, move);
    }

    const finalWinner = state.winner ?? "draw";
    const finalWinReason = state.winner ? state.winReason : "turn-limit-draw";

    results.push({
      gameIndex: i,
      seed: seedBase + i,
      latestSide,
      winner: finalWinner,
      winReason: finalWinReason,
      turns: state.turn
    });
  }

  const summary = {
    runId,
    latestRunId,
    mediumRunId,
    depth,
    maxTurns,
    games,
    latestWins: results.filter((result) => result.winner === result.latestSide).length,
    mediumWins: results.filter((result) => result.winner && result.winner !== "draw" && result.winner !== result.latestSide).length,
    draws: results.filter((result) => result.winner === "draw").length,
    avgTurns: results.reduce((sum, result) => sum + result.turns, 0) / Math.max(1, results.length),
    results
  };

  await writeFile(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outDir, ...summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
