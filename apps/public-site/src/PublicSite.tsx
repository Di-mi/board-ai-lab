import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { trackBenchmarkDataError, trackBenchmarkDataLoaded, trackSiteNavigation } from "./lib/analytics.js";
import type { Filters, PublicBenchmarks } from "./lib/benchmarks.js";
import { LeaderboardPage, LatencyPage } from "./pages/leaderboard.js";
import { PlayPage } from "./pages/play.js";
import {
  DiceFace,
  HexBadge,
  MeepleBullet,
  SiteHeader,
  pageHref,
  pageTitle,
  readFilters,
  readPageFromLocation,
  writeUrlState
} from "./shared/site.js";
import type { PublicSitePage } from "./shared/site.js";

export type { PublicSitePage } from "./shared/site.js";

function ScoreWeightBar({ label, weight, color }: { label: string; weight: number; color: string }) {
  return (
    <div className="weight-bar-row">
      <span className="weight-bar-label">{label}</span>
      <div className="weight-bar-track">
        <div className="weight-bar-fill" style={{ width: `${weight * 100}%`, background: color }} />
      </div>
      <span className="weight-bar-pct" style={{ color }}>{Math.round(weight * 100)}%</span>
    </div>
  );
}

function MethodologyPage() {
  return (
    <div className="method-layout">
      <section className="method-hero">
        <HexBadge className="warm">01</HexBadge>
        <div className="method-hero-content">
          <h2>How Scores Are Computed</h2>
          <p>
            Each model plays a fixed set of games against deterministic opponents of varying difficulty.
            We record wins, draws, losses, completion rate, and response latency. Where a game supports
            a stronger tactical signal, we add it. Where it does not, we use a more outcome-driven formula.
          </p>
        </div>
      </section>

      <section className="method-score-block">
        <div className="method-score-section onitama">
          <div className="method-score-piece">
            <svg viewBox="0 0 40 40" className="method-piece-svg onitama" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="5" width="30" height="30" rx="3" /><line x1="5" y1="15" x2="35" y2="15" /><line x1="5" y1="25" x2="35" y2="25" /><line x1="15" y1="5" x2="15" y2="35" /><line x1="25" y1="5" x2="25" y2="35" /><circle cx="20" cy="20" r="2.5" fill="currentColor" stroke="none" /></svg>
          </div>
          <div className="method-score-inner">
            <div className="method-score-tag">Onitama — Tactical Scoring</div>
            <p className="method-score-desc">Onitama is compact enough that we grade individual move quality against a reference engine — catching tactical mistakes even inside drawn or lost games.</p>
            <div className="weight-bars">
              <ScoreWeightBar label="Outcome" weight={0.50} color="var(--gold)" />
              <ScoreWeightBar label="Move Quality" weight={0.25} color="var(--teal)" />
              <ScoreWeightBar label="Reliability" weight={0.15} color="var(--cool-hi)" />
              <ScoreWeightBar label="Speed" weight={0.10} color="var(--red)" />
            </div>
            <code className="method-formula-line">Score = 0.50×outcome + 0.25×moves + 0.15×reliability + 0.10×speed</code>
          </div>
        </div>
        <div className="method-score-section hive">
          <div className="method-score-piece">
            <svg viewBox="0 0 40 40" className="method-piece-svg hive" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="20,3 37,12 37,28 20,37 3,28 3,12" /><circle cx="20" cy="20" r="2.5" fill="currentColor" stroke="none" /></svg>
          </div>
          <div className="method-score-inner">
            <div className="method-score-tag">Hive — Outcome-Driven Scoring</div>
            <p className="method-score-desc">Hive is more branching and draw-prone. We score by balanced side-to-side match performance, reliability, and speed. One-color specialists don&apos;t float to the top.</p>
            <div className="weight-bars">
              <ScoreWeightBar label="Balanced Outcome" weight={0.75} color="var(--gold)" />
              <ScoreWeightBar label="Reliability" weight={0.15} color="var(--cool-hi)" />
              <ScoreWeightBar label="Speed" weight={0.10} color="var(--red)" />
            </div>
            <code className="method-formula-line">Score = 0.75×balanced_outcome + 0.15×reliability + 0.10×speed</code>
          </div>
        </div>
      </section>

      <section className="method-section">
        <HexBadge className="cool">02</HexBadge>
        <div className="method-hero-content">
          <h2>Why Hive Uses A Different Signal</h2>
          <p>The game tree is larger and perfect move grading is less useful as a public score.</p>
        </div>
      </section>
      <dl className="method-deflist">
        <div className="method-def-row">
          <dt><MeepleBullet color="var(--gold)" />Balanced Outcome</dt>
          <dd>White-side and black-side match points are scored separately, averaged, then blended with the weaker side. That punishes bots that only perform from one color.</dd>
        </div>
        <div className="method-def-row">
          <dt><MeepleBullet color="var(--red)" />Turn-Cap Draws</dt>
          <dd>Benchmarks use a turn limit. Those draws are useful survival data, but they are worth less than real wins.</dd>
        </div>
        <div className="method-def-row">
          <dt><MeepleBullet color="var(--teal)" />Reliability</dt>
          <dd>Invalid moves, timeouts, or request failures lower the score by reducing completion rate over scheduled games.</dd>
        </div>
        <div className="method-def-row">
          <dt><MeepleBullet color="var(--cool-hi)" />Response Speed</dt>
          <dd>Both games reward fast turn latency against a 2-second baseline, capped so speed alone cannot dominate strategy.</dd>
        </div>
      </dl>

      <section className="method-section">
        <HexBadge className="teal">03</HexBadge>
        <div className="method-hero-content">
          <h2>The Opponent Bots</h2>
          <p>All opponents are fully deterministic given a fixed seed — the same starting position always produces the same move sequence. Results are reproducible and comparable across model versions.</p>
        </div>
      </section>
      <div className="method-bot-ladder">
        <div className="method-bot-rung easy">
          <DiceFace pips={1} color="var(--gold)" />
          <div className="method-bot-info">
            <div className="method-bot-tier-tag">Easy</div>
            <h4>Random Bot</h4>
            <p>Picks uniformly at random from legal moves every turn. No evaluation, no lookahead. It serves as a floor: any model understanding the rules should beat this tier consistently.</p>
          </div>
        </div>
        <div className="method-bot-rung medium">
          <DiceFace pips={3} color="var(--teal)" />
          <div className="method-bot-info">
            <div className="method-bot-tier-tag">Medium</div>
            <h4>Genetic Bot (Shallow)</h4>
            <p>Built using evolutionary tuning over hand-designed board-evaluation features. Intentionally beatable by a focused human, but still punishes basic tactical mistakes.</p>
          </div>
        </div>
        <div className="method-bot-rung hard">
          <DiceFace pips={6} color="var(--red)" />
          <div className="method-bot-info">
            <div className="method-bot-tier-tag">Hard</div>
            <h4>Genetic Bot (Deep)</h4>
            <p>The strongest pinned heuristic bot. Uses the best evolved evaluation weights we trust for public play and score export. This is the ceiling tier shown on the site.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function RulebookPage() {
  return (
    <div className="rulebook-layout">
      <section className="rb-criteria">
        <h2 className="rb-section-title">Game Selection Criteria</h2>
        <p className="rb-lead">We pick games where luck stays low and player focus matters — better decisions consistently beat worse ones.</p>
        <ul className="rb-criteria-list">
          <li><MeepleBullet color="var(--gold)" /><div><strong>Low Luck</strong> — open-information, minimal randomness after setup</div></li>
          <li><MeepleBullet color="var(--red)" /><div><strong>High Skill Ceiling</strong> — tactical mistakes matter, better play wins over time</div></li>
          <li><MeepleBullet color="var(--teal)" /><div><strong>Human Focus</strong> — a strong player needs real concentration to play well</div></li>
          <li><MeepleBullet color="var(--cool-hi)" /><div><strong>Short Matches</strong> — quick enough to run many fair benchmark sessions</div></li>
        </ul>
      </section>

      <section className="rb-game-section rb-onitama">
        <div className="rb-game-header">
          <svg viewBox="0 0 40 40" className="rb-game-piece onitama" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="5" width="30" height="30" rx="3" /><line x1="5" y1="15" x2="35" y2="15" /><line x1="5" y1="25" x2="35" y2="25" /><line x1="15" y1="5" x2="15" y2="35" /><line x1="25" y1="5" x2="25" y2="35" /><circle cx="20" cy="20" r="2.5" fill="currentColor" stroke="none" /></svg>
          <div>
            <h2>Onitama</h2>
            <p className="rb-game-tagline">Tactical card duels on a 5×5 board</p>
          </div>
        </div>
        <p className="rb-game-intro">
          A two-player abstract strategy game with perfect information and no luck after the initial card draw.
          The small board combined with high tactical density and rotating cards makes it ideal for benchmarking.
        </p>
        <div className="rb-rules-list">
          <div className="rb-rule-item">
            <HexBadge className="warm-sm">1</HexBadge>
            <div>
              <h4>Board &amp; Pieces</h4>
              <p>5×5 grid. Each side: one master, four students. Centre square of each home row is that side’s temple arch — a secondary win target.</p>
            </div>
          </div>
          <div className="rb-rule-item">
            <HexBadge className="warm-sm">2</HexBadge>
            <div>
              <h4>Cards Define Movement</h4>
              <p>Each player holds two movement cards. Every legal move must match one of those card patterns applied to any of their pieces.</p>
            </div>
          </div>
          <div className="rb-rule-item">
            <HexBadge className="warm-sm">3</HexBadge>
            <div>
              <h4>Turn Flow</h4>
              <p>Choose a card, execute the move, swap the used card with the shared side card. Card cycling is strategy, not bookkeeping.</p>
            </div>
          </div>
          <div className="rb-rule-item">
            <HexBadge className="warm-sm">4</HexBadge>
            <div>
              <h4>Win Conditions</h4>
              <p>Capture the opposing master, or move your master onto the opponent’s temple arch. Both threats must be tracked simultaneously.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rb-game-section rb-hive">
        <div className="rb-game-header">
          <svg viewBox="0 0 40 40" className="rb-game-piece hive" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="20,3 37,12 37,28 20,37 3,28 3,12" /><circle cx="20" cy="20" r="2.5" fill="currentColor" stroke="none" /></svg>
          <div>
            <h2>Hive</h2>
            <p className="rb-game-tagline">Hexagonal insect strategy — no fixed board</p>
          </div>
        </div>
        <p className="rb-game-intro">
          Played by placing and moving insect tiles into one connected hive. The shape of the position <em>is</em> the board.
          Spatial reasoning, local tactical pressure, and long-term piece coordination dominate.
        </p>
        <div className="rb-rules-list">
          <div className="rb-rule-item">
            <HexBadge className="teal-sm">1</HexBadge>
            <div>
              <h4>Setup &amp; Objective</h4>
              <p>Each side: 1 queen, 2 beetles, 2 spiders, 3 grasshoppers, 3 ants. Surround the opposing queen on all six neighboring hexes to win.</p>
            </div>
          </div>
          <div className="rb-rule-item">
            <HexBadge className="teal-sm">2</HexBadge>
            <div>
              <h4>Placement Rules</h4>
              <p>White starts. Pieces are placed from reserve onto empty neighbor hexes. Queen must be placed by turn 4; no movement until queen is down.</p>
            </div>
          </div>
          <div className="rb-rule-item">
            <HexBadge className="teal-sm">3</HexBadge>
            <div>
              <h4>Movement</h4>
              <p>The hive must stay connected. Queens slide 1 hex, beetles move 1 and can climb, spiders slide exactly 3, grasshoppers jump lines, ants slide any distance.</p>
            </div>
          </div>
          <div className="rb-rule-item">
            <HexBadge className="teal-sm">4</HexBadge>
            <div>
              <h4>Benchmark Draws</h4>
              <p>A turn cap is enforced. If neither queen is surrounded before the cap, the result is a turn-limit draw rather than an endless shuffle.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function PageContent({
  page,
  data,
  filters,
  setFilters
}: {
  page: PublicSitePage;
  data: PublicBenchmarks | null;
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
}) {
  switch (page) {
    case "leaderboard":
      return data ? <LeaderboardPage data={data} filters={filters} setFilters={setFilters} /> : null;
    case "latency":
      return data ? <LatencyPage data={data} filters={filters} setFilters={setFilters} /> : null;
    case "methodology":
      return <MethodologyPage />;
    case "rulebook":
      return <RulebookPage />;
    case "play":
      return data ? <PlayPage data={data} /> : null;
  }
}

export function SiteView({ page, data }: { page: PublicSitePage; data: PublicBenchmarks }) {
  const [currentPage, setCurrentPage] = useState<PublicSitePage>(page);
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      return readFilters();
    } catch {
      return { gameId: "all", difficultyId: "all", modelId: "all" };
    }
  });

  useEffect(() => {
    try {
      writeUrlState(currentPage, filters);
    } catch {
      // ignore in test env
    }
  }, [currentPage, filters]);

  useEffect(() => {
    setCurrentPage(page);
  }, [page]);

  useEffect(() => {
    const onPopState = () => {
      try {
        setCurrentPage(readPageFromLocation());
        setFilters(readFilters());
      } catch {
        // ignore in test env
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    document.title = pageTitle(currentPage);
  }, [currentPage]);

  function navigate(targetPage: PublicSitePage) {
    trackSiteNavigation(currentPage, targetPage);
    history.pushState({}, "", pageHref(targetPage, filters));
    setCurrentPage(targetPage);
  }

  return (
    <div className="site-shell">
      <SiteHeader page={currentPage} filters={filters} onNavigate={navigate} />
      <PageContent page={currentPage} data={data} filters={filters} setFilters={setFilters} />
    </div>
  );
}

export function SiteLoader({ page }: { page?: PublicSitePage }) {
  const [data, setData] = useState<PublicBenchmarks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<PublicSitePage>(() => {
    try {
      return page ?? readPageFromLocation();
    } catch {
      return page ?? "leaderboard";
    }
  });
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      return readFilters();
    } catch {
      return { gameId: "all", difficultyId: "all", modelId: "all" };
    }
  });

  useEffect(() => {
    fetch("/data/public-benchmarks.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<PublicBenchmarks>;
      })
      .then((benchmarkData) => {
        setData(benchmarkData);
        trackBenchmarkDataLoaded(benchmarkData.siteName, benchmarkData.games.length, benchmarkData.records.length);
      })
      .catch((caughtError: unknown) => {
        const message = String(caughtError);
        setError(message);
        trackBenchmarkDataError(message);
      });
  }, []);

  useEffect(() => {
    try {
      writeUrlState(currentPage, filters);
    } catch {
      // ignore
    }
  }, [currentPage, filters]);

  useEffect(() => {
    const onPopState = () => {
      try {
        setCurrentPage(readPageFromLocation());
        setFilters(readFilters());
      } catch {
        // ignore
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    document.title = pageTitle(currentPage);
  }, [currentPage]);

  function navigate(targetPage: PublicSitePage) {
    trackSiteNavigation(currentPage, targetPage);
    history.pushState({}, "", pageHref(targetPage, filters));
    setCurrentPage(targetPage);
  }

  const needsData = currentPage === "leaderboard" || currentPage === "latency" || currentPage === "play";

  if (error) {
    return (
      <div className="site-shell">
        <SiteHeader page={currentPage} filters={filters} onNavigate={navigate} />
        <p style={{ color: "var(--orange)", padding: 24 }}>Failed to load benchmark data: {error}</p>
      </div>
    );
  }

  return (
    <div className="site-shell">
      <SiteHeader page={currentPage} filters={filters} onNavigate={navigate} />
      {!data && needsData
        ? <p style={{ color: "var(--text-dim)", padding: 24 }}>Loading…</p>
        : <PageContent page={currentPage} data={data} filters={filters} setFilters={setFilters} />
      }
    </div>
  );
}
