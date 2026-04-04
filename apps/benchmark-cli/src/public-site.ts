import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PublicBenchmarks {
  updatedAtIso: string;
  siteName: "Meeples & Models";
  games: Array<{
    id: string;
    label: string;
    status: "playable" | "coming-soon";
  }>;
  difficulties: Array<{
    id: string;
    label: string;
    description: string;
    sortOrder: number;
  }>;
  models: Array<{
    id: string;
    label: string;
    provider?: string;
    family?: string;
    status: "active";
  }>;
  records: PublicBenchmarkRecord[];
}

export interface PublicBenchmarkRecord {
  id: string;
  gameId: string;
  scoreModel: "onitama-v1" | "hive-v1";
  modelId: string;
  difficultyId: string;
  playedAtIso: string;
  scheduledGames: number;
  completedGames: number;
  wins: number;
  draws: number;
  losses: number;
  gradedMoveCount: number;
  moveQualitySum: number;
  latencySamplesMs: number[];
  avgLatencyPerMoveMs: number;
  maxTurns?: number;
  sideStats?: {
    white: PublicBenchmarkSideStats;
    black: PublicBenchmarkSideStats;
  };
  source: {
    kind: "llm-session";
    id: string;
  };
}

export interface PublicBenchmarkSideStats {
  scheduledGames: number;
  completedGames: number;
  wins: number;
  draws: number;
  losses: number;
  pointSum: number;
}

interface SessionTurn {
  actor: "llm" | "heuristic";
  latencyMs?: number;
  grade?: {
    rank: number;
    legalMoveCount: number;
  };
}

interface SessionMatch {
  status: "running" | "completed" | "error";
  winner?: "red" | "blue";
  llmSide: "red" | "blue";
  turns: SessionTurn[];
}

interface SessionLog {
  sessionId: string;
  status: "running" | "completed" | "error";
  updatedAtIso: string;
  provider: string;
  modelId: string;
  opponentRunId?: string;
  config: {
    gameCount: number;
    opponentDepth: number;
    opponentMode: "trained" | "random";
  };
  matches: SessionMatch[];
}

interface HiveLlmTurn {
  actor: "llm" | "heuristic";
  latencyMs?: number;
}

interface HiveLlmMatch {
  status: "running" | "completed" | "error";
  winner?: "white" | "black" | "draw";
  llmSide: "white" | "black";
  currentState?: {
    turn: number;
  };
  turns: HiveLlmTurn[];
  winReason?: string;
}

interface HiveLlmSessionLog {
  sessionId: string;
  status: "running" | "completed" | "error";
  updatedAtIso: string;
  provider: "openrouter" | "simulator";
  modelId: string;
  opponentRunId?: string;
  config: {
    opponentMode: string;
    opponentDepth: number;
    gameCount: number;
    fixedLlmSide?: "white" | "black";
    maxTurns: number;
  };
  matches: HiveLlmMatch[];
}

const PUBLIC_ONITAMA_BOT_RUN_IDS = {
  standard: new Set(["train-1772783009731"]),
  hard: new Set(["train-1772878297644"])
} as const;

const PUBLIC_HIVE_BOT_RUN_IDS = {
  standard: new Set(["hive-train-1774249511386-325b414d"]),
  hard: new Set(["hive-train-1774690000-splitpromo"])
} as const;

const PUBLIC_DIFFICULTIES = [
  {
    id: "easy",
    label: "Easy",
    description: "Random move bot",
    sortOrder: 1
  },
  {
    id: "standard",
    label: "Medium",
    description: "Smart genetic bot that a human can beat with a little effort/focus",
    sortOrder: 2
  },
  {
    id: "hard",
    label: "Hard",
    description: "Very smart genetic bot which is very hard to beat even for a human",
    sortOrder: 3
  }
] as const;

function prettifyToken(value: string): string {
  return value
    .replace(/:free$/i, "")
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (upper === "GPT" || upper === "AI" || upper === "LLM") return upper;
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function formatModelLabel(modelId: string): string {
  const [provider, name] = modelId.split("/", 2);
  if (!provider || !name) {
    return modelId;
  }

  const providerLabel = prettifyToken(provider);
  const nameLabel = prettifyToken(name);
  const normalizedProvider = providerLabel.toLowerCase();
  const normalizedName = nameLabel.toLowerCase();
  if (normalizedName === normalizedProvider) {
    return providerLabel;
  }
  if (normalizedName.startsWith(`${normalizedProvider} `)) {
    return nameLabel;
  }
  return `${providerLabel} ${nameLabel}`;
}

export function inferModelFamily(modelId: string): string | undefined {
  const [, name] = modelId.split("/", 2);
  if (!name) return undefined;
  const [family] = name.split("-");
  return family ? prettifyToken(family) : undefined;
}

export function inferDifficultyId(
  config: SessionLog["config"] | undefined,
  opponentRunId?: string
): "easy" | "standard" | "hard" | null {
  if (!config) {
    return null;
  }
  if (config.opponentMode === "random") {
    return "easy";
  }
  if (opponentRunId && PUBLIC_ONITAMA_BOT_RUN_IDS.standard.has(opponentRunId)) {
    return "standard";
  }
  if (opponentRunId && PUBLIC_ONITAMA_BOT_RUN_IDS.hard.has(opponentRunId)) {
    return "hard";
  }
  if (config.opponentMode === "trained" && config.opponentDepth <= 1) {
    return "standard";
  }
  if (config.opponentMode === "trained" && config.opponentDepth >= 2) {
    return "hard";
  }
  return null;
}

export function inferHiveDifficultyId(
  config: HiveLlmSessionLog["config"] | undefined,
  opponentRunId?: string
): "easy" | "standard" | "hard" | null {
  if (!config) {
    return null;
  }
  if (config.opponentMode === "random" || opponentRunId === "random") {
    return "easy";
  }
  if (config.opponentMode === "medium") {
    return "standard";
  }
  if (config.opponentMode === "hard") {
    return "hard";
  }
  if (opponentRunId && PUBLIC_HIVE_BOT_RUN_IDS.standard.has(opponentRunId)) {
    return "standard";
  }
  if (opponentRunId && PUBLIC_HIVE_BOT_RUN_IDS.hard.has(opponentRunId)) {
    return "hard";
  }
  if (config.opponentMode === "trained" && config.opponentDepth <= 1) {
    return "standard";
  }
  if (config.opponentMode === "trained" && config.opponentDepth >= 2) {
    return "hard";
  }
  return null;
}

export function computeNormalizedMoveQuality(rank: number, legalMoveCount: number): number {
  if (legalMoveCount <= 1) {
    return 1;
  }

  return 1 - (rank - 1) / (legalMoveCount - 1);
}

function summarizeResult(match: SessionMatch): "win" | "loss" | "draw" {
  if (!match.winner) return "draw";
  return match.winner === match.llmSide ? "win" : "loss";
}

function summarizeHiveResult(match: HiveLlmMatch): "win" | "loss" | "draw" {
  if (!match.winner || match.winner === "draw") return "draw";
  return match.winner === match.llmSide ? "win" : "loss";
}

function createEmptySideStats(): PublicBenchmarkSideStats {
  return {
    scheduledGames: 0,
    completedGames: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    pointSum: 0
  };
}

export function mapSessionToPublicRecord(
  session: SessionLog,
  log: (message: string) => void = () => {}
): PublicBenchmarkRecord | null {
  if (session.provider === "simulator" || session.modelId.startsWith("simulator/")) {
    log(`Skipping ${session.sessionId}: simulator session is not public benchmark data.`);
    return null;
  }

  if (session.status !== "completed") {
    return null;
  }

  if (!session.config) {
    log(`Skipping ${session.sessionId}: missing config.`);
    return null;
  }

  const difficultyId = inferDifficultyId(session.config, session.opponentRunId);
  if (!difficultyId) {
    log(`Skipping ${session.sessionId}: unsupported opponent difficulty mapping.`);
    return null;
  }

  const completedMatches = session.matches.filter((match) => match.status === "completed");
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let gradedMoveCount = 0;
  let moveQualitySum = 0;
  const latencySamplesMs: number[] = [];

  for (const match of completedMatches) {
    const result = summarizeResult(match);
    if (result === "win") wins += 1;
    if (result === "draw") draws += 1;
    if (result === "loss") losses += 1;

    for (const turn of match.turns) {
      if (turn.actor !== "llm") continue;
      if (typeof turn.latencyMs === "number") {
        latencySamplesMs.push(turn.latencyMs);
      }
      if (turn.grade) {
        gradedMoveCount += 1;
        moveQualitySum += computeNormalizedMoveQuality(turn.grade.rank, turn.grade.legalMoveCount);
      }
    }
  }

  if (completedMatches.length < 1 || gradedMoveCount < 1 || latencySamplesMs.length < 1) {
    log(`Skipping ${session.sessionId}: incomplete completed/graded/latency coverage.`);
    return null;
  }

  const avgLatencyPerMoveMs =
    latencySamplesMs.reduce((sum, value) => sum + value, 0) / latencySamplesMs.length;

  return {
    id: session.sessionId,
    gameId: "onitama",
    scoreModel: "onitama-v1",
    modelId: session.modelId,
    difficultyId,
    playedAtIso: session.updatedAtIso,
    scheduledGames: Math.max(session.config.gameCount, session.matches.length, completedMatches.length),
    completedGames: completedMatches.length,
    wins,
    draws,
    losses,
    gradedMoveCount,
    moveQualitySum,
    latencySamplesMs,
    avgLatencyPerMoveMs,
    source: {
      kind: "llm-session",
      id: session.sessionId
    }
  };
}

export function mapHiveSessionToPublicRecord(
  session: HiveLlmSessionLog,
  log: (message: string) => void = () => {}
): PublicBenchmarkRecord | null {
  if (session.provider === "simulator" || session.modelId.startsWith("simulator/")) {
    log(`Skipping ${session.sessionId}: simulator session is not public benchmark data.`);
    return null;
  }

  if (session.status !== "completed") {
    return null;
  }

  const difficultyId = inferHiveDifficultyId(session.config, session.opponentRunId);
  if (!difficultyId) {
    log(`Skipping ${session.sessionId}: unsupported Hive opponent difficulty mapping.`);
    return null;
  }

  const scheduledMatches = session.matches;
  const completedMatches = scheduledMatches.filter((match) => match.status === "completed");
  const sideStats = {
    white: createEmptySideStats(),
    black: createEmptySideStats()
  };
  let wins = 0;
  let draws = 0;
  let losses = 0;
  const latencySamplesMs: number[] = [];

  for (const match of scheduledMatches) {
    sideStats[match.llmSide].scheduledGames += 1;
  }

  for (const match of completedMatches) {
    const result = summarizeHiveResult(match);
    const side = sideStats[match.llmSide];
    const turnCount = Math.max(match.currentState?.turn ?? match.turns.length, 0);
    const maxTurns = Math.max(1, session.config.maxTurns);
    const point =
      result === "win"
        ? 1 + 0.25 * (1 - turnCount / maxTurns)
        : result === "draw"
          ? 0.45
          : 0;

    side.completedGames += 1;
    side.pointSum += point;
    if (result === "win") {
      wins += 1;
      side.wins += 1;
    }
    if (result === "draw") {
      draws += 1;
      side.draws += 1;
    }
    if (result === "loss") {
      losses += 1;
      side.losses += 1;
    }

    for (const turn of match.turns) {
      if (turn.actor !== "llm") continue;
      if (typeof turn.latencyMs === "number") {
        latencySamplesMs.push(turn.latencyMs);
      }
    }
  }

  if (completedMatches.length < 1 || latencySamplesMs.length < 1) {
    log(`Skipping ${session.sessionId}: incomplete completed/latency coverage.`);
    return null;
  }

  const avgLatencyPerMoveMs =
    latencySamplesMs.reduce((sum, value) => sum + value, 0) / latencySamplesMs.length;

  return {
    id: session.sessionId,
    gameId: "hive",
    scoreModel: "hive-v1",
    modelId: session.modelId,
    difficultyId,
    playedAtIso: session.updatedAtIso,
    scheduledGames: Math.max(session.config.gameCount, scheduledMatches.length),
    completedGames: completedMatches.length,
    wins,
    draws,
    losses,
    gradedMoveCount: 0,
    moveQualitySum: 0,
    latencySamplesMs,
    avgLatencyPerMoveMs,
    maxTurns: session.config.maxTurns,
    sideStats,
    source: {
      kind: "llm-session",
      id: session.sessionId
    }
  };
}

export function buildPublicBenchmarksPayload(
  onitamaSessions: SessionLog[],
  hiveSessions: HiveLlmSessionLog[],
  log: (message: string) => void = () => {}
): PublicBenchmarks {
  const records = [
    ...onitamaSessions.map((session) => mapSessionToPublicRecord(session, log)),
    ...hiveSessions.map((session) => mapHiveSessionToPublicRecord(session, log))
  ]
    .filter((record): record is PublicBenchmarkRecord => Boolean(record))
    .sort((a, b) => b.playedAtIso.localeCompare(a.playedAtIso));

  const modelIds = [...new Set(records.map((record) => record.modelId))].sort();
  const models = modelIds.map((modelId) => {
    const [provider] = modelId.split("/", 2);
    return {
      id: modelId,
      label: formatModelLabel(modelId),
      provider,
      family: inferModelFamily(modelId),
      status: "active" as const
    };
  });

  return {
    updatedAtIso: new Date().toISOString(),
    siteName: "Meeples & Models",
    games: [
      {
        id: "onitama",
        label: "Onitama",
        status: "playable"
      },
      {
        id: "hive",
        label: "Hive",
        status: "playable"
      }
    ],
    difficulties: [...PUBLIC_DIFFICULTIES],
    models,
    records
  };
}

export async function exportPublicBenchmarks(options: {
  llmMatchesDir: string;
  hiveLlmMatchesDir: string;
  outputPath: string;
  log?: (message: string) => void;
}): Promise<PublicBenchmarks> {
  const log = options.log ?? console.warn;
  const onitamaEntries = await readdir(options.llmMatchesDir, { withFileTypes: true });
  const onitamaSessions: SessionLog[] = [];

  for (const entry of onitamaEntries) {
    if (!entry.isDirectory()) continue;
    const sessionPath = path.join(options.llmMatchesDir, entry.name, "session.json");

    try {
      const text = await readFile(sessionPath, "utf8");
      onitamaSessions.push(JSON.parse(text) as SessionLog);
    } catch {
      log(`Skipping ${entry.name}: missing or unreadable session.json.`);
    }
  }

  const hiveEntries = await readdir(options.hiveLlmMatchesDir, { withFileTypes: true });
  const hiveSessions: HiveLlmSessionLog[] = [];

  for (const entry of hiveEntries) {
    if (!entry.isDirectory()) continue;
    const sessionPath = path.join(options.hiveLlmMatchesDir, entry.name, "session.json");

    try {
      const text = await readFile(sessionPath, "utf8");
      hiveSessions.push(JSON.parse(text) as HiveLlmSessionLog);
    } catch {
      log(`Skipping ${entry.name}: missing or unreadable session.json.`);
    }
  }

  const payload = buildPublicBenchmarksPayload(onitamaSessions, hiveSessions, log);
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}
