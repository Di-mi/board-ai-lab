import dotenv from "dotenv";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { HiveEngine, type HiveMove, type HiveState, type Player, type TerminalReason } from "@board-ai-lab/hive-engine";
import { RandomHiveAgent } from "@board-ai-lab/hive-play";
import { HiveHeuristicAgent, normalizeHiveWeights, type HiveGenome, type HiveHeuristicWeights } from "@board-ai-lab/hive-ga";
import {
  HiveLlmMoveSelectionError,
  type HiveLLMMoveDecision,
  type HiveLlmDecisionAgent,
  OpenRouterHiveAgent,
  RandomHiveSimulator
} from "@board-ai-lab/agents-llm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

const artifactsDir = path.join(rootDir, "artifacts", "hive-llm-matches");
const hiveTrainingDir = path.join(rootDir, "artifacts", "hive-training");
const hiveBotTiersPath = path.join(hiveTrainingDir, "hive-bot-tiers.json");

interface HiveTierManifest {
  updatedAtIso?: string;
  latestRunId?: string;
  mediumRunId?: string;
  hardRunId?: string;
}

interface HiveLlmTurnLog {
  turn: number;
  player: Player;
  actor: "llm" | "heuristic";
  stateBefore: HiveState;
  legalMoves: HiveMove[];
  chosenMove: HiveMove;
  rawResponse?: string;
  prompt?: {
    system: string;
    user: string;
  };
  usage?: HiveLLMMoveDecision["usage"];
  finishReason?: string;
  latencyMs?: number;
  responseId?: string;
  responseModelId?: string;
  warnings?: unknown;
  error?: string;
}

interface HiveLlmMatchLog {
  matchId: string;
  seed: number;
  llmSide: Player;
  players: Record<Player, string>;
  startedAtIso: string;
  completedAtIso?: string;
  status: "running" | "completed" | "error";
  currentState: HiveState;
  turns: HiveLlmTurnLog[];
  llmLatencyMsTotal: number;
  llmMoveCount: number;
  winner?: Player | "draw";
  winReason?: TerminalReason | "turn-limit-draw";
  error?: string;
}

interface HiveLlmSessionLog {
  sessionId: string;
  status: "running" | "completed" | "error";
  startedAtIso: string;
  updatedAtIso: string;
  completedAtIso?: string;
  provider: "openrouter" | "simulator";
  modelId: string;
  opponentRunId: string;
  config: {
    opponentMode: string;
    opponentDepth: number;
    gameCount: number;
    fixedLlmSide?: Player;
    maxTurns: number;
    temperature: number;
    maxOutputTokens: number;
    jsonRetryCount: number;
    requestTimeoutMs: number;
    reasoningEffort?: string;
    reasoningMaxTokens?: number;
  };
  matches: HiveLlmMatchLog[];
  llmLatencyMsTotal: number;
  llmMoveCount: number;
  error?: string;
}

function createRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function readTierManifest(): Promise<HiveTierManifest> {
  try {
    const text = await readFile(hiveBotTiersPath, "utf8");
    return JSON.parse(text) as HiveTierManifest;
  } catch {
    return {};
  }
}

async function resolveLatestRunId(): Promise<string | undefined> {
  const entries = await readdir(hiveTrainingDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("hive-train-"))
    .map((entry) => entry.name)
    .sort()
    .reverse()[0];
}

async function loadWeights(runId: string): Promise<HiveHeuristicWeights> {
  const text = await readFile(path.join(hiveTrainingDir, runId, "best-genome.json"), "utf8");
  const parsed = JSON.parse(text) as HiveGenome;
  return normalizeHiveWeights(parsed.weights);
}

async function resolveOpponentRunId(mode: string): Promise<string> {
  const tiers = await readTierManifest();
  if (mode === "medium" && tiers.mediumRunId) return tiers.mediumRunId;
  if (mode === "hard" && tiers.hardRunId) return tiers.hardRunId;
  if (mode === "latest" && tiers.latestRunId) return tiers.latestRunId;

  const explicitRunId = process.env.HIVE_LLM_OPPONENT_RUN_ID;
  if (mode === "run" && explicitRunId) return explicitRunId;

  const fallback = explicitRunId ?? tiers.hardRunId ?? tiers.latestRunId ?? (await resolveLatestRunId());
  if (!fallback) {
    throw new Error("No Hive opponent run found. Train or pin a Hive bot first.");
  }
  return fallback;
}

function recomputeSessionTotals(session: HiveLlmSessionLog): void {
  session.llmLatencyMsTotal = session.matches.reduce((sum, match) => sum + match.llmLatencyMsTotal, 0);
  session.llmMoveCount = session.matches.reduce((sum, match) => sum + match.llmMoveCount, 0);
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      await worker(items[current] as T);
    }
  });
  await Promise.all(runners);
}

async function main(): Promise<void> {
  await ensureDir(artifactsDir);

  const opponentMode = process.env.HIVE_LLM_OPPONENT ?? "hard";
  const simulatorMode = process.env.HIVE_LLM_SIMULATOR === "random";
  const modelId = simulatorMode ? "simulator/random-hive" : process.env.HIVE_LLM_MODEL;
  if (!modelId) {
    throw new Error("Set HIVE_LLM_MODEL to an OpenRouter model id before running hive-llm-match.");
  }
  if (!simulatorMode && !process.env.OPENROUTER_API_KEY) {
    throw new Error("Set OPENROUTER_API_KEY before running hive-llm-match.");
  }

  const opponentRunId = opponentMode === "random" ? "random" : await resolveOpponentRunId(opponentMode);
  const opponentWeights = opponentMode === "random" ? undefined : await loadWeights(opponentRunId);

  const gameCount = Number(process.env.HIVE_LLM_GAMES ?? 4);
  const depth = Number(process.env.HIVE_LLM_OPPONENT_DEPTH ?? 2);
  const concurrency = Number(process.env.HIVE_LLM_CONCURRENCY ?? 1);
  const baseSeed = Number(process.env.HIVE_LLM_SEED ?? Date.now());
  const maxTurns = Number(process.env.HIVE_LLM_MAX_TURNS ?? 100);
  const fixedLlmSide = process.env.HIVE_LLM_SIDE === "white" || process.env.HIVE_LLM_SIDE === "black" ? process.env.HIVE_LLM_SIDE : undefined;
  const temperature = Number(process.env.HIVE_LLM_TEMPERATURE ?? 0);
  const maxOutputTokens = Number(process.env.HIVE_LLM_MAX_OUTPUT_TOKENS ?? 160);
  const jsonRetryCount = Number(process.env.HIVE_LLM_JSON_RETRIES ?? 2);
  const requestTimeoutMs = Number(process.env.HIVE_LLM_REQUEST_TIMEOUT_MS ?? 120000);
  const reasoningEffort = process.env.HIVE_LLM_REASONING_EFFORT;
  const reasoningMaxTokensValue = process.env.HIVE_LLM_REASONING_MAX_TOKENS;
  const reasoningMaxTokens = reasoningMaxTokensValue ? Number(reasoningMaxTokensValue) : undefined;

  const engine = new HiveEngine();
  const sessionId = createRunId("hive-llm-session");
  const sessionDir = path.join(artifactsDir, sessionId);
  await ensureDir(sessionDir);

  const createLlmAgent = (seed: number): HiveLlmDecisionAgent =>
    simulatorMode
      ? new RandomHiveSimulator(modelId, seed)
      : new OpenRouterHiveAgent({
          modelId,
          appName: "board-ai-lab",
          siteUrl: process.env.OPENROUTER_SITE_URL ?? "http://localhost:5175/hive",
          temperature,
          maxOutputTokens,
          jsonRetryCount,
          requestTimeoutMs,
          reasoning:
            reasoningEffort || typeof reasoningMaxTokens === "number"
              ? {
                  ...(reasoningEffort ? { effort: reasoningEffort as "none" | "minimal" | "low" | "medium" | "high" | "xhigh" } : {}),
                  ...(typeof reasoningMaxTokens === "number" ? { maxTokens: reasoningMaxTokens } : {})
                }
              : undefined
        });

  const createOpponentAgent = (seed: number) =>
    opponentMode === "random"
      ? new RandomHiveAgent("random-hive-opponent", seed)
      : new HiveHeuristicAgent(opponentWeights as HiveHeuristicWeights, depth, `${opponentMode}-${opponentRunId}`, undefined, false);

  const session: HiveLlmSessionLog = {
    sessionId,
    status: "running",
    startedAtIso: new Date().toISOString(),
    updatedAtIso: new Date().toISOString(),
    provider: simulatorMode ? "simulator" : "openrouter",
    modelId,
    opponentRunId,
    config: {
      opponentMode,
      opponentDepth: depth,
      gameCount,
      fixedLlmSide,
      maxTurns,
      temperature,
      maxOutputTokens,
      jsonRetryCount,
      requestTimeoutMs,
      reasoningEffort,
      reasoningMaxTokens
    },
    matches: [],
    llmLatencyMsTotal: 0,
    llmMoveCount: 0
  };

  for (let gameIndex = 0; gameIndex < gameCount; gameIndex += 1) {
    const llmSide = fixedLlmSide ?? (gameIndex % 2 === 0 ? "white" : "black");
    const seed = baseSeed + gameIndex * 1009;
    session.matches.push({
      matchId: `${sessionId}-game-${String(gameIndex + 1).padStart(2, "0")}`,
      seed,
      llmSide,
      players: {
        white: llmSide === "white" ? `llm:${modelId}` : `${opponentMode}:${opponentRunId}`,
        black: llmSide === "black" ? `llm:${modelId}` : `${opponentMode}:${opponentRunId}`
      },
      startedAtIso: new Date().toISOString(),
      status: "running",
      currentState: engine.initialState({ seed }),
      turns: [],
      llmLatencyMsTotal: 0,
      llmMoveCount: 0
    });
  }

  try {
    await runWithConcurrency(session.matches, concurrency, async (match) => {
      const llmAgent = createLlmAgent(match.seed);
      const opponentAgent = createOpponentAgent(match.seed ^ 0x9e3779b9);
      let state = match.currentState;

      try {
        for (let step = 0; step < maxTurns; step += 1) {
          if (state.winner) {
            match.winner = state.winner;
            match.winReason = state.winReason;
            break;
          }

          const legalMoves = engine.legalMoves(state);
          const stateBefore = structuredClone(state) as HiveState;
          const legalMovesSnapshot = legalMoves.map((move) => structuredClone(move) as HiveMove);

          if (state.currentPlayer === match.llmSide) {
            try {
              const decision = await llmAgent.selectMove(stateBefore, legalMovesSnapshot);
              const nextState = engine.applyMove(stateBefore, decision.move);
              match.llmLatencyMsTotal += decision.latencyMs;
              match.llmMoveCount += 1;
              match.turns.push({
                turn: state.turn,
                player: state.currentPlayer,
                actor: "llm",
                stateBefore,
                legalMoves: legalMovesSnapshot,
                chosenMove: decision.move,
                rawResponse: decision.rawText,
                prompt: {
                  system: decision.systemPrompt,
                  user: decision.userPrompt
                },
                usage: decision.usage,
                finishReason: decision.finishReason,
                latencyMs: decision.latencyMs,
                responseId: decision.responseId,
                responseModelId: decision.responseModelId,
                warnings: decision.warnings
              });
              state = nextState;
            } catch (error) {
              const selectionError = error instanceof HiveLlmMoveSelectionError ? error : null;
              match.turns.push({
                turn: state.turn,
                player: state.currentPlayer,
                actor: "llm",
                stateBefore,
                legalMoves: legalMovesSnapshot,
                chosenMove: legalMovesSnapshot[0] as HiveMove,
                rawResponse: selectionError?.rawText,
                prompt: selectionError
                  ? {
                      system: selectionError.systemPrompt,
                      user: selectionError.userPrompt
                    }
                  : undefined,
                finishReason: selectionError?.finishReason,
                latencyMs: selectionError?.latencyMs,
                responseId: selectionError?.responseId,
                responseModelId: selectionError?.responseModelId,
                warnings: selectionError?.warnings,
                error: error instanceof Error ? error.message : "Unknown Hive LLM error."
              });
              match.winner = state.currentPlayer === "white" ? "black" : "white";
              match.winReason = "no-moves";
              match.status = "error";
              match.error = error instanceof Error ? error.message : "Unknown Hive LLM error.";
              break;
            }
          } else {
            const chosenMove = opponentAgent.selectMove(stateBefore, legalMovesSnapshot, { seed: state.turn });
            state = engine.applyMove(stateBefore, chosenMove);
            match.turns.push({
              turn: stateBefore.turn,
              player: stateBefore.currentPlayer,
              actor: "heuristic",
              stateBefore,
              legalMoves: legalMovesSnapshot,
              chosenMove
            });
          }

          match.currentState = structuredClone(state) as HiveState;
          if (state.winner) {
            match.winner = state.winner;
            match.winReason = state.winReason;
            break;
          }
        }

        if (!match.winner && match.status !== "error") {
          match.winner = "draw";
          match.winReason = "turn-limit-draw";
        }
        if (match.status !== "error") {
          match.status = "completed";
        } else {
          session.status = "error";
          session.error = match.error;
        }
        match.currentState = structuredClone(state) as HiveState;
        match.completedAtIso = new Date().toISOString();
        await writeJson(path.join(sessionDir, `${match.matchId}.json`), match);
        recomputeSessionTotals(session);
        session.updatedAtIso = new Date().toISOString();
      } catch (error) {
        match.status = "error";
        match.error = error instanceof Error ? error.message : "Unknown match error.";
        match.completedAtIso = new Date().toISOString();
        session.status = "error";
        session.error = match.error;
        await writeJson(path.join(sessionDir, `${match.matchId}.json`), match);
        recomputeSessionTotals(session);
        session.updatedAtIso = new Date().toISOString();
      }
    });
  } finally {
    if (session.status !== "error") {
      session.status = "completed";
    }
    recomputeSessionTotals(session);
    session.updatedAtIso = new Date().toISOString();
    session.completedAtIso = new Date().toISOString();
    await writeJson(path.join(sessionDir, "session.json"), session);
  }

  console.log(`Hive LLM session completed: ${sessionDir}`);
  console.log(`Provider: ${session.provider}`);
  console.log(`Model: ${modelId}`);
  console.log(`Opponent: ${opponentMode === "random" ? "random" : opponentRunId}`);
  console.log(`LLM latency total: ${session.llmLatencyMsTotal}ms across ${session.llmMoveCount} moves`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
