import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  stateHash,
  type CardId,
  type GameState,
  type Move,
  type Player,
  CARD_DEFINITIONS
} from "@board-ai-lab/onitama-engine";
import {
  TRAINED_BOT_DEPTH,
  allMovesForSelection,
  cardListFor,
  createHeuristicOnitamaAgent,
  createRandomOnitamaAgent,
  isTemple,
  makeInitialState,
  onitamaEngine as engine,
  orientCard,
  samePosition
} from "@board-ai-lab/onitama-play";
import type { ReplayTurn } from "@board-ai-lab/replay-artifacts";

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

function CardDiagram({
  card,
  perspective,
  selected,
  disabled,
  readonly,
  rotated,
  onClick
}: {
  card: CardId;
  perspective: Player;
  selected?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  rotated?: boolean;
  onClick?: () => void;
}) {
  const deltas = orientCard(card, perspective);
  const markerSet = new Set(deltas.map(([dx, dy]) => `${dx},${dy}`));

  const tile = (
    <>
      <div className="card-topline">
        <span className={`card-stamp ${CARD_DEFINITIONS[card].stamp}`} aria-hidden="true" />
        <strong>{CARD_DEFINITIONS[card].name}</strong>
      </div>
      <div className="card-body">
        <div className="card-grid" aria-hidden="true">
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
                className={`card-grid-cell ${isOrigin ? "origin" : ""} ${isMove ? "move" : ""}`.trim()}
              />
            );
          })}
        </div>
      </div>
      <div className="card-bottomline">
        <span>{CARD_DEFINITIONS[card].stamp} stamp</span>
      </div>
    </>
  );

  if (readonly) {
    return (
      <div className={`card-shell ${rotated ? "rotated" : ""}`.trim()}>
        <div className="card-tile readonly">{tile}</div>
      </div>
    );
  }

  return (
    <div className={`card-shell ${rotated ? "rotated" : ""}`.trim()}>
      <button
        type="button"
        className={`card-tile ${selected ? "selected" : ""}`.trim()}
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
      >
        {tile}
      </button>
    </div>
  );
}

function ConfettiLayer() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 44 }, (_, idx) => ({
        id: idx,
        left: (idx * 17) % 100,
        delay: (idx % 8) * 0.15,
        duration: 2.2 + (idx % 6) * 0.35,
        hue: (idx * 37) % 360,
        rotate: (idx * 23) % 180
      })),
    []
  );

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          style={{
            left: `${piece.left}%`,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            backgroundColor: `hsl(${piece.hue}deg 95% 62%)`,
            transform: `rotate(${piece.rotate}deg)`
          }}
        />
      ))}
    </div>
  );
}

type BotMode = "random" | "trained";

interface TrainingManifestEntry {
  runId: string;
  createdAtIso: string;
  bestGenomePath: string;
  fitness: number;
  weights: Record<string, number>;
}

interface HumanScoreRecordResponse {
  ok: boolean;
  scoreboard?: {
    updatedAtIso: string;
    totals: {
      wins: number;
      losses: number;
      draws: number;
      games: number;
    };
    entries: HumanScoreEntry[];
  };
  totals?: {
    wins: number;
    losses: number;
    draws: number;
    games: number;
  };
  error?: string;
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

interface HumanScoreboardResponse {
  ok: boolean;
  scoreboard?: HumanScoreboard;
  error?: string;
}

export default function App() {
  const [humanSide, setHumanSide] = useState<Player>("red");
  const [botMode, setBotMode] = useState<BotMode>("random");
  const [showSetup, setShowSetup] = useState(false);
  const [state, setState] = useState<GameState>(() => makeInitialState());
  const [selectedFrom, setSelectedFrom] = useState<{ x: number; y: number } | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardId | null>(null);
  const [turns, setTurns] = useState<ReplayTurn[]>([]);
  const [status, setStatus] = useState<string>("Choose one of your cards, then move a piece.");
  const [trainedFileWeights, setTrainedFileWeights] = useState<Record<string, number> | null>(null);
  const [availableGenomes, setAvailableGenomes] = useState<TrainingManifestEntry[]>([]);
  const [selectedGenomeRunId, setSelectedGenomeRunId] = useState<string>("");
  const [scoreboard, setScoreboard] = useState<HumanScoreboard | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const gameSessionRef = useRef(0);
  const lastRecordedResultSessionRef = useRef<number | null>(null);

  const legalMoves = useMemo(() => engine.legalMoves(state), [state]);
  const isHumanTurn = state.currentPlayer === humanSide && !state.winner;
  const opponentSide: Player = humanSide === "red" ? "blue" : "red";

  const botAgent = useMemo(() => {
    if (botMode === "trained") {
      const w = trainedFileWeights;
      if (w) {
        return createHeuristicOnitamaAgent(
          {
            material: Number(w.material ?? 1),
            masterSafety: Number(w.masterSafety ?? 1),
            mobility: Number(w.mobility ?? 1),
            templePressure: Number(w.templePressure ?? 1),
            captureThreat: Number(w.captureThreat ?? 1),
            centerControl: Number(w.centerControl ?? 1),
            cardTempo: Number(w.cardTempo ?? 1)
          },
          TRAINED_BOT_DEPTH,
          "trained-bot"
        );
      }
      return createHeuristicOnitamaAgent(undefined, TRAINED_BOT_DEPTH, "trained-bot");
    }
    return createRandomOnitamaAgent(1337 + state.turn, "random-bot");
  }, [botMode, state.turn, trainedFileWeights]);

  const selectionMoves = useMemo(() => {
    if (!selectedFrom || !selectedCard) return [];
    return allMovesForSelection(legalMoves, selectedFrom, selectedCard);
  }, [legalMoves, selectedFrom, selectedCard]);

  const latestGenome = availableGenomes[0];
  const selectedGenomeStats = useMemo(() => {
    if (!scoreboard || !selectedGenomeRunId) {
      return {
        humanWins: 0,
        humanLosses: 0,
        draws: 0,
        games: 0,
        modelWins: 0,
        modelLosses: 0,
        averageHumanWinLength: 0,
        averageModelWinLength: 0,
        recentEntries: [] as HumanScoreEntry[]
      };
    }

    const entries = scoreboard.entries.filter((entry) => entry.trainedRunId === selectedGenomeRunId);
    const humanWins = entries.filter((entry) => entry.result === "win");
    const humanLosses = entries.filter((entry) => entry.result === "loss");
    const draws = entries.filter((entry) => entry.result === "draw");
    const averageHumanWinLength =
      humanWins.length > 0 ? humanWins.reduce((sum, entry) => sum + entry.moveCount, 0) / humanWins.length : 0;
    const averageModelWinLength =
      humanLosses.length > 0 ? humanLosses.reduce((sum, entry) => sum + entry.moveCount, 0) / humanLosses.length : 0;

    return {
      humanWins: humanWins.length,
      humanLosses: humanLosses.length,
      draws: draws.length,
      games: entries.length,
      modelWins: humanLosses.length,
      modelLosses: humanWins.length,
      averageHumanWinLength,
      averageModelWinLength,
      recentEntries: [...entries].sort((a, b) => b.recordedAtIso.localeCompare(a.recordedAtIso)).slice(0, 3)
    };
  }, [scoreboard, selectedGenomeRunId]);

  function loadManifestGenome(runId: string): void {
    const genome = availableGenomes.find((entry) => entry.runId === runId);
    if (!genome) {
      setStatus("Selected trained genome was not found.");
      return;
    }

    setSelectedGenomeRunId(runId);
    setTrainedFileWeights(genome.weights);
    setBotMode("trained");
    setStatus(`Loaded trained genome ${runId} (fitness ${genome.fitness.toFixed(4)}).`);
  }

  function resetGame(nextHumanSide = humanSide): void {
    gameSessionRef.current += 1;
    const initial = makeInitialState();
    setHumanSide(nextHumanSide);
    setState(initial);
    setSelectedFrom(null);
    setSelectedCard(null);
    setTurns([]);
    setStatus("Game reset.");
  }

  function applyMove(move: Move): void {
    const before = stateHash(state);
    const next = engine.applyMove(state, move);
    const after = stateHash(next);

    setTurns((prev) => [
      ...prev,
      {
        turn: state.turn,
        player: state.currentPlayer,
        move,
        stateHashBefore: before,
        stateHashAfter: after
      }
    ]);

    setState(next);
    setSelectedFrom(null);
    setSelectedCard(null);

    if (next.winner) {
      setStatus(`Winner: ${next.winner} (${next.winReason})`);
    } else {
      setStatus(`Turn ${next.turn}. ${next.currentPlayer} to move.`);
    }
  }

  function onCellClick(x: number, y: number): void {
    if (!isHumanTurn) return;

    const pos = { x, y };
    const piece = state.board[y * 5 + x];

    if (selectedFrom && selectedCard) {
      const matched = legalMoves.find(
        (move) => samePosition(move.from, selectedFrom) && samePosition(move.to, pos) && move.card === selectedCard
      );
      if (matched) {
        applyMove(matched);
        return;
      }
    }

    if (piece?.player === humanSide) {
      setSelectedFrom(pos);
    }
  }

  function exportReplay(): void {
    const payload = {
      runId: `play-${Date.now()}`,
      startedAtIso: new Date().toISOString(),
      players: {
        red: humanSide === "red" ? "human" : botMode,
        blue: humanSide === "blue" ? "human" : botMode
      },
      winner: state.winner,
      winReason: state.winReason,
      turns
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `replay-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onTrainedFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    let weights: Record<string, number> | null = null;

    if (typeof parsed === "object" && parsed !== null && "weights" in parsed) {
      const nested = (parsed as { weights?: unknown }).weights;
      if (typeof nested === "object" && nested !== null) {
        weights = nested as Record<string, number>;
      }
    } else if (typeof parsed === "object" && parsed !== null) {
      weights = parsed as Record<string, number>;
    }

    if (!weights) {
      setStatus("Invalid trained weights JSON.");
      return;
    }

    setTrainedFileWeights(weights);
    setStatus("Loaded trained weights.");
  }

  useEffect(() => {
    fetch("/training-manifest.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Manifest request failed with ${response.status}`);
        }
        const manifest = (await response.json()) as TrainingManifestEntry[];
        setAvailableGenomes(manifest);
        if (!selectedGenomeRunId && manifest[0]) {
          setSelectedGenomeRunId(manifest[0].runId);
        }
      })
      .catch(() => {
        setAvailableGenomes([]);
      });
  }, []);

  useEffect(() => {
    fetch("/api/human-scoreboard", { cache: "no-store" })
      .then(async (response) => {
        const result = (await response.json()) as HumanScoreboardResponse;
        if (!response.ok || !result.ok || !result.scoreboard) {
          throw new Error(result.error ?? `Scoreboard request failed with ${response.status}`);
        }
        setScoreboard(result.scoreboard);
      })
      .catch(() =>
        fetch("/human-scoreboard.json", { cache: "no-store" })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error(`Public scoreboard request failed with ${response.status}`);
            }
            const publicScoreboard = (await response.json()) as HumanScoreboard;
            setScoreboard(publicScoreboard);
          })
          .catch(() => {
            setScoreboard(null);
          })
      );
  }, []);

  useEffect(() => {
    if (turns.length === 0 || !boardRef.current) return;

    const latestIdx = turns.length - 1;
    toPng(boardRef.current)
      .then((dataUrl) => {
        setTurns((prev) => prev.map((turn, idx) => (idx === latestIdx ? { ...turn, pngDataUrl: dataUrl } : turn)));
      })
      .catch(() => {
        setStatus((prev) => `${prev} Snapshot failed.`);
      });
  }, [turns.length]);

  useEffect(() => {
    if (state.winner || isHumanTurn) return;

    const timeout = window.setTimeout(() => {
      const legal = engine.legalMoves(state);
      if (legal.length === 0) {
        setStatus("No legal moves for bot.");
        return;
      }
      const move = botAgent.selectMove(state, legal, { seed: state.turn });
      applyMove(move);
    }, 300 + Math.floor(Math.random() * 400));

    return () => window.clearTimeout(timeout);
  }, [state, isHumanTurn, botAgent]);

  useEffect(() => {
    if (!state.winner) return;
    if (botMode !== "trained") return;
    if (!selectedGenomeRunId) return;
    if (lastRecordedResultSessionRef.current === gameSessionRef.current) return;

    lastRecordedResultSessionRef.current = gameSessionRef.current;
    const humanResult = state.winner === humanSide ? "win" : "loss";

    const payload = {
      humanPlayer: "dimi",
      result: humanResult,
      moveCount: state.turn,
      humanSide,
      trainedRunId: selectedGenomeRunId,
      notes: "Recorded automatically from playground."
    };

    fetch("/api/human-scoreboard/record", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
      .then(async (response) => {
        const result = (await response.json()) as HumanScoreRecordResponse;
        if (!response.ok || !result.ok) {
          throw new Error(result.error ?? `Scoreboard request failed with ${response.status}`);
        }
        if (result.scoreboard) {
          setScoreboard(result.scoreboard);
        }
        setStatus(
          (prev) =>
            `${prev} Recorded ${humanResult} to scoreboard (${result.totals?.wins ?? "?"}-${result.totals?.losses ?? "?"}-${result.totals?.draws ?? "?"}).`
        );
      })
      .catch((error) => {
        setStatus((prev) => `${prev} Scoreboard save failed.`);
        console.error(error);
      });
  }, [botMode, humanSide, selectedGenomeRunId, state.turn, state.winner]);

  useEffect(() => {
    window.render_game_to_text = () => {
      const payload = {
        coordinateSystem: "origin=(0,0) top-left; x right, y down",
        currentPlayer: state.currentPlayer,
        winner: state.winner,
        selectedCard,
        selectedFrom,
        legalMoves: legalMoves.length,
        cards: state.cards,
        board: state.board.map((piece, idx) => ({
          x: idx % 5,
          y: Math.floor(idx / 5),
          piece: piece ? `${piece.player}-${piece.type}` : null
        }))
      };
      return JSON.stringify(payload);
    };

    window.advanceTime = () => {
      // Turn-based game uses event-driven timing; hook exists for deterministic test clients.
    };

    return () => {
      window.render_game_to_text = undefined;
      window.advanceTime = undefined;
    };
  }, [legalMoves.length, selectedCard, selectedFrom, state]);

  return (
    <main className="play-app">
      <header className="top-bar">
        <h1>Onitama Arena</h1>
        <div className="top-meta">
          <span className={`turn-chip ${state.currentPlayer}`}>{state.currentPlayer} to move</span>
          <span className="move-count">{turns.length} moves</span>
          {botMode === "trained" && selectedGenomeRunId ? (
            <span className="score-chip">
              {selectedGenomeRunId}: {selectedGenomeStats.modelWins}-{selectedGenomeStats.modelLosses}-{selectedGenomeStats.draws}
            </span>
          ) : null}
        </div>
        <div className="top-actions">
          <button type="button" onClick={() => resetGame()}>
            New game
          </button>
          <button type="button" onClick={() => setShowSetup(true)}>
            Setup
          </button>
          <a href="/review" className="action-link">
            Review
          </a>
        </div>
      </header>

      <p className={`status-line ${state.winner ? "win" : ""}`}>{status}</p>

      <section className="play-grid">
        <section className="table-layout">
          <section className="hand-strip opponent-strip" aria-label="Opponent hand">
            <div className="card-group hand-group">
              <h2>Opponent Hand</h2>
              <div className="card-list hand-row">
                {cardListFor(state, opponentSide).map((card) => (
                  <CardDiagram key={`opponent-${card}`} card={card} perspective={humanSide} readonly rotated />
                ))}
              </div>
            </div>
            <div className="side-card-placeholder" aria-hidden="true" />
          </section>

          <div className="board-row">
            <section className="board-stage" ref={boardRef}>
              <div className="board" role="grid" aria-label="Onitama board">
                {Array.from({ length: 25 }, (_, idx) => {
                  const x = idx % 5;
                  const y = Math.floor(idx / 5);
                  const piece = state.board[idx] ?? null;
                  const isSelected = selectedFrom ? selectedFrom.x === x && selectedFrom.y === y : false;
                  const isTarget = selectionMoves.some((move) => move.to.x === x && move.to.y === y);
                  const temple = isTemple(x, y);
                  const className = [
                    "cell",
                    piece ? `piece-${piece.player}` : "",
                    isSelected ? "selected" : "",
                    isTarget ? "target" : "",
                    temple ? `temple-${temple}` : ""
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <button type="button" key={`${x}-${y}`} className={className} onClick={() => onCellClick(x, y)}>
                      {piece ? <PieceIcon player={piece.player} type={piece.type} /> : <span className="empty-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>

              {state.winner ? (
                <div className="win-overlay" role="status" aria-live="polite">
                  <ConfettiLayer />
                  <div className="win-banner">
                    <h2>{state.winner.toUpperCase()} WINS</h2>
                    <p>{state.winReason === "temple-arch" ? "Temple Arch Victory" : "Master Captured"}</p>
                    <button type="button" onClick={() => resetGame()}>
                      Play Again
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <aside className="side-card-column" aria-label="Side card">
              <div className="card-group side-slot">
                <h2>Side Card</h2>
                <div className="card-list one-up">
                  <CardDiagram card={state.cards.side} perspective={state.currentPlayer} readonly />
                </div>
              </div>
            </aside>
          </div>

          <section className="hand-strip player-strip" aria-label="Your hand">
            <div className="card-group hand-group">
              <h2>Your Hand</h2>
              <div className="card-list hand-row">
                {cardListFor(state, humanSide).map((card) => (
                  <CardDiagram
                    key={`you-${card}`}
                    card={card}
                    perspective={humanSide}
                    selected={selectedCard === card}
                    disabled={!isHumanTurn}
                    onClick={() => setSelectedCard((prev) => (prev === card ? null : card))}
                  />
                ))}
              </div>
            </div>
            <div className="side-card-placeholder">
              <div className="card-group side-slot side-slot-ghost" aria-hidden="true">
                <h2>Side Card</h2>
              </div>
            </div>
          </section>
        </section>
      </section>

      {showSetup ? (
        <div className="setup-overlay" onClick={() => setShowSetup(false)}>
          <section className="setup-modal" onClick={(event) => event.stopPropagation()}>
            <h2>Match Setup</h2>
            <label>
              Human side
              <select
                value={humanSide}
                onChange={(event) => {
                  const side = event.target.value as Player;
                  resetGame(side);
                }}
              >
                <option value="red">Red</option>
                <option value="blue">Blue</option>
              </select>
            </label>

            <label>
              Bot mode
              <select value={botMode} onChange={(event) => setBotMode(event.target.value as BotMode)}>
                <option value="random">Random</option>
                <option value="trained">Trained (heuristic)</option>
              </select>
            </label>

            <label>
              Available trained genomes
              <select
                value={selectedGenomeRunId}
                onChange={(event) => {
                  const runId = event.target.value;
                  setSelectedGenomeRunId(runId);
                  if (runId) {
                    loadManifestGenome(runId);
                  }
                }}
              >
                <option value="">Select a trained genome</option>
                {availableGenomes.map((entry) => (
                  <option key={entry.runId} value={entry.runId}>
                    {entry.runId} | fitness {entry.fitness.toFixed(4)}
                  </option>
                ))}
              </select>
            </label>

            <div className="setup-actions">
              <button
                type="button"
                onClick={() => {
                  if (latestGenome) {
                    loadManifestGenome(latestGenome.runId);
                  } else {
                    setStatus("No trained genome manifest found yet.");
                  }
                }}
              >
                Use latest genome
              </button>
            </div>

            {botMode === "trained" && selectedGenomeRunId ? (
              <section className="scoreboard-panel" aria-label="Human scoreboard">
                <h3>Selected Genome Record</h3>
                <div className="scoreboard-summary">
                  <div>
                    <span className="score-label">Record</span>
                    <strong>
                      {selectedGenomeStats.modelWins}-{selectedGenomeStats.modelLosses}-{selectedGenomeStats.draws}
                    </strong>
                  </div>
                  <div>
                    <span className="score-label">Games</span>
                    <strong>{selectedGenomeStats.games}</strong>
                  </div>
                  <div>
                    <span className="score-label">Avg win length</span>
                    <strong>
                      {selectedGenomeStats.modelWins > 0 ? `${selectedGenomeStats.averageModelWinLength.toFixed(1)} moves` : "-"}
                    </strong>
                  </div>
                  <div>
                    <span className="score-label">Avg loss length</span>
                    <strong>
                      {selectedGenomeStats.modelLosses > 0
                        ? `${selectedGenomeStats.averageHumanWinLength.toFixed(1)} moves`
                        : "-"}
                    </strong>
                  </div>
                </div>
                <p className="scoreboard-overall">
                  Human vs selected genome:{" "}
                  {selectedGenomeStats.humanWins}-{selectedGenomeStats.humanLosses}-{selectedGenomeStats.draws}
                </p>
                <p className="scoreboard-overall">
                  Overall human record:{" "}
                  {scoreboard
                    ? `${scoreboard.totals.wins}-${scoreboard.totals.losses}-${scoreboard.totals.draws} across ${scoreboard.totals.games} games`
                    : "not loaded"}
                </p>
                <div className="scoreboard-history">
                  {selectedGenomeStats.recentEntries.length > 0 ? (
                    selectedGenomeStats.recentEntries.map((entry) => (
                      <div key={entry.id} className="score-entry">
                        <strong>{entry.result.toUpperCase()}</strong>
                        <span>{entry.moveCount} moves</span>
                        <span>{new Date(entry.recordedAtIso).toLocaleString()}</span>
                      </div>
                    ))
                  ) : (
                    <p className="scoreboard-empty">No recorded human games against this genome yet.</p>
                  )}
                </div>
              </section>
            ) : null}

            <label>
              Fallback: load trained weights JSON
              <input type="file" accept="application/json" onChange={onTrainedFileChange} />
            </label>

            <div className="setup-actions">
              <button type="button" onClick={exportReplay}>
                Export replay JSON
              </button>
              <button type="button" onClick={() => setShowSetup(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
