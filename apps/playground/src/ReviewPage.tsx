import { useEffect, useMemo, useState } from "react";
import { CARD_DEFINITIONS, type CardId, type GameState, type Move, type Player } from "@board-ai-lab/onitama-engine";

const RED_TEMPLE = { x: 2, y: 4 };
const BLUE_TEMPLE = { x: 2, y: 0 };

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
    gameCount: number;
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

const DEFAULT_SESSION_CONFIG: LlmSessionLog["config"] = {
  temperature: 0,
  maxOutputTokens: 0,
  opponentDepth: 0,
  gameCount: 0,
  jsonRetryCount: 0,
  requestTimeoutMs: 0
};

interface LlmSessionSummary {
  sessionId: string;
  startedAtIso: string;
  updatedAtIso: string;
  status: string;
  provider: string;
  modelId: string;
  llmLatencyMsTotal: number;
  llmMoveCount: number;
  matchCount: number;
  llmWins: number;
  llmLosses: number;
  draws: number;
  config: Record<string, unknown>;
}

function samePosition(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function orientCard(card: CardId, perspective: Player): Array<readonly [number, number]> {
  const deltas = CARD_DEFINITIONS[card].deltas;
  if (perspective === "red") return deltas;
  return deltas.map(([dx, dy]) => [-dx, -dy] as const);
}

function cardListFor(state: GameState, player: Player): [CardId, CardId] {
  return player === "red" ? state.cards.red : state.cards.blue;
}

function isTemple(x: number, y: number): "red" | "blue" | null {
  if (x === RED_TEMPLE.x && y === RED_TEMPLE.y) return "red";
  if (x === BLUE_TEMPLE.x && y === BLUE_TEMPLE.y) return "blue";
  return null;
}

function pieceCode(piece: GameState["board"][number] | undefined): string {
  if (!piece) return "..";
  const prefix = piece.player === "red" ? "R" : "B";
  const suffix = piece.type === "master" ? "M" : "S";
  return `${prefix}${suffix}`;
}

function renderBoardMatrix(state: GameState): string {
  const header = "     x=0  x=1  x=2  x=3  x=4";
  const rows = Array.from({ length: 5 }, (_, y) => {
    const cells = Array.from({ length: 5 }, (_, x) => pieceCode(state.board[y * 5 + x])).join("   ");
    return `y=${y}  ${cells}`;
  });
  return [header, ...rows].join("\n");
}

function renderGameStateSummary(state: GameState): string {
  return [
    `currentPlayer: ${state.currentPlayer}`,
    `turn: ${state.turn}`,
    `winner: ${state.winner ?? "none"}`,
    `winReason: ${state.winReason ?? "none"}`,
    `redCards: ${state.cards.red.map((card) => CARD_DEFINITIONS[card].name).join(", ")}`,
    `blueCards: ${state.cards.blue.map((card) => CARD_DEFINITIONS[card].name).join(", ")}`,
    `sideCard: ${CARD_DEFINITIONS[state.cards.side].name}`,
    "",
    renderBoardMatrix(state)
  ].join("\n");
}

function formatMove(move: Move): string {
  return `${CARD_DEFINITIONS[move.card].name} ${move.from.x},${move.from.y} -> ${move.to.x},${move.to.y}`;
}

function llmResult(match: LlmMatchLog): "win" | "loss" | "draw" {
  if (!match.winner) return "draw";
  return match.winner === match.llmSide ? "win" : "loss";
}

function averageLatency(totalMs: number, moveCount: number): string {
  if (moveCount <= 0) return "-";
  return `${(totalMs / moveCount).toFixed(1)} ms`;
}

function matchStateAt(match: LlmMatchLog, step: number): GameState {
  if (match.turns.length === 0) {
    return match.currentState;
  }
  if (step <= 0) {
    return match.turns[0]!.stateBefore;
  }
  return match.turns[step]?.stateBefore ?? match.currentState;
}

function cumulativeLatencyToStep(match: LlmMatchLog, step: number): number {
  return match.turns
    .slice(0, step)
    .filter((turn) => turn.actor === "llm")
    .reduce((sum, turn) => sum + (turn.latencyMs ?? 0), 0);
}

function gradeAverage(match: LlmMatchLog): string {
  const graded = match.turns.filter((turn) => turn.actor === "llm" && turn.grade);
  if (graded.length === 0) return "-";
  const score = graded.reduce((sum, turn) => sum + (turn.grade?.rank ?? 0) / (turn.grade?.legalMoveCount ?? 1), 0) / graded.length;
  return `${(score * 100).toFixed(1)}% rank`;
}

function PieceIcon({ player, type }: { player: Player; type: "master" | "student" }) {
  const className = `piece-icon ${player}`;

  if (type === "master") {
    return (
      <svg className={className} viewBox="0 0 64 64" role="img" aria-label={`${player} master`}>
        <path d="M32 9l15 8-4 8 7 7-8 6v13H22V38l-8-6 7-7-4-8z" fill="currentColor" />
        <path d="M24 43h16" stroke="rgba(255,255,255,0.55)" strokeWidth="3.3" strokeLinecap="round" />
        <circle cx="32" cy="30" r="5.8" fill="rgba(255,255,255,0.42)" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label={`${player} student`}>
      <ellipse cx="32" cy="18" rx="7" ry="6" fill="currentColor" />
      <path d="M20 25h24v20H20z" fill="currentColor" />
      <path d="M16 46h32v8H16z" fill="currentColor" />
      <path d="M24 34h16" stroke="rgba(255,255,255,0.44)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ReviewCard({ card, perspective, rotated = false }: { card: CardId; perspective: Player; rotated?: boolean }) {
  const deltas = orientCard(card, perspective);
  const markerSet = new Set(deltas.map(([dx, dy]) => `${dx},${dy}`));

  return (
    <div className={`review-card ${rotated ? "rotated" : ""}`.trim()}>
      <div className="review-card-name">{CARD_DEFINITIONS[card].name}</div>
      <div className="review-card-grid" aria-hidden="true">
        {Array.from({ length: 25 }, (_, idx) => {
          const x = idx % 5;
          const y = Math.floor(idx / 5);
          const dx = x - 2;
          const dy = y - 2;
          const isOrigin = dx === 0 && dy === 0;
          const isMove = markerSet.has(`${dx},${dy}`);
          return (
            <span
              key={`${card}-${perspective}-${idx}`}
              className={`review-card-cell ${isOrigin ? "origin" : ""} ${isMove ? "move" : ""}`.trim()}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const sessionIdFromUrl = urlParams.get("sessionId");
  const matchIdFromUrl = urlParams.get("matchId");
  const [sessionList, setSessionList] = useState<LlmSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessionIdFromUrl ?? "");
  const [session, setSession] = useState<LlmSessionLog | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string>(matchIdFromUrl ?? "");
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/review/llm/sessions", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("No LLM review sessions found.");
        }
        const payload = (await response.json()) as { sessions: LlmSessionSummary[] };
        setSessionList(payload.sessions);
        if (!selectedSessionId) {
          setSelectedSessionId(payload.sessions[0]?.sessionId ?? "");
        }
      })
      .catch((fetchError) => {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load LLM session list.");
      });
  }, []);

  useEffect(() => {
    if (!selectedSessionId) return;

    fetch(`/api/review/llm/session?sessionId=${encodeURIComponent(selectedSessionId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not load selected LLM review session.");
        }
        const payload = (await response.json()) as LlmSessionLog;
        setSession(payload);
        setError("");

        const nextMatch =
          payload.matches.find((match) => match.matchId === matchIdFromUrl) ??
          payload.matches.find((match) => llmResult(match) === "win") ??
          payload.matches[0] ??
          null;

        setSelectedMatchId(nextMatch?.matchId ?? "");
      })
      .catch((fetchError) => {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load selected LLM session.");
      });
  }, [selectedSessionId, matchIdFromUrl]);

  const selectedMatch = useMemo(
    () => session?.matches.find((match) => match.matchId === selectedMatchId) ?? session?.matches[0] ?? null,
    [session, selectedMatchId]
  );

  useEffect(() => {
    if (!selectedMatch) return;
    setStep(selectedMatch.turns.length);
  }, [selectedMatch?.matchId]);

  const maxStep = selectedMatch?.turns.length ?? 0;
  const safeStep = Math.min(step, maxStep);
  const state = selectedMatch ? matchStateAt(selectedMatch, safeStep) : null;
  const currentTurn = selectedMatch && safeStep > 0 ? selectedMatch.turns[safeStep - 1] ?? null : null;
  const topCards = state ? cardListFor(state, "blue") : null;
  const bottomCards = state ? cardListFor(state, "red") : null;
  const matchLatencyToStep = selectedMatch ? cumulativeLatencyToStep(selectedMatch, safeStep) : 0;
  const selectedSessionSummary = sessionList.find((item) => item.sessionId === selectedSessionId) ?? null;
  const sessionConfig = session?.config ?? DEFAULT_SESSION_CONFIG;

  useEffect(() => {
    if (!state || !selectedMatch || !session) return;

    window.render_game_to_text = () =>
      JSON.stringify({
        route: "review",
        sessionId: session.sessionId,
        matchId: selectedMatch.matchId,
        step: safeStep,
        totalSteps: selectedMatch.turns.length,
        llmSide: selectedMatch.llmSide,
        winner: selectedMatch.winner,
        llmResult: llmResult(selectedMatch),
        currentPlayer: state.currentPlayer,
        cards: state.cards
      });
    window.advanceTime = (ms: number) => {
      const steps = Math.max(1, Math.floor(ms / 800));
      setStep((current) => Math.min(selectedMatch.turns.length, current + steps));
    };

    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, [selectedMatch, safeStep, session, state]);

  if (error && !sessionList.length && !session) {
    return (
      <div className="review-page">
        <header className="review-toolbar">
          <div>
            <h1>LLM review</h1>
          </div>
          <nav className="review-toolbar-actions">
            <a href="/" className="review-link">Game</a>
            <a href="/review" className="review-link current">Review</a>
          </nav>
        </header>
        <main className="review-empty">{error}</main>
      </div>
    );
  }

  if (!session || !selectedMatch || !state || !topCards || !bottomCards) {
    return (
      <div className="review-page">
        <header className="review-toolbar">
          <div>
            <h1>LLM review</h1>
          </div>
          <nav className="review-toolbar-actions">
            <a href="/" className="review-link">Game</a>
            <a href="/review" className="review-link current">Review</a>
          </nav>
        </header>
        <main className="review-empty">Loading LLM review…</main>
      </div>
    );
  }

  const sessionAvgLatency = averageLatency(session.llmLatencyMsTotal, session.llmMoveCount);
  const matchAvgLatency = averageLatency(selectedMatch.llmLatencyMsTotal, selectedMatch.llmMoveCount);

  return (
    <div className="review-page">
      <header className="review-toolbar">
        <div>
          <h1>LLM review</h1>
          <div className="review-toolbar-line">
            <span>{session.modelId}</span>
            <span>{session.status}</span>
            <span>{new Date(session.updatedAtIso).toLocaleString()}</span>
          </div>
        </div>
        <nav className="review-toolbar-actions">
          <a href="/" className="review-link">Game</a>
          <a href="/review" className="review-link current">Review</a>
        </nav>
      </header>

      <div className="review-layout llm-review-layout">
        <aside className="review-sidebar">
          <h2>Sessions</h2>
          <div className="review-match-list">
            {sessionList.map((item) => (
              <button
                key={item.sessionId}
                type="button"
                className={`review-match-item ${item.sessionId === session.sessionId ? "active" : ""}`.trim()}
                onClick={() => setSelectedSessionId(item.sessionId)}
              >
                <div className="review-match-label">{item.modelId}</div>
                <div className="review-match-meta"><span>{item.sessionId}</span><span>{item.status}</span></div>
                <div className="review-match-meta"><span>LLM W-L-D</span><span>{item.llmWins}-{item.llmLosses}-{item.draws}</span></div>
                <div className="review-match-meta"><span>Avg latency</span><span>{averageLatency(item.llmLatencyMsTotal, item.llmMoveCount)}</span></div>
              </button>
            ))}
          </div>
        </aside>

        <main className="review-main">
          <section className="review-summary-grid">
            <div className="review-summary-card"><div className="review-summary-label">Session</div><div>{session.sessionId}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Model</div><div>{session.modelId}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Opponent</div><div>{session.opponentRunId}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Reasoning</div><div>{sessionConfig.reasoningEffort ?? "none"}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Output tokens</div><div>{sessionConfig.maxOutputTokens || "-"}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">JSON retries</div><div>{sessionConfig.jsonRetryCount || "-"}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Session W-L-D</div><div>{selectedSessionSummary ? `${selectedSessionSummary.llmWins}-${selectedSessionSummary.llmLosses}-${selectedSessionSummary.draws}` : "-"}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Session avg latency</div><div>{sessionAvgLatency}</div></div>
          </section>

          <section className="review-detail-panel">
            <h2>Matches</h2>
            <div className="review-chip-row">
              {session.matches.map((match) => (
                <button
                  key={match.matchId}
                  type="button"
                  className={`review-chip ${match.matchId === selectedMatch.matchId ? "active" : ""}`.trim()}
                  onClick={() => setSelectedMatchId(match.matchId)}
                >
                  {match.matchId.split("-").slice(-1)[0]} | LLM {llmResult(match)} | {match.llmSide}
                </button>
              ))}
            </div>
          </section>

          <section className="review-summary-grid">
            <div className="review-summary-card"><div className="review-summary-label">LLM side</div><div>{selectedMatch.llmSide}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Winner</div><div>{selectedMatch.winner ?? "draw"}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">LLM result</div><div className={`review-result ${llmResult(selectedMatch)}`}>{llmResult(selectedMatch)}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Reason</div><div>{selectedMatch.winReason ?? "none"}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">LLM moves</div><div>{selectedMatch.llmMoveCount}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Match avg latency</div><div>{matchAvgLatency}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Avg grade rank</div><div>{gradeAverage(selectedMatch)}</div></div>
            <div className="review-summary-card"><div className="review-summary-label">Board view</div><div>{safeStep === 0 ? "opening position" : `after move ${safeStep}`}</div></div>
          </section>

          <section className="review-stage">
            <div className="review-hand review-hand-top">
              {topCards.map((card) => <ReviewCard key={`top-${card}`} card={card} perspective="red" rotated />)}
            </div>

            <div className="review-board-row">
              <div className="review-board">
                {Array.from({ length: 25 }, (_, idx) => {
                  const x = idx % 5;
                  const y = Math.floor(idx / 5);
                  const piece = state.board[idx];
                  const temple = isTemple(x, y);
                  const involved = currentTurn
                    ? samePosition(currentTurn.chosenMove.from, { x, y }) || samePosition(currentTurn.chosenMove.to, { x, y })
                    : false;

                  return (
                    <div
                      key={`cell-${x}-${y}`}
                      className={`review-cell ${temple === "red" ? "temple-red" : ""} ${temple === "blue" ? "temple-blue" : ""} ${involved ? "active" : ""}`.trim()}
                    >
                      {piece ? <PieceIcon player={piece.player} type={piece.type} /> : <span className="review-empty-dot" />}
                    </div>
                  );
                })}
              </div>

              <div className="review-side-card-column">
                <div className="review-summary-label">Side</div>
                <ReviewCard card={state.cards.side} perspective="red" />
              </div>
            </div>

            <div className="review-hand review-hand-bottom">
              {bottomCards.map((card) => <ReviewCard key={`bottom-${card}`} card={card} perspective="red" />)}
            </div>
          </section>

          <section className="review-controls">
            <div className="review-control-buttons">
              <button type="button" onClick={() => setStep(0)} disabled={safeStep === 0}>First</button>
              <button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={safeStep === 0}>Prev</button>
              <button type="button" onClick={() => setStep((value) => Math.min(maxStep, value + 1))} disabled={safeStep >= maxStep}>Next</button>
              <button type="button" onClick={() => setStep(maxStep)} disabled={safeStep >= maxStep}>Last</button>
            </div>
            <label className="review-slider">
              <span>Move {safeStep} / {maxStep}</span>
              <input type="range" min={0} max={maxStep} value={safeStep} onChange={(event) => setStep(Number(event.target.value))} />
            </label>
          </section>

          <div className="review-detail-grid">
            <section className="review-detail-panel">
              <h2>Move list</h2>
              <div className="review-move-table">
                <div className="review-move-head"><span>#</span><span>Side</span><span>Actor</span><span>Grade</span><span>Move</span><span>Ms</span></div>
                {selectedMatch.turns.map((turn, idx) => (
                  <button
                    key={`${turn.stateHashAfter}-${idx}`}
                    type="button"
                    className={`review-move-row ${idx + 1 === safeStep ? "active" : ""}`.trim()}
                    onClick={() => setStep(idx + 1)}
                  >
                    <span>{idx + 1}</span>
                    <span>{turn.player}</span>
                    <span>{turn.actor}</span>
                    <span>{turn.actor === "llm" ? turn.grade?.letter ?? "-" : "-"}</span>
                    <span>{formatMove(turn.chosenMove)}</span>
                    <span>{turn.latencyMs ? `${turn.latencyMs}` : "-"}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="review-detail-panel">
              <h2>Selected move</h2>
              <div className="review-current-line">Match: {selectedMatch.matchId}</div>
              <div className="review-current-line">Players: red={selectedMatch.players.red} | blue={selectedMatch.players.blue}</div>
              <div className="review-current-line">Interpretation: LLM result is computed as winner === llmSide.</div>
              <div className="review-current-line">At step: {safeStep === 0 ? "opening position" : `board after move ${safeStep}`}</div>
              {currentTurn ? (
                <>
                  <div className="review-current-line">Actor: {currentTurn.actor}</div>
                  <div className="review-current-line">Move: {formatMove(currentTurn.chosenMove)}</div>
                  <div className="review-current-line">Latency: {currentTurn.latencyMs ? `${currentTurn.latencyMs} ms` : "-"}</div>
                  <div className="review-current-line">Cumulative LLM latency to step: {matchLatencyToStep} ms</div>
                  <div className="review-current-line">Finish reason: {currentTurn.finishReason ?? "-"}</div>
                  <div className="review-current-line">Usage: {currentTurn.usage?.totalTokens ?? 0} total tokens</div>
                  <div className="review-current-line">Error: {currentTurn.error ?? "-"}</div>
                  <div className="review-current-line">Grade: {currentTurn.actor === "llm" ? currentTurn.grade?.letter ?? "-" : "-"}</div>
                  <div className="review-current-line">Grade rank: {currentTurn.actor === "llm" && currentTurn.grade ? `${currentTurn.grade.rank}/${currentTurn.grade.legalMoveCount}` : "-"}</div>
                  <div className="review-current-line">Chosen score: {currentTurn.actor === "llm" && currentTurn.grade ? currentTurn.grade.chosenScore.toFixed(3) : "-"}</div>
                  <div className="review-current-line">Best score: {currentTurn.actor === "llm" && currentTurn.grade ? currentTurn.grade.bestScore.toFixed(3) : "-"}</div>
                  <div className="review-current-line">Delta from best: {currentTurn.actor === "llm" && currentTurn.grade ? currentTurn.grade.scoreDeltaFromBest.toFixed(3) : "-"}</div>
                  <div className="review-current-line mono">Recommended move: {currentTurn.actor === "llm" && currentTurn.grade ? formatMove(currentTurn.grade.recommendedMove) : "-"}</div>
                  <div className="review-current-line mono">Before hash: {currentTurn.stateHashBefore}</div>
                  <div className="review-current-line mono">After hash: {currentTurn.stateHashAfter}</div>
                  <div className="review-current-line mono">Raw response:</div>
                  <pre className="llm-pre">{currentTurn.rawResponse ?? "-"}</pre>
                  <div className="review-current-line mono">Prompt:</div>
                  <pre className="llm-pre">{currentTurn.prompt?.user ?? "-"}</pre>
                </>
              ) : (
                <div className="review-current-line">At the opening position.</div>
              )}
              <div className="review-current-line mono">Game state:</div>
              <pre className="llm-pre">{renderGameStateSummary(state)}</pre>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}
