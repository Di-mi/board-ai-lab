import { useMemo, type Dispatch, type SetStateAction } from "react";
import { buildLeaderboardRows, type Filters, type LeaderboardRow, type PublicBenchmarks } from "../lib/benchmarks.js";
import { CornerMeeple, RankMeeple, fixed, formatDate, formatMs, percent, providerClass } from "../shared/site.js";

function ProviderLegend({ providers }: { providers: string[] }) {
  const labels: Record<string, string> = { anthropic: "Anthropic", google: "Google", openai: "OpenAI", minimax: "Minimax" };
  return (
    <div className="provider-legend">
      {providers.map((provider) => (
        <div key={provider} className="legend-item">
          <div className={`legend-dot ${providerClass(provider)}`} />
          {labels[provider] ?? provider}
        </div>
      ))}
    </div>
  );
}

function ChampionPodium({ rows, data }: { rows: LeaderboardRow[]; data: PublicBenchmarks }) {
  const top3 = rows.slice(0, 3);
  if (top3.length === 0) return null;

  const rankLabels = ["🥇 #1 Best Model", "🥈 #2 Runner Up", "🥉 #3 Third Place"];
  const rankClasses = ["rank-1", "rank-2", "rank-3"];

  return (
    <div className="champion-strip">
      {top3.map((row, index) => {
        const model = data.models.find((entry) => entry.id === row.modelId);
        return (
          <div key={row.groupId} className={`champion-card ${rankClasses[index] ?? "rank-4"}`}>
            <div className="champion-rank">{rankLabels[index] ?? `#${index + 1}`}</div>
            <div className="champion-name">{row.modelLabel}</div>
            <div className="champion-score">{row.displayedScore.toFixed(1)}</div>
            <div className="champion-meta">
              {row.gameLabel} &nbsp;·&nbsp; {row.difficultyLabel} &nbsp;·&nbsp; {row.wins}W – {row.draws}D – {row.losses}L
              {model?.provider ? <> &nbsp;·&nbsp; {model.provider.charAt(0).toUpperCase() + model.provider.slice(1)}</> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface BarChartRow {
  id: string;
  label: string;
  subLabel?: string;
  value: number;
  maxValue: number;
  provider?: string;
  rank: number;
  valueLabel: string;
  subValueLabel?: string;
  stacked?: { wins: number; draws: number; losses: number; total: number };
}

function BarChart({ rows, tall = false }: { rows: BarChartRow[]; tall?: boolean }) {
  if (rows.length === 0) return <p className="empty-row">No data.</p>;

  return (
    <div className="bar-chart">
      {rows.map((row) => {
        const pct = row.maxValue > 0 ? Math.max(2, (row.value / row.maxValue) * 100) : 0;
        const fillClass = `bar-fill ${providerClass(row.provider)}${row.rank === 1 ? " rank-1" : ""}`;
        return (
          <div key={row.id} className="bar-row">
            <div className="bar-label">
              <span className="bar-label-name">{row.label}</span>
              {row.subLabel ? <span className="bar-label-sub">{row.subLabel}</span> : null}
            </div>
            <div className={`bar-track${tall ? " tall" : ""}`}>
              {row.stacked ? (
                <div className="stack-bar-track" style={{ width: "100%" }}>
                  <div className="stack-bar-seg wins" style={{ width: row.stacked.total > 0 ? `${(row.stacked.wins / row.stacked.total) * 100}%` : "0%" }} />
                  <div className="stack-bar-seg draws" style={{ width: row.stacked.total > 0 ? `${(row.stacked.draws / row.stacked.total) * 100}%` : "0%" }} />
                  <div className="stack-bar-seg losses" style={{ width: row.stacked.total > 0 ? `${(row.stacked.losses / row.stacked.total) * 100}%` : "0%" }} />
                </div>
              ) : (
                <div className={fillClass} style={{ width: `${pct}%` }} />
              )}
            </div>
            <div>
              <div className="bar-value">{row.valueLabel}</div>
              {row.subValueLabel ? <div className="bar-value-sub">{row.subValueLabel}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScoreCharts({ rows, data }: { rows: LeaderboardRow[]; data: PublicBenchmarks }) {
  const maxScore = Math.max(...rows.map((row) => row.displayedScore), 1);
  const maxMoveQuality = Math.max(...rows.map((row) => row.moveQuality), 0.001);
  const providers = [...new Set(data.models.map((model) => model.provider).filter((provider): provider is string => Boolean(provider)))];

  const getProvider = (modelId: string) => data.models.find((model) => model.id === modelId)?.provider;
  const subLabel = (row: LeaderboardRow) => [getProvider(row.modelId), row.gameLabel, row.difficultyLabel].filter(Boolean).join(" · ");

  const scoreBars: BarChartRow[] = rows.map((row, index) => ({
    id: row.groupId,
    label: row.modelLabel,
    subLabel: subLabel(row),
    value: row.displayedScore,
    maxValue: maxScore,
    provider: getProvider(row.modelId),
    rank: index + 1,
    valueLabel: row.displayedScore.toFixed(1)
  }));

  const winBars: BarChartRow[] = rows.map((row, index) => ({
    id: row.groupId,
    label: row.modelLabel,
    subLabel: subLabel(row),
    value: row.outcomeScore,
    maxValue: 1,
    provider: getProvider(row.modelId),
    rank: index + 1,
    valueLabel: `${Math.round(row.outcomeScore * 100)}%`,
    subValueLabel: `${row.wins}W ${row.draws}D ${row.losses}L`,
    stacked: { wins: row.wins, draws: row.draws, losses: row.losses, total: row.scheduledGames }
  }));

  const qualityBars: BarChartRow[] = rows.map((row, index) => ({
    id: row.groupId,
    label: row.modelLabel,
    subLabel: subLabel(row),
    value: row.moveQuality,
    maxValue: maxMoveQuality,
    provider: getProvider(row.modelId),
    rank: index + 1,
    valueLabel: `${Math.round(row.moveQuality * 100)}%`,
    subValueLabel: "move quality"
  }));

  const sortedBySpeed = [...rows].sort((a, b) => a.avgLatencyPerMoveMs - b.avgLatencyPerMoveMs);
  const maxLatency = Math.max(...sortedBySpeed.map((row) => row.avgLatencyPerMoveMs), 1);
  const speedBars: BarChartRow[] = sortedBySpeed.map((row, index) => ({
    id: row.groupId,
    label: row.modelLabel,
    subLabel: subLabel(row),
    value: row.avgLatencyPerMoveMs,
    maxValue: maxLatency,
    provider: getProvider(row.modelId),
    rank: index + 1,
    valueLabel: formatMs(row.avgLatencyPerMoveMs),
    subValueLabel: `P90 ${formatMs(row.latency.p90)}`
  }));

  return (
    <>
      <ProviderLegend providers={providers} />
      <div className="chart-section">
        <p className="chart-title">Overall Score — sorted best to worst</p>
        <BarChart rows={scoreBars} tall />
      </div>
      <div className="chart-section">
        <p className="chart-title">Win / Draw / Loss outcomes (green = wins, yellow = draws, red = losses)</p>
        <BarChart rows={winBars} />
      </div>
      <div className="chart-section">
        <p className="chart-title">Tactical Quality — move correctness in Onitama, side-balanced outcomes in Hive</p>
        <BarChart rows={qualityBars} />
      </div>
      <div className="chart-section">
        <p className="chart-title">Response Speed — sorted fastest to slowest, avg ms per move</p>
        <BarChart rows={speedBars} />
      </div>
    </>
  );
}

function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) {
    return <p className="empty-row">No data for the selected filters.</p>;
  }

  const maxScore = Math.max(...rows.map((row) => row.displayedScore), 1);
  const maxQuality = Math.max(...rows.map((row) => row.moveQuality), 0.001);

  return (
    <div className="table-wrap">
      <table className="data-table leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Model</th>
            <th>Score</th>
            <th>Outcomes</th>
            <th>Tactical Quality</th>
            <th>Speed</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rank = index + 1;
            const rankClass = rank <= 4 ? `rank-${rank}` : "rank-4";
            return (
              <tr key={row.groupId}>
                <td>
                  <span className={`rank-pill ${rankClass}`}>
                    <RankMeeple />
                    {rank}
                  </span>
                </td>
                <td>
                  <div className="model-cell">
                    <strong>{row.modelLabel}</strong>
                    <span>
                      {row.gameLabel} · {row.difficultyLabel}
                    </span>
                  </div>
                </td>
                <td>
                  <div className="metric-cell">
                    <div className="metric-topline">
                      <strong>{fixed(row.displayedScore)}</strong>
                    </div>
                    <div className="metric-bar">
                      <span style={{ width: `${(row.displayedScore / maxScore) * 100}%` }} />
                    </div>
                  </div>
                </td>
                <td>
                  <div className="outcome-cell">
                    <div className="metric-topline">
                      <span>{row.wins}W</span>
                      <span>{row.draws}D</span>
                      <span>{row.losses}L</span>
                      <strong>{percent(row.outcomeScore)}</strong>
                    </div>
                    <div className="stack-bar">
                      <div className="wins" style={{ width: row.scheduledGames > 0 ? `${(row.wins / row.scheduledGames) * 100}%` : "0%" }} />
                      <div className="draws" style={{ width: row.scheduledGames > 0 ? `${(row.draws / row.scheduledGames) * 100}%` : "0%" }} />
                      <div className="losses" style={{ width: row.scheduledGames > 0 ? `${(row.losses / row.scheduledGames) * 100}%` : "0%" }} />
                    </div>
                  </div>
                </td>
                <td>
                  <div className="metric-cell">
                    <div className="metric-topline">
                      <strong>{percent(row.moveQuality)}</strong>
                    </div>
                    <div className="metric-bar teal">
                      <span style={{ width: `${(row.moveQuality / maxQuality) * 100}%` }} />
                    </div>
                  </div>
                </td>
                <td>
                  <div className="metric-cell">
                    <div className="metric-topline">
                      <strong>{formatMs(row.avgLatencyPerMoveMs)}</strong>
                    </div>
                    <div className="metric-bar plum">
                      <span style={{ width: `${row.speedScore * 100}%` }} />
                    </div>
                  </div>
                </td>
                <td style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>{formatDate(row.updatedAtIso)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LeaderboardPage({
  data,
  filters,
  setFilters
}: {
  data: PublicBenchmarks;
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
}) {
  const rows = useMemo(() => buildLeaderboardRows(data, filters), [data, filters]);

  return (
    <div className="page-full">
      <div className="toolbar-card">
        <label>
          Game
          <select value={filters.gameId} onChange={(e) => setFilters((current) => ({ ...current, gameId: e.target.value }))}>
            <option value="all">All games</option>
            {data.games.map((game) => (
              <option key={game.id} value={game.id}>{game.label}</option>
            ))}
          </select>
        </label>
        <label>
          Difficulty
          <select value={filters.difficultyId} onChange={(e) => setFilters((current) => ({ ...current, difficultyId: e.target.value }))}>
            <option value="all">All difficulties</option>
            {data.difficulties.map((difficulty) => (
              <option key={difficulty.id} value={difficulty.id}>{difficulty.label} — {difficulty.description}</option>
            ))}
          </select>
          {filters.difficultyId !== "all" && (() => {
            const difficulty = data.difficulties.find((entry) => entry.id === filters.difficultyId);
            return difficulty ? <span className="filter-hint">{difficulty.description}</span> : null;
          })()}
        </label>
        <label>
          Model
          <select value={filters.modelId} onChange={(e) => setFilters((current) => ({ ...current, modelId: e.target.value }))}>
            <option value="all">All models</option>
            {data.models.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        </label>
      </div>

      {rows.length > 0 ? <ChampionPodium rows={rows} data={data} /> : null}

      <div className="page-card" style={{ marginBottom: 14 }}>
        <div className="card-header">
          <div>
            <h1>Leaderboard</h1>
            <p>All models ranked by overall score — sorted best to worst</p>
          </div>
          <CornerMeeple className="gold" />
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">No benchmark data for this selection</p>
            <p className="empty-state-body">
              {filters.difficultyId !== "all"
                ? `The "${data.difficulties.find((difficulty) => difficulty.id === filters.difficultyId)?.label ?? filters.difficultyId}" difficulty hasn't been benchmarked yet. Try "All difficulties" to see available data.`
                : "No records match the current filters."}
            </p>
          </div>
        ) : (
          <ScoreCharts rows={rows} data={data} />
        )}
      </div>

      <div className="page-card">
        <div className="card-header">
          <div>
            <h2>Detailed Results</h2>
            <p>Score breakdown per model</p>
          </div>
          <CornerMeeple className="teal" />
        </div>
        <LeaderboardTable rows={rows} />
        {data.updatedAtIso ? <p className="updated-stamp">Last updated: {formatDate(data.updatedAtIso)}</p> : null}
      </div>
    </div>
  );
}

export function LatencyPage({
  data,
  filters,
  setFilters
}: {
  data: PublicBenchmarks;
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
}) {
  const rows = useMemo(() => buildLeaderboardRows(data, filters), [data, filters]);
  const maxP90 = Math.max(...rows.map((row) => row.latency.p90), 1);
  const laneColors = ["lane-1", "lane-2", "lane-3", "lane-4"] as const;

  return (
    <div className="latency-page">
      <div className="toolbar-card" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
        <label>
          Game
          <select value={filters.gameId} onChange={(e) => setFilters((current) => ({ ...current, gameId: e.target.value }))}>
            <option value="all">All games</option>
            {data.games.map((game) => (
              <option key={game.id} value={game.id}>{game.label}</option>
            ))}
          </select>
        </label>
        <label>
          Difficulty
          <select value={filters.difficultyId} onChange={(e) => setFilters((current) => ({ ...current, difficultyId: e.target.value }))}>
            <option value="all">All difficulties</option>
            {data.difficulties.map((difficulty) => (
              <option key={difficulty.id} value={difficulty.id}>{difficulty.label} — {difficulty.description}</option>
            ))}
          </select>
        </label>
        <label>
          Model
          <select value={filters.modelId} onChange={(e) => setFilters((current) => ({ ...current, modelId: e.target.value }))}>
            <option value="all">All models</option>
            {data.models.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="page-card">
        <div className="card-header">
          <div>
            <h2>Response Latency</h2>
            <p>Time per move, sorted by P90 latency. The marker shows the median.</p>
          </div>
          <CornerMeeple className="plum" />
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">No data for this selection</p>
            <p className="empty-state-body">Try broadening the filters above.</p>
          </div>
        ) : (
          <div className="latency-chart">
            {[...rows]
              .sort((a, b) => a.latency.p90 - b.latency.p90)
              .map((row, index) => {
                const laneClass = laneColors[index % laneColors.length]!;
                const pctP90 = maxP90 > 0 ? (row.latency.p90 / maxP90) * 100 : 0;
                const pctMedian = maxP90 > 0 ? (row.latency.median / maxP90) * 100 : 0;
                return (
                  <div key={row.groupId} className="latency-row">
                    <div className={`lane-chip ${laneClass}`}>{row.modelLabel}</div>
                    <div className="latency-track">
                      <div className={`latency-bar ${laneClass}`} style={{ width: `${pctP90}%` }} />
                      <div className="latency-marker" style={{ left: `${pctMedian}%` }} />
                    </div>
                    <div className="latency-value">
                      <div>{formatMs(row.latency.p90)} P90</div>
                      <div style={{ fontSize: "0.74rem" }}>{formatMs(row.latency.median)} med</div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
