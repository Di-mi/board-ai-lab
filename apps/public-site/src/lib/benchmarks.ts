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

export interface Filters {
  gameId: string;
  difficultyId: string;
  modelId: string;
}

export interface LatencyStats {
  avg: number;
  median: number;
  p90: number;
  slowest: number;
  samples: number;
}

export interface LeaderboardRow {
  groupId: string;
  modelId: string;
  modelLabel: string;
  gameId: string;
  displayedScore: number;
  outcomeScore: number;
  moveQuality: number;
  reliability: number;
  speedScore: number;
  scheduledGames: number;
  completedGames: number;
  wins: number;
  draws: number;
  losses: number;
  avgLatencyPerMoveMs: number;
  updatedAtIso: string;
  latency: LatencyStats;
  gameLabel: string;
  difficultyLabel: string;
}

interface AggregatedRecordGroup {
  groupId: string;
  modelId: string;
  gameId: string;
  scoreModel: PublicBenchmarkRecord["scoreModel"];
  scheduledGames: number;
  completedGames: number;
  wins: number;
  draws: number;
  losses: number;
  gradedMoveCount: number;
  moveQualitySum: number;
  latencySamplesMs: number[];
  updatedAtIso: string;
  gameIds: Set<string>;
  difficultyIds: Set<string>;
  sideStats?: {
    white: PublicBenchmarkSideStats;
    black: PublicBenchmarkSideStats;
  };
}

const SPEED_BASELINE_MS = 2000;

function lookupLabel<T extends { id: string; label: string }>(entries: T[], id: string): string {
  return entries.find((entry) => entry.id === id)?.label ?? id;
}

export function filterRecords(data: PublicBenchmarks, filters: Filters): PublicBenchmarkRecord[] {
  return data.records.filter((record) => {
    if (filters.gameId !== "all" && record.gameId !== filters.gameId) return false;
    if (filters.difficultyId !== "all" && record.difficultyId !== filters.difficultyId) return false;
    if (filters.modelId !== "all" && record.modelId !== filters.modelId) return false;
    return true;
  });
}

export function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[index] ?? sorted[sorted.length - 1]!;
}

export function computeLatencyStats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return {
      avg: 0,
      median: 0,
      p90: 0,
      slowest: 0,
      samples: 0
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    avg: total / values.length,
    median: computePercentile(values, 50),
    p90: computePercentile(values, 90),
    slowest: Math.max(...values),
    samples: values.length
  };
}

export function computeDisplayedScore(input: {
  gameId: string;
  scoreModel: PublicBenchmarkRecord["scoreModel"];
  wins: number;
  draws: number;
  losses: number;
  scheduledGames: number;
  completedGames: number;
  gradedMoveCount: number;
  moveQualitySum: number;
  avgLatencyPerMoveMs: number;
  sideStats?: PublicBenchmarkRecord["sideStats"];
}): {
  displayedScore: number;
  outcomeScore: number;
  moveQuality: number;
  reliability: number;
  speedScore: number;
} {
  const outcomeScore = input.scheduledGames > 0 ? (input.wins + input.draws * 0.5) / input.scheduledGames : 0;
  const reliability = input.scheduledGames > 0 ? input.completedGames / input.scheduledGames : 0;
  const speedScore =
    input.avgLatencyPerMoveMs > 0 ? Math.min(1, SPEED_BASELINE_MS / input.avgLatencyPerMoveMs) : 0;

  if (input.scoreModel === "hive-v1") {
    const whiteScore =
      input.sideStats && input.sideStats.white.scheduledGames > 0
        ? input.sideStats.white.pointSum / input.sideStats.white.scheduledGames
        : 0;
    const blackScore =
      input.sideStats && input.sideStats.black.scheduledGames > 0
        ? input.sideStats.black.pointSum / input.sideStats.black.scheduledGames
        : 0;
    const balancedOutcome = 0.65 * ((whiteScore + blackScore) / 2) + 0.35 * Math.min(whiteScore, blackScore);
    const finalScore01 = 0.75 * balancedOutcome + 0.15 * reliability + 0.1 * speedScore;

    return {
      displayedScore: Math.round(finalScore01 * 1000) / 10,
      outcomeScore,
      moveQuality: balancedOutcome,
      reliability,
      speedScore
    };
  }

  const moveQuality = input.gradedMoveCount > 0 ? input.moveQualitySum / input.gradedMoveCount : 0;
  const finalScore01 = 0.5 * outcomeScore + 0.25 * moveQuality + 0.15 * reliability + 0.1 * speedScore;

  return {
    displayedScore: Math.round(finalScore01 * 1000) / 10,
    outcomeScore,
    moveQuality,
    reliability,
    speedScore
  };
}

export function buildLeaderboardRows(data: PublicBenchmarks, filters: Filters): LeaderboardRow[] {
  const modelMap = new Map(data.models.map((model) => [model.id, model]));
  const filtered = filterRecords(data, filters);
  const groups = new Map<string, AggregatedRecordGroup>();

  for (const record of filtered) {
    const groupId = `${record.modelId}::${record.gameId}`;
    const group = groups.get(groupId) ?? {
      groupId,
      modelId: record.modelId,
      gameId: record.gameId,
      scoreModel: record.scoreModel,
      scheduledGames: 0,
      completedGames: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gradedMoveCount: 0,
      moveQualitySum: 0,
      latencySamplesMs: [],
      updatedAtIso: record.playedAtIso,
      gameIds: new Set<string>(),
      difficultyIds: new Set<string>(),
      sideStats: undefined
    };

    group.scheduledGames += record.scheduledGames;
    group.completedGames += record.completedGames;
    group.wins += record.wins;
    group.draws += record.draws;
    group.losses += record.losses;
    group.gradedMoveCount += record.gradedMoveCount;
    group.moveQualitySum += record.moveQualitySum;
    group.latencySamplesMs.push(...record.latencySamplesMs);
    if (record.playedAtIso > group.updatedAtIso) {
      group.updatedAtIso = record.playedAtIso;
    }
    group.gameIds.add(record.gameId);
    group.difficultyIds.add(record.difficultyId);
    if (record.sideStats) {
      if (!group.sideStats) {
        group.sideStats = {
          white: { ...record.sideStats.white },
          black: { ...record.sideStats.black }
        };
      } else {
        group.sideStats.white.scheduledGames += record.sideStats.white.scheduledGames;
        group.sideStats.white.completedGames += record.sideStats.white.completedGames;
        group.sideStats.white.wins += record.sideStats.white.wins;
        group.sideStats.white.draws += record.sideStats.white.draws;
        group.sideStats.white.losses += record.sideStats.white.losses;
        group.sideStats.white.pointSum += record.sideStats.white.pointSum;
        group.sideStats.black.scheduledGames += record.sideStats.black.scheduledGames;
        group.sideStats.black.completedGames += record.sideStats.black.completedGames;
        group.sideStats.black.wins += record.sideStats.black.wins;
        group.sideStats.black.draws += record.sideStats.black.draws;
        group.sideStats.black.losses += record.sideStats.black.losses;
        group.sideStats.black.pointSum += record.sideStats.black.pointSum;
      }
    }
    groups.set(groupId, group);
  }

  const perGameRows = [...groups.values()].map((group) => {
    const latency = computeLatencyStats(group.latencySamplesMs);
    const score = computeDisplayedScore({
      gameId: group.gameId,
      scoreModel: group.scoreModel,
      wins: group.wins,
      draws: group.draws,
      losses: group.losses,
      scheduledGames: group.scheduledGames,
      completedGames: group.completedGames,
      gradedMoveCount: group.gradedMoveCount,
      moveQualitySum: group.moveQualitySum,
      avgLatencyPerMoveMs: latency.avg,
      sideStats: group.sideStats
    });
    const model = modelMap.get(group.modelId);
    const gameLabel =
      group.gameIds.size === 1
        ? lookupLabel(data.games, [...group.gameIds][0]!)
        : `${group.gameIds.size} games`;
    const difficultyLabel =
      group.difficultyIds.size === 1
        ? lookupLabel(data.difficulties, [...group.difficultyIds][0]!)
        : "Multiple";

    return {
      groupId: group.groupId,
      modelId: group.modelId,
      modelLabel: model?.label ?? group.modelId,
      gameId: group.gameId,
      displayedScore: score.displayedScore,
      outcomeScore: score.outcomeScore,
      moveQuality: score.moveQuality,
      reliability: score.reliability,
      speedScore: score.speedScore,
      scheduledGames: group.scheduledGames,
      completedGames: group.completedGames,
      wins: group.wins,
      draws: group.draws,
      losses: group.losses,
      avgLatencyPerMoveMs: latency.avg,
      updatedAtIso: group.updatedAtIso,
      latency,
      gameLabel,
      difficultyLabel
    } satisfies LeaderboardRow;
  });

  const rows = filters.gameId !== "all"
    ? perGameRows
    : (() => {
        const combined = new Map<
          string,
          {
            groupId: string;
            modelId: string;
            modelLabel: string;
            displayedScoreSum: number;
            outcomeScoreSum: number;
            moveQualitySum: number;
            reliabilitySum: number;
            speedScoreSum: number;
            gameCount: number;
            scheduledGames: number;
            completedGames: number;
            wins: number;
            draws: number;
            losses: number;
            latencySamplesMs: number[];
            updatedAtIso: string;
            difficultyIds: Set<string>;
          }
        >();

        for (const row of perGameRows) {
          const group = combined.get(row.modelId) ?? {
            groupId: row.modelId,
            modelId: row.modelId,
            modelLabel: row.modelLabel,
            displayedScoreSum: 0,
            outcomeScoreSum: 0,
            moveQualitySum: 0,
            reliabilitySum: 0,
            speedScoreSum: 0,
            gameCount: 0,
            scheduledGames: 0,
            completedGames: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            latencySamplesMs: [],
            updatedAtIso: row.updatedAtIso,
            difficultyIds: new Set<string>()
          };

          group.displayedScoreSum += row.displayedScore;
          group.outcomeScoreSum += row.outcomeScore;
          group.moveQualitySum += row.moveQuality;
          group.reliabilitySum += row.reliability;
          group.speedScoreSum += row.speedScore;
          group.gameCount += 1;
          group.scheduledGames += row.scheduledGames;
          group.completedGames += row.completedGames;
          group.wins += row.wins;
          group.draws += row.draws;
          group.losses += row.losses;
          const matchingRecords = filtered.filter((record) => record.modelId === row.modelId);
          group.latencySamplesMs = matchingRecords.flatMap((record) => record.latencySamplesMs);
          if (row.updatedAtIso > group.updatedAtIso) {
            group.updatedAtIso = row.updatedAtIso;
          }
          for (const record of matchingRecords) {
            group.difficultyIds.add(record.difficultyId);
          }
          combined.set(row.modelId, group);
        }

        return [...combined.values()].map((group) => {
          const latency = computeLatencyStats(group.latencySamplesMs);
          const difficultyLabel =
            group.difficultyIds.size === 1 ? lookupLabel(data.difficulties, [...group.difficultyIds][0]!) : "Multiple";
          return {
            groupId: group.groupId,
            modelId: group.modelId,
            modelLabel: group.modelLabel,
            gameId: "all",
            displayedScore: Math.round((group.displayedScoreSum / group.gameCount) * 10) / 10,
            outcomeScore: group.outcomeScoreSum / group.gameCount,
            moveQuality: group.moveQualitySum / group.gameCount,
            reliability: group.reliabilitySum / group.gameCount,
            speedScore: group.speedScoreSum / group.gameCount,
            scheduledGames: group.scheduledGames,
            completedGames: group.completedGames,
            wins: group.wins,
            draws: group.draws,
            losses: group.losses,
            avgLatencyPerMoveMs: latency.avg,
            updatedAtIso: group.updatedAtIso,
            latency,
            gameLabel: "All games",
            difficultyLabel
          } satisfies LeaderboardRow;
        });
      })();

  return rows
    .sort((left, right) => {
      if (right.displayedScore !== left.displayedScore) {
        return right.displayedScore - left.displayedScore;
      }
      if (left.gameLabel !== right.gameLabel) {
        return left.gameLabel.localeCompare(right.gameLabel);
      }
      if (right.completedGames !== left.completedGames) {
        return right.completedGames - left.completedGames;
      }
      return left.modelLabel.localeCompare(right.modelLabel);
    });
}
