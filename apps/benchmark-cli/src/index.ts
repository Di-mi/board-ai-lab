import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HeuristicAgent, trainHeuristic, type Genome, type HeuristicWeights, type TrainingReplay } from "@board-ai-lab/agents-ga";
import { LlmMoveSelectionError, OpenRouterOnitamaAgent, RandomOnitamaSimulator, type LlmDecisionAgent, type OpenRouterAgentConfig } from "@board-ai-lab/agents-llm";
import { RandomAgent } from "@board-ai-lab/agents-random";
import { OnitamaEngine, stateHash, type Agent, type GameState, type Move, type Player } from "@board-ai-lab/onitama-engine";
import { exportPublicBenchmarks } from "./public-site.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });
const trainingDir = path.resolve(rootDir, "artifacts", "training");
const benchmarkDir = path.resolve(rootDir, "artifacts", "benchmark");
const llmMatchesDir = path.resolve(rootDir, "artifacts", "llm-matches");
const hiveLlmMatchesDir = path.resolve(rootDir, "artifacts", "hive-llm-matches");
const llmMatchesDbPath = path.join(llmMatchesDir, "llm-matches.sqlite");
const reportsDir = path.resolve(rootDir, "artifacts", "reports");
const humanScoreboardDir = path.resolve(rootDir, "artifacts", "human-scoreboard");
const playgroundPublicDir = path.resolve(rootDir, "apps", "playground", "public");
const publicSitePublicDir = path.resolve(rootDir, "apps", "public-site", "public");
const publicSiteDataPath = path.resolve(rootDir, "apps", "public-site", "public", "data", "public-benchmarks.json");
const playgroundHiveTrainingManifestPath = path.join(playgroundPublicDir, "hive-training-manifest.json");
const playgroundHiveBotTiersPath = path.join(playgroundPublicDir, "hive-bot-tiers.json");
const publicSiteHiveTrainingManifestPath = path.join(publicSitePublicDir, "hive-training-manifest.json");
const publicSiteHiveBotTiersPath = path.join(publicSitePublicDir, "hive-bot-tiers.json");
const engine = new OnitamaEngine();
type ReasoningEffort = NonNullable<NonNullable<OpenRouterAgentConfig["reasoning"]>["effort"]>;

interface MatchRecord {
  white: string;
  black: string;
  winner?: Player;
  turns: number;
}

interface LeaderboardEntry {
  name: string;
  elo: number;
  wins: number;
  draws: number;
  losses: number;
  games: number;
}

interface HumanScoreEntry {
  id: string;
  recordedAtIso: string;
  humanPlayer: string;
  result: "win" | "loss" | "draw";
  moveCount: number;
  humanSide?: Player;
  trainedRunId: string;
  trainedGenomePath: string;
  notes?: string;
}

interface HumanScoreboard {
  updatedAtIso: string;
  totals: {
    wins: number;
    losses: number;
    draws: number;
    games: number;
  };
  entries: HumanScoreEntry[];
}

async function ensureDirs(): Promise<void> {
  await mkdir(trainingDir, { recursive: true });
  await mkdir(benchmarkDir, { recursive: true });
  await mkdir(llmMatchesDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  await mkdir(humanScoreboardDir, { recursive: true });
  await mkdir(playgroundPublicDir, { recursive: true });
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function sameMove(a: Move, b: Move): boolean {
  return (
    a.card === b.card &&
    a.from.x === b.from.x &&
    a.from.y === b.from.y &&
    a.to.x === b.to.x &&
    a.to.y === b.to.y
  );
}

function gradeMove(
  scoredMoves: Array<{ move: Move; score: number }>,
  chosenMove: Move
): LlmTurnLog["grade"] {
  const legalMoveCount = scoredMoves.length;
  const ranked = scoredMoves.findIndex((entry) => sameMove(entry.move, chosenMove));
  const chosenEntry = scoredMoves[ranked] ?? scoredMoves[scoredMoves.length - 1];
  const bestEntry = scoredMoves[0];
  if (!chosenEntry || !bestEntry || ranked === -1) {
    return undefined;
  }

  const rank = ranked + 1;
  let letter: "A" | "B" | "C" | "D" | "F" = "F";
  if (rank === 1) letter = "A";
  else if (rank <= Math.max(2, Math.ceil(legalMoveCount * 0.25))) letter = "B";
  else if (rank <= Math.max(3, Math.ceil(legalMoveCount * 0.5))) letter = "C";
  else if (rank <= Math.max(4, Math.ceil(legalMoveCount * 0.75))) letter = "D";

  return {
    letter,
    rank,
    legalMoveCount,
    chosenScore: chosenEntry.score,
    bestScore: bestEntry.score,
    scoreDeltaFromBest: bestEntry.score - chosenEntry.score,
    recommendedMove: bestEntry.move
  };
}

const llmDbSchemaSql = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS llm_sessions (
    session_id TEXT PRIMARY KEY,
    started_at_iso TEXT NOT NULL,
    updated_at_iso TEXT NOT NULL,
    status TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    training_run_id TEXT NOT NULL,
    opponent_run_id TEXT NOT NULL,
    llm_latency_ms_total INTEGER NOT NULL,
    llm_move_count INTEGER NOT NULL,
    error TEXT,
    session_dir TEXT NOT NULL,
    raw_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS llm_matches (
    match_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seed INTEGER NOT NULL,
    llm_side TEXT NOT NULL,
    red_player TEXT NOT NULL,
    blue_player TEXT NOT NULL,
    started_at_iso TEXT NOT NULL,
    winner TEXT,
    win_reason TEXT,
    status TEXT NOT NULL,
    llm_latency_ms_total INTEGER NOT NULL,
    llm_move_count INTEGER NOT NULL,
    error TEXT,
    current_state_json TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES llm_sessions(session_id)
  );
  CREATE TABLE IF NOT EXISTS llm_turns (
    match_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    turn_number INTEGER NOT NULL,
    player TEXT NOT NULL,
    actor TEXT NOT NULL,
    state_hash_before TEXT NOT NULL,
    state_hash_after TEXT NOT NULL,
    state_before_json TEXT NOT NULL,
    legal_moves_json TEXT NOT NULL,
    chosen_move_json TEXT NOT NULL,
    raw_response TEXT,
    prompt_system TEXT,
    prompt_user TEXT,
    usage_json TEXT,
    finish_reason TEXT,
    latency_ms INTEGER,
    response_id TEXT,
    response_model_id TEXT,
    warnings_json TEXT,
    grade_letter TEXT,
    grade_rank INTEGER,
    grade_legal_move_count INTEGER,
    grade_chosen_score REAL,
    grade_best_score REAL,
    grade_delta_from_best REAL,
    grade_recommended_move_json TEXT,
    error TEXT,
    raw_json TEXT NOT NULL,
    PRIMARY KEY (match_id, turn_index),
    FOREIGN KEY (match_id) REFERENCES llm_matches(match_id)
  );
`;

let llmDbReady = false;

function openLlmDb(): DatabaseSync {
  return new DatabaseSync(llmMatchesDbPath);
}

async function ensureLlmDatabase(): Promise<void> {
  if (llmDbReady) return;

  try {
    await access(llmMatchesDbPath);
    llmDbReady = true;
    return;
  } catch {
    const db = openLlmDb();
    try {
      db.exec(llmDbSchemaSql);
      llmDbReady = true;
    } finally {
      db.close();
    }
  }
}

function upsertLlmSessionRow(db: DatabaseSync, sessionDir: string, session: LlmSessionLog): void {
  db.prepare(`
    INSERT INTO llm_sessions (
      session_id, started_at_iso, updated_at_iso, status, provider, model_id,
      training_run_id, opponent_run_id, llm_latency_ms_total, llm_move_count,
      error, session_dir, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      updated_at_iso = excluded.updated_at_iso,
      status = excluded.status,
      llm_latency_ms_total = excluded.llm_latency_ms_total,
      llm_move_count = excluded.llm_move_count,
      error = excluded.error,
      session_dir = excluded.session_dir,
      raw_json = excluded.raw_json
  `).run(
    session.sessionId,
    session.startedAtIso,
    session.updatedAtIso,
    session.status,
    session.provider,
    session.modelId,
    session.trainingRunId,
    session.opponentRunId,
    session.llmLatencyMsTotal,
    session.llmMoveCount,
    session.error ?? null,
    sessionDir,
    JSON.stringify(session)
  );
}

function persistLlmMatchToDatabase(sessionDir: string, session: LlmSessionLog, match: LlmMatchLog): void {
  const db = openLlmDb();

  try {
    upsertLlmSessionRow(db, sessionDir, session);
    db.prepare("DELETE FROM llm_turns WHERE match_id = ?").run(match.matchId);
    db.prepare("DELETE FROM llm_matches WHERE match_id = ?").run(match.matchId);

    db.prepare(`
      INSERT INTO llm_matches (
        match_id, session_id, seed, llm_side, red_player, blue_player, started_at_iso,
        winner, win_reason, status, llm_latency_ms_total, llm_move_count, error,
        current_state_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      match.matchId,
      session.sessionId,
      match.seed,
      match.llmSide,
      match.players.red,
      match.players.blue,
      match.startedAtIso,
      match.winner ?? null,
      match.winReason ?? null,
      match.status,
      match.llmLatencyMsTotal,
      match.llmMoveCount,
      match.error ?? null,
      JSON.stringify(match.currentState),
      JSON.stringify(match)
    );

    const turnStmt = db.prepare(`
      INSERT INTO llm_turns (
        match_id, turn_index, turn_number, player, actor, state_hash_before, state_hash_after,
        state_before_json, legal_moves_json, chosen_move_json, raw_response, prompt_system,
        prompt_user, usage_json, finish_reason, latency_ms, response_id, response_model_id,
        warnings_json, grade_letter, grade_rank, grade_legal_move_count, grade_chosen_score,
        grade_best_score, grade_delta_from_best, grade_recommended_move_json, error, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [turnIndex, turn] of match.turns.entries()) {
      turnStmt.run(
        match.matchId,
        turnIndex,
        turn.turn,
        turn.player,
        turn.actor,
        turn.stateHashBefore,
        turn.stateHashAfter,
        JSON.stringify(turn.stateBefore),
        JSON.stringify(turn.legalMoves),
        JSON.stringify(turn.chosenMove),
        turn.rawResponse ?? null,
        turn.prompt?.system ?? null,
        turn.prompt?.user ?? null,
        turn.usage ? JSON.stringify(turn.usage) : null,
        turn.finishReason ?? null,
        turn.latencyMs ?? null,
        turn.responseId ?? null,
        turn.responseModelId ?? null,
        turn.warnings ? JSON.stringify(turn.warnings) : null,
        turn.grade?.letter ?? null,
        turn.grade?.rank ?? null,
        turn.grade?.legalMoveCount ?? null,
        turn.grade?.chosenScore ?? null,
        turn.grade?.bestScore ?? null,
        turn.grade?.scoreDeltaFromBest ?? null,
        turn.grade ? JSON.stringify(turn.grade.recommendedMove) : null,
        turn.error ?? null,
        JSON.stringify(turn)
      );
    }
  } finally {
    db.close();
  }
}

function persistLlmSessionSummaryToDatabase(sessionDir: string, session: LlmSessionLog): void {
  const db = openLlmDb();
  try {
    upsertLlmSessionRow(db, sessionDir, session);
  } finally {
    db.close();
  }
}

function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

function updateElo(
  table: Map<string, LeaderboardEntry>,
  a: string,
  b: string,
  scoreA: number,
  scoreB: number,
  k = 20
): void {
  const entryA = table.get(a);
  const entryB = table.get(b);
  if (!entryA || !entryB) return;

  const expA = expectedScore(entryA.elo, entryB.elo);
  const expB = expectedScore(entryB.elo, entryA.elo);
  entryA.elo += k * (scoreA - expA);
  entryB.elo += k * (scoreB - expB);
}

async function listCompletedTrainingRunDirs(): Promise<string[]> {
  const entries = await readdir(trainingDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("train-"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const completeRunDirs: string[] = [];
  for (const runId of dirs) {
    const runDir = path.join(trainingDir, runId);
    try {
      await readFile(path.join(runDir, "best-genome.json"), "utf8");
      completeRunDirs.push(runDir);
    } catch {
      // Skip incomplete runs.
    }
  }

  return completeRunDirs;
}

async function loadHumanScoreboard(): Promise<HumanScoreboard> {
  const scoreboardPath = path.join(humanScoreboardDir, "scoreboard.json");
  try {
    const text = await readFile(scoreboardPath, "utf8");
    return JSON.parse(text) as HumanScoreboard;
  } catch {
    return {
      updatedAtIso: new Date(0).toISOString(),
      totals: {
        wins: 0,
        losses: 0,
        draws: 0,
        games: 0
      },
      entries: []
    };
  }
}

function computeHumanTotals(entries: HumanScoreEntry[]): HumanScoreboard["totals"] {
  const totals = {
    wins: 0,
    losses: 0,
    draws: 0,
    games: entries.length
  };

  for (const entry of entries) {
    if (entry.result === "win") totals.wins += 1;
    if (entry.result === "loss") totals.losses += 1;
    if (entry.result === "draw") totals.draws += 1;
  }

  return totals;
}

async function saveHumanScoreboard(entries: HumanScoreEntry[]): Promise<string> {
  const scoreboardPath = path.join(humanScoreboardDir, "scoreboard.json");
  const payload: HumanScoreboard = {
    updatedAtIso: new Date().toISOString(),
    totals: computeHumanTotals(entries),
    entries
  };
  await writeJson(scoreboardPath, payload);
  await writeJson(path.join(playgroundPublicDir, "human-scoreboard.json"), payload);
  return scoreboardPath;
}

interface TrainingManifestEntry {
  runId: string;
  createdAtIso: string;
  bestGenomePath: string;
  fitness: number;
  weights: HeuristicWeights;
}

interface TrainingReviewEntry {
  kind: "longest" | "shortest-decisive" | "rivalry";
  label: string;
  replay: TrainingReplay;
}

interface TrainingReviewPayload {
  runId: string;
  createdAtIso: string;
  matches: TrainingReviewEntry[];
}

interface LlmTurnLog {
  turn: number;
  player: Player;
  actor: "llm" | "heuristic";
  stateBefore: GameState;
  legalMoves: Move[];
  chosenMove: Move;
  stateHashBefore: string;
  stateHashAfter: string;
  rawResponse?: string;
  prompt?: {
    system: string;
    user: string;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  latencyMs?: number;
  responseId?: string;
  responseModelId?: string;
  warnings?: unknown;
  grade?: {
    letter: "A" | "B" | "C" | "D" | "F";
    rank: number;
    legalMoveCount: number;
    chosenScore: number;
    bestScore: number;
    scoreDeltaFromBest: number;
    recommendedMove: Move;
  };
  error?: string;
}

interface LlmMatchLog {
  matchId: string;
  seed: number;
  players: {
    red: string;
    blue: string;
  };
  llmSide: Player;
  startedAtIso: string;
  currentState: GameState;
  turns: LlmTurnLog[];
  winner?: Player;
  winReason?: string;
  status: "running" | "completed" | "error";
  llmLatencyMsTotal: number;
  llmMoveCount: number;
  error?: string;
}

interface LlmSessionLog {
  sessionId: string;
  status: "running" | "completed" | "error";
  startedAtIso: string;
  updatedAtIso: string;
  provider: "openrouter" | "simulator";
  modelId: string;
  trainingRunId: string;
  opponentRunId: string;
  config: {
    temperature: number;
    maxOutputTokens: number;
    opponentDepth: number;
    opponentMode: "trained" | "random";
    graderRunId?: string;
    gameCount: number;
    concurrency: number;
    fixedLlmSide?: Player;
    jsonRetryCount: number;
    requestTimeoutMs?: number;
    reasoningEffort?: string;
    reasoningMaxTokens?: number;
  };
  matches: LlmMatchLog[];
  llmLatencyMsTotal: number;
  llmMoveCount: number;
  error?: string;
}

function recomputeLlmSessionTotals(session: LlmSessionLog): void {
  session.llmLatencyMsTotal = session.matches.reduce((sum, match) => sum + match.llmLatencyMsTotal, 0);
  session.llmMoveCount = session.matches.reduce((sum, match) => sum + match.llmMoveCount, 0);
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const width = Math.max(1, Math.min(limit, items.length));

  async function runWorker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      await worker(items[current] as T, current);
    }
  }

  await Promise.all(Array.from({ length: width }, () => runWorker()));
}

async function writeTrainingManifest(): Promise<void> {
  const manifest: TrainingManifestEntry[] = [];
  const runDirs = await listCompletedTrainingRunDirs();

  for (const runDir of runDirs) {
    const runId = path.basename(runDir);
    const bestGenomePath = path.join(runDir, "best-genome.json");

    try {
      const bestGenomeText = await readFile(bestGenomePath, "utf8");
      const bestGenome = JSON.parse(bestGenomeText) as Genome;
      const createdAtIso = new Date(Number(runId.replace("train-", ""))).toISOString();
      manifest.push({
        runId,
        createdAtIso,
        bestGenomePath: path.relative(playgroundPublicDir, bestGenomePath),
        fitness: bestGenome.fitness,
        weights: bestGenome.weights
      });
    } catch {
      // Skip malformed or incomplete runs.
    }
  }

  await writeJson(path.join(playgroundPublicDir, "training-manifest.json"), manifest);
}

async function resolveSelectedTrainingRunDir(): Promise<string | undefined> {
  const explicitRunDir = process.env.TRAINING_RUN_DIR;
  if (explicitRunDir) {
    return explicitRunDir;
  }

  const runDirs = await listCompletedTrainingRunDirs();
  return runDirs[0];
}

async function loadBestWeights(runDir?: string): Promise<HeuristicWeights | undefined> {
  const resolvedRunDir = runDir ?? (await resolveSelectedTrainingRunDir());
  if (!resolvedRunDir) return undefined;

  try {
    const bestText = await readFile(path.join(resolvedRunDir, "best-genome.json"), "utf8");
    const parsed = JSON.parse(bestText) as Genome;
    return parsed.weights;
  } catch {
    return undefined;
  }
}

async function loadChampionArchiveWeights(limit = 3, excludeRunDir?: string): Promise<HeuristicWeights[]> {
  const runDirs = await listCompletedTrainingRunDirs();
  const archiveRunDirs = runDirs.filter((runDir) => runDir !== excludeRunDir).slice(0, limit);
  const weights: HeuristicWeights[] = [];

  for (const runDir of archiveRunDirs) {
    const value = await loadBestWeights(runDir);
    if (value) {
      weights.push(value);
    }
  }

  return weights;
}

function selectReviewMatches(replays: TrainingReplay[]): TrainingReviewEntry[] {
  if (replays.length === 0) {
    return [];
  }

  const picks: TrainingReviewEntry[] = [];
  const usedReplayIds = new Set<string>();
  const addPick = (kind: TrainingReviewEntry["kind"], label: string, replay: TrainingReplay | undefined) => {
    if (!replay || usedReplayIds.has(replay.replayId)) {
      return;
    }
    usedReplayIds.add(replay.replayId);
    picks.push({ kind, label, replay });
  };

  const longest = [...replays].sort((a, b) => b.turns.length - a.turns.length)[0];
  addPick("longest", "Longest match", longest);

  const shortestDecisive = [...replays]
    .filter((replay) => replay.winner !== undefined)
    .sort((a, b) => a.turns.length - b.turns.length)[0];
  addPick("shortest-decisive", "Shortest decisive match", shortestDecisive);

  const rivalry = replays.find((replay) => {
    const players = [replay.players.red, replay.players.blue];
    return players.some((name) => name.includes("previous-champion") || name.includes("archive-") || name.includes("peer-"));
  });
  addPick("rivalry", "Rivalry match", rivalry);

  return picks;
}

async function writeTrainingReviewPayload(runId: string, replays: TrainingReplay[]): Promise<void> {
  const payload: TrainingReviewPayload = {
    runId,
    createdAtIso: new Date(Number(runId.replace("train-", ""))).toISOString(),
    matches: selectReviewMatches(replays)
  };

  await writeJson(path.join(playgroundPublicDir, "latest-training-review.json"), payload);
}

function opponent(player: Player): Player {
  return player === "red" ? "blue" : "red";
}

function playSingleGame(redAgent: Agent, blueAgent: Agent, maxTurns = 120): MatchRecord {
  let state = engine.initialState();

  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (state.winner) {
      return {
        white: "red",
        black: "blue",
        winner: state.winner,
        turns: turn
      };
    }

    const legal = engine.legalMoves(state);
    if (legal.length === 0) {
      return {
        white: "red",
        black: "blue",
        winner: opponent(state.currentPlayer),
        turns: turn
      };
    }

    const actor = state.currentPlayer === "red" ? redAgent : blueAgent;
    const move: Move = actor.selectMove(state, legal, { seed: turn });
    state = engine.applyMove(state, move);
  }

  return {
    white: "red",
    black: "blue",
    turns: maxTurns
  };
}

async function runTrain(): Promise<void> {
  await ensureDirs();
  const selectedRunDir = await resolveSelectedTrainingRunDir();
  const previousChampionWeights = await loadBestWeights(selectedRunDir);
  const championArchiveWeights = await loadChampionArchiveWeights(3, selectedRunDir);
  const runId = createRunId("train");
  const runDir = path.join(trainingDir, runId);
  await mkdir(runDir, { recursive: true });
  const trainingConfig = {
    initialWeights: previousChampionWeights,
    previousChampionWeights,
    championArchiveWeights,
    populationSize: Number(process.env.GA_POPULATION ?? 64),
    generations: Number(process.env.GA_GENERATIONS ?? 40),
    elitismCount: Number(process.env.GA_ELITISM ?? 6),
    gamesPerGenome: Number(process.env.GA_GAMES ?? 8),
    searchDepth: Number(process.env.GA_DEPTH ?? 1),
    useRandomOpponents: process.env.GA_USE_RANDOM !== "0",
    usePeerOpponents: process.env.GA_USE_PEERS !== "0",
    useChampionArchive: process.env.GA_USE_ARCHIVE !== "0",
    seed: Number(process.env.GA_SEED ?? 42)
  };

  const result = trainHeuristic(
    trainingConfig,
    async (generation, population) => {
      const best = population[0] as Genome;
      await writeJson(path.join(runDir, `checkpoint-g${generation}.json`), {
        generation,
        best
      });
    }
  );

  await writeJson(path.join(runDir, "best-genome.json"), result.bestGenome);
  await writeJson(path.join(runDir, "history.json"), result.history);
  await writeJson(path.join(runDir, "last-10-games.json"), result.recentGames);
  await writeJson(path.join(runDir, "meta.json"), {
    runId,
    trainingConfig: {
      ...trainingConfig,
      hasPreviousChampion: Boolean(previousChampionWeights),
      championArchiveSize: championArchiveWeights.length,
      hasPeerPool: trainingConfig.usePeerOpponents
    }
  });

  const recentGamesDir = path.join(runDir, "last-10-games");
  await mkdir(recentGamesDir, { recursive: true });
  await Promise.all(
    result.recentGames.map((replay, idx) =>
      writeJson(path.join(recentGamesDir, `${String(idx + 1).padStart(2, "0")}-${replay.replayId}.json`), replay)
    )
  );
  await writeTrainingManifest();
  await writeTrainingReviewPayload(runId, result.recentGames);

  console.log(`Training completed: ${runDir}`);
  console.log(`Best fitness: ${result.bestGenome.fitness.toFixed(4)}`);
  console.log(`Last 10 training game replays: ${recentGamesDir}`);
}

async function runBenchmark(): Promise<void> {
  await ensureDirs();
  const runId = createRunId("benchmark");
  const runDir = path.join(benchmarkDir, runId);
  await mkdir(runDir, { recursive: true });

  const weights = await loadBestWeights();
  const random = new RandomAgent("random", 1001);
  const heuristic = new HeuristicAgent(weights, 1, "trained-heuristic");

  const participants = [
    { name: "random", agent: random },
    { name: "trained-heuristic", agent: heuristic }
  ];

  const gamesPerPair = Number(process.env.BENCH_GAMES_PER_PAIR ?? 24);
  const leaderboard = new Map<string, LeaderboardEntry>();
  for (const participant of participants) {
    leaderboard.set(participant.name, {
      name: participant.name,
      elo: 1200,
      wins: 0,
      draws: 0,
      losses: 0,
      games: 0
    });
  }

  const matches: Array<MatchRecord & { red: string; blue: string }> = [];

  for (let i = 0; i < participants.length; i += 1) {
    for (let j = i + 1; j < participants.length; j += 1) {
      const a = participants[i]!;
      const b = participants[j]!;

      for (let game = 0; game < gamesPerPair; game += 1) {
        const swap = game % 2 === 1;
        const red = swap ? b : a;
        const blue = swap ? a : b;
        const outcome = playSingleGame(red.agent, blue.agent);

        matches.push({ ...outcome, red: red.name, blue: blue.name });

        const redEntry = leaderboard.get(red.name)!;
        const blueEntry = leaderboard.get(blue.name)!;
        redEntry.games += 1;
        blueEntry.games += 1;

        if (outcome.winner === "red") {
          redEntry.wins += 1;
          blueEntry.losses += 1;
          updateElo(leaderboard, red.name, blue.name, 1, 0);
        } else if (outcome.winner === "blue") {
          blueEntry.wins += 1;
          redEntry.losses += 1;
          updateElo(leaderboard, red.name, blue.name, 0, 1);
        } else {
          redEntry.draws += 1;
          blueEntry.draws += 1;
          updateElo(leaderboard, red.name, blue.name, 0.5, 0.5);
        }
      }
    }
  }

  const table = [...leaderboard.values()].sort((x, y) => y.elo - x.elo);

  await writeJson(path.join(runDir, "matches.json"), matches);
  await writeJson(path.join(runDir, "leaderboard.json"), table);
  await writeJson(path.join(runDir, "meta.json"), {
    runId,
    gamesPerPair,
    participants: participants.map((item) => item.name),
    usedTrainedWeights: Boolean(weights)
  });

  console.log(`Benchmark completed: ${runDir}`);
  console.log(`Top agent: ${table[0]?.name} (Elo ${table[0]?.elo.toFixed(1)})`);
}

async function runLlmMatch(): Promise<void> {
  await ensureDirs();
  await ensureLlmDatabase();
  const opponentMode = process.env.LLM_OPPONENT === "random" ? "random" : "trained";
  const opponentRunDir = opponentMode === "trained" ? process.env.TRAINING_RUN_DIR ?? (await resolveSelectedTrainingRunDir()) : undefined;
  if (opponentMode === "trained" && !opponentRunDir) {
    throw new Error("No trained bot found. Train or select a champion first.");
  }

  const simulatorMode = process.env.LLM_SIMULATOR === "random";
  const modelId = simulatorMode ? "simulator/random" : process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error("Set LLM_MODEL to an OpenRouter model id before running llm-match.");
  }
  if (!simulatorMode && !process.env.OPENROUTER_API_KEY) {
    throw new Error("Set OPENROUTER_API_KEY before running llm-match.");
  }

  const opponentWeights = opponentRunDir ? await loadBestWeights(opponentRunDir) : undefined;
  if (opponentMode === "trained" && !opponentWeights) {
    throw new Error(`Could not load best-genome.json from ${opponentRunDir}.`);
  }
  const graderRunDir = process.env.LLM_GRADER_RUN_DIR ?? (await resolveSelectedTrainingRunDir());
  const graderWeights = graderRunDir ? await loadBestWeights(graderRunDir) : undefined;
  if (!graderWeights) {
    throw new Error("No trained grader bot found. Train or select a champion first.");
  }

  const sessionId = createRunId("llm-session");
  const sessionDir = path.join(llmMatchesDir, sessionId);
  await mkdir(sessionDir, { recursive: true });

  const gameCount = Number(process.env.LLM_GAMES ?? 2);
  const depth = Number(process.env.LLM_OPPONENT_DEPTH ?? 2);
  const concurrency = Number(process.env.LLM_CONCURRENCY ?? 3);
  const baseSeed = Number(process.env.LLM_SEED ?? Date.now());
  const fixedLlmSide = process.env.LLM_SIDE === "red" || process.env.LLM_SIDE === "blue" ? process.env.LLM_SIDE : undefined;
  const temperature = Number(process.env.LLM_TEMPERATURE ?? 0);
  const maxOutputTokens = Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 120);
  const jsonRetryCount = Number(process.env.LLM_JSON_RETRIES ?? 3);
  const requestTimeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 120000);
  const reasoningEffort = process.env.LLM_REASONING_EFFORT;
  const reasoningMaxTokensValue = process.env.LLM_REASONING_MAX_TOKENS;
  const reasoningMaxTokens = reasoningMaxTokensValue ? Number(reasoningMaxTokensValue) : undefined;

  const createLlmAgent = (seed: number): LlmDecisionAgent =>
    simulatorMode
      ? new RandomOnitamaSimulator(modelId, seed)
      : new OpenRouterOnitamaAgent({
          modelId,
          appName: "board-ai-lab",
          siteUrl: process.env.OPENROUTER_SITE_URL ?? "http://localhost:5174",
          temperature,
          maxOutputTokens,
          jsonRetryCount,
          requestTimeoutMs,
          reasoning:
            reasoningEffort || typeof reasoningMaxTokens === "number"
              ? {
                  ...(reasoningEffort ? { effort: reasoningEffort as ReasoningEffort } : {}),
                  ...(typeof reasoningMaxTokens === "number" ? { maxTokens: reasoningMaxTokens } : {})
                }
              : undefined
        });
  const createOpponentAgent = (seed: number): Agent =>
    opponentMode === "random"
      ? new RandomAgent("random-opponent", seed)
      : new HeuristicAgent(opponentWeights as HeuristicWeights, depth, `champion-${path.basename(opponentRunDir as string)}`);
  const createGraderAgent = (): HeuristicAgent | null =>
    new HeuristicAgent(graderWeights, depth, `grader-${path.basename(graderRunDir as string)}`);

  const session: LlmSessionLog = {
    sessionId,
    status: "running",
    startedAtIso: new Date().toISOString(),
    updatedAtIso: new Date().toISOString(),
    provider: simulatorMode ? "simulator" : "openrouter",
    modelId,
    trainingRunId: opponentMode === "trained" ? path.basename(opponentRunDir as string) : "random",
    opponentRunId: opponentMode === "trained" ? path.basename(opponentRunDir as string) : "random",
    config: {
      temperature,
      maxOutputTokens,
      opponentDepth: depth,
      opponentMode,
      graderRunId: path.basename(graderRunDir as string),
      gameCount,
      concurrency,
      fixedLlmSide,
      jsonRetryCount,
      requestTimeoutMs,
      reasoningEffort,
      reasoningMaxTokens
    },
    matches: [],
    llmLatencyMsTotal: 0,
    llmMoveCount: 0
  };
  const opponentLabel = opponentMode === "random" ? "random" : `champion:${path.basename(opponentRunDir as string)}`;
  for (let gameIndex = 0; gameIndex < gameCount; gameIndex += 1) {
    const llmSide = fixedLlmSide ?? (gameIndex % 2 === 0 ? "red" : "blue");
    const seed = baseSeed + gameIndex * 1009;
    session.matches.push({
      matchId: `${sessionId}-game-${String(gameIndex + 1).padStart(2, "0")}`,
      seed,
      players: {
        red: llmSide === "red" ? `llm:${modelId}` : opponentLabel,
        blue: llmSide === "blue" ? `llm:${modelId}` : opponentLabel
      },
      llmSide,
      startedAtIso: new Date().toISOString(),
      currentState: engine.initialState({ seed }),
      turns: [],
      status: "running",
      llmLatencyMsTotal: 0,
      llmMoveCount: 0
    });
  }
  try {
    await runWithConcurrency(session.matches, concurrency, async (match) => {
      const llmAgent = createLlmAgent(match.seed);
      const opponentAgent = createOpponentAgent(match.seed ^ 0x9e3779b9);
      const graderAgent = createGraderAgent();
      let state = match.currentState;

      try {
        for (let turn = 0; turn < 120; turn += 1) {
          if (state.winner) {
            match.winner = state.winner;
            match.winReason = state.winReason;
            break;
          }

          const legalMoves = engine.legalMoves(state);
          if (legalMoves.length === 0) {
            match.winner = opponent(state.currentPlayer);
            match.winReason = "captured-master";
            break;
          }

          const stateBefore = structuredClone(state) as GameState;
          const legalMovesSnapshot = legalMoves.map((move) => structuredClone(move) as Move);
          const stateHashBefore = stateHash(stateBefore);

          if (state.currentPlayer === match.llmSide) {
            try {
              const decision = await llmAgent.selectMove(stateBefore, legalMoves);
              const scoredMoves = graderAgent?.scoreMoves(stateBefore, legalMovesSnapshot);
              const grade = scoredMoves ? gradeMove(scoredMoves, decision.move) : undefined;
              const nextState = engine.applyMove(state, decision.move);
              match.llmLatencyMsTotal += decision.latencyMs;
              match.llmMoveCount += 1;
              match.turns.push({
                turn: state.turn,
                player: state.currentPlayer,
                actor: "llm",
                stateBefore,
                legalMoves: legalMovesSnapshot,
                chosenMove: decision.move,
                stateHashBefore,
                stateHashAfter: stateHash(nextState),
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
                warnings: decision.warnings,
                grade
              });
              state = nextState;
            } catch (error) {
              const selectionError = error instanceof LlmMoveSelectionError ? error : null;
              match.turns.push({
                turn: state.turn,
                player: state.currentPlayer,
                actor: "llm",
                stateBefore,
                legalMoves: legalMovesSnapshot,
                chosenMove: legalMovesSnapshot[0] as Move,
                stateHashBefore,
                stateHashAfter: stateHashBefore,
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
                error: error instanceof Error ? error.message : "Unknown LLM error."
              });
              match.winner = opponent(match.llmSide);
              match.winReason = "captured-master";
              match.status = "error";
              match.error = error instanceof Error ? error.message : "Unknown LLM error.";
              break;
            }
          } else {
            const chosenMove = opponentAgent.selectMove(stateBefore, legalMovesSnapshot, { seed: state.turn });
            const nextState = engine.applyMove(state, chosenMove);
            match.turns.push({
              turn: state.turn,
              player: state.currentPlayer,
              actor: "heuristic",
              stateBefore,
              legalMoves: legalMovesSnapshot,
              chosenMove,
              stateHashBefore,
              stateHashAfter: stateHash(nextState)
            });
            state = nextState;
          }

          match.currentState = structuredClone(state) as GameState;
          if (state.winner) {
            match.winner = state.winner;
            match.winReason = state.winReason;
            break;
          }
        }

        if (match.status !== "error") {
          match.status = "completed";
        } else {
          session.status = "error";
          session.error = match.error;
        }
        match.currentState = structuredClone(state) as GameState;
        await writeJson(path.join(sessionDir, `${match.matchId}.json`), match);
        recomputeLlmSessionTotals(session);
        session.updatedAtIso = new Date().toISOString();
        persistLlmMatchToDatabase(sessionDir, session, match);
        persistLlmSessionSummaryToDatabase(sessionDir, session);
      } catch (error) {
        match.status = "error";
        match.error = error instanceof Error ? error.message : "Unknown match error.";
        session.status = "error";
        session.error = match.error;
        await writeJson(path.join(sessionDir, `${match.matchId}.json`), match);
        recomputeLlmSessionTotals(session);
        session.updatedAtIso = new Date().toISOString();
        persistLlmMatchToDatabase(sessionDir, session, match);
        persistLlmSessionSummaryToDatabase(sessionDir, session);
      }
    });
  } finally {
    if (session.status !== "error") {
      session.status = "completed";
    }
    recomputeLlmSessionTotals(session);
    session.updatedAtIso = new Date().toISOString();
    await writeJson(path.join(sessionDir, "session.json"), session);
    persistLlmSessionSummaryToDatabase(sessionDir, session);
  }

  console.log(`LLM session completed: ${sessionDir}`);
  console.log(`Provider: ${session.provider}`);
  console.log(`Model: ${modelId}`);
  console.log(`Opponent: ${opponentMode === "random" ? "random" : path.basename(opponentRunDir as string)}`);
  console.log(`Grader: ${path.basename(graderRunDir as string)}`);
  console.log(`LLM latency total: ${session.llmLatencyMsTotal}ms across ${session.llmMoveCount} moves`);
  console.log(`LLM database: ${llmMatchesDbPath}`);
}

async function findLatestBenchmarkRunDir(): Promise<string | undefined> {
  const entries = await readdir(benchmarkDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("benchmark-"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  if (!dirs[0]) return undefined;
  return path.join(benchmarkDir, dirs[0]);
}

async function runReport(): Promise<void> {
  await ensureDirs();
  const reportPath = path.join(reportsDir, "latest-training.md");

  const benchmarkRunDir = process.env.BENCHMARK_RUN_DIR ?? (await findLatestBenchmarkRunDir());
  const trainingRunDir = process.env.TRAINING_RUN_DIR ?? (await resolveSelectedTrainingRunDir());

  let report = "# Benchmark Report\n\n";

  if (benchmarkRunDir) {
    const leaderboardText = await readFile(path.join(benchmarkRunDir, "leaderboard.json"), "utf8");
    const table = JSON.parse(leaderboardText) as LeaderboardEntry[];

    report += "## Leaderboard\n\n";
    report += "| Agent | Elo | W | D | L | Games |\n";
    report += "| --- | ---: | ---: | ---: | ---: | ---: |\n";
    for (const row of table) {
      report += `| ${row.name} | ${row.elo.toFixed(1)} | ${row.wins} | ${row.draws} | ${row.losses} | ${row.games} |\n`;
    }
    report += "\n";
  } else {
    report += "No benchmark artifacts found yet.\n\n";
  }

  if (trainingRunDir) {
    try {
      const bestText = await readFile(path.join(trainingRunDir, "best-genome.json"), "utf8");
      const best = JSON.parse(bestText) as Genome;
      report += `## Best Trained Genome\n\nFitness: ${best.fitness.toFixed(4)}\n\n`;
      report += `\`\`\`json\n${JSON.stringify(best.weights, null, 2)}\n\`\`\`\n`;
    } catch {
      report += "## Best Trained Genome\n\nCould not read best-genome.json\n";
    }
  }

  await writeFile(reportPath, report, "utf8");
  console.log(`Report written: ${reportPath}`);
}

async function runRecordHumanResult(): Promise<void> {
  await ensureDirs();
  const trainingRunDir = process.env.TRAINING_RUN_DIR ?? (await resolveSelectedTrainingRunDir());
  if (!trainingRunDir) {
    throw new Error("No training run found to associate with the human result.");
  }

  const trainedRunId = path.basename(trainingRunDir);
  const moveCount = Number(process.env.HUMAN_MOVES ?? 10);
  const result = (process.env.HUMAN_RESULT ?? "win") as HumanScoreEntry["result"];
  const humanPlayer = process.env.HUMAN_PLAYER ?? "dimi";
  const humanSideValue = process.env.HUMAN_SIDE;
  const humanSide = humanSideValue === "red" || humanSideValue === "blue" ? humanSideValue : undefined;
  const notes = process.env.HUMAN_NOTES ?? "Manual entry recorded from playground session.";

  const scoreboard = await loadHumanScoreboard();
  const entry: HumanScoreEntry = {
    id: createRunId("human"),
    recordedAtIso: new Date().toISOString(),
    humanPlayer,
    result,
    moveCount,
    humanSide,
    trainedRunId,
    trainedGenomePath: path.join(trainingRunDir, "best-genome.json"),
    notes
  };

  const entries = [...scoreboard.entries, entry];
  const scoreboardPath = await saveHumanScoreboard(entries);

  console.log(`Human result recorded: ${scoreboardPath}`);
  console.log(`${humanPlayer} ${result} vs ${trainedRunId} in ${moveCount} moves`);
}

async function runExportPublicSite(): Promise<void> {
  const payload = await exportPublicBenchmarks({
    llmMatchesDir,
    hiveLlmMatchesDir,
    outputPath: publicSiteDataPath
  });

  try {
    await copyFile(playgroundHiveTrainingManifestPath, publicSiteHiveTrainingManifestPath);
    await copyFile(playgroundHiveBotTiersPath, publicSiteHiveBotTiersPath);
  } catch {
    // Hive play page can still render easy mode without pinned manifests.
  }

  console.log(`Public site data written: ${publicSiteDataPath}`);
  console.log(`Exported ${payload.records.length} records across ${payload.models.length} models`);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "train") {
    await runTrain();
    return;
  }
  if (command === "benchmark") {
    await runBenchmark();
    return;
  }
  if (command === "llm-match") {
    await runLlmMatch();
    return;
  }
  if (command === "report") {
    await runReport();
    return;
  }
  if (command === "record-human-result") {
    await runRecordHumanResult();
    return;
  }
  if (command === "export-public-site") {
    await runExportPublicSite();
    return;
  }

  console.log("Usage: pnpm --filter @board-ai-lab/benchmark-cli <train|benchmark|llm-match|report|record-human-result|export-public-site>");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
