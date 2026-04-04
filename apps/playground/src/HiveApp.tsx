import { useEffect, useMemo, useState } from "react";
import { HiveHeuristicAgent, normalizeHiveWeights, type HiveHeuristicWeights } from "@board-ai-lab/hive-ga";
import {
  HIVE_BASE_BUGS,
  createRandomHiveAgent,
  hiveEngine,
  makeInitialHiveState,
  sameHex
} from "@board-ai-lab/hive-play";
import {
  keyOf,
  parseKey,
  stackAt,
  stateHash,
  topPieceAt,
  type BugType,
  type HexCoordinate,
  type HiveMove,
  type HiveState,
  type Player,
  type Winner
} from "@board-ai-lab/hive-engine";

const BUG_LABELS: Record<BugType, string> = {
  queen: "Queen Bee",
  beetle: "Beetle",
  spider: "Spider",
  grasshopper: "Grasshopper",
  ant: "Soldier Ant"
};

/** Signature colour per bug type */
const BUG_COLORS: Record<BugType, string> = {
  queen:       "#fbbf24",
  beetle:      "#c084fc",
  spider:      "#fb923c",
  grasshopper: "#34d399",
  ant:         "#60a5fa",
};

const PLAYER_LABELS: Record<Player, string> = {
  white: "White",
  black: "Black"
};

const HEX_WIDTH = 96;
const HEX_HEIGHT = 84;
const HEX_X_STEP = 72;
const HEX_Y_STEP = 84;
const HEX_COLUMN_OFFSET = 42;
const BOARD_PADDING = 18;
const HIVE_TRAINED_BOT_DEPTH = 1;

type HiveBotMode = "random" | "trained";

interface HiveTrainingManifestEntry {
  runId: string;
  createdAtIso: string;
  fitness: number;
  weights: HiveHeuristicWeights;
}

interface HiveBotTierManifest {
  updatedAtIso: string;
  latestRunId?: string;
  mediumRunId?: string;
  hardRunId?: string;
}

function winnerLabel(winner: Winner | undefined): string {
  if (!winner) return "";
  if (winner === "draw") return "Draw";
  return `${PLAYER_LABELS[winner]} wins`;
}

function bugDescription(bug: BugType): string {
  switch (bug) {
    case "queen":
      return "Slides 1 hex";
    case "beetle":
      return "Moves 1 hex, can climb";
    case "spider":
      return "Slides exactly 3 hexes";
    case "grasshopper":
      return "Jumps in a straight line";
    case "ant":
      return "Slides any distance";
    default:
      return "";
  }
}

function BugIcon({ bug, player, size = 32 }: { bug: BugType; player: Player; size?: number }) {
  const c = BUG_COLORS[bug]!;
  const d = player === "white" ? "rgba(20,10,0,0.45)" : "rgba(255,255,255,0.38)";
  const outline = player === "white" ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.82)";

  switch (bug) {
    case "queen": return (
      <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
        {/* Crown */}
        <polygon points="3,18 3,13 7.5,16 12,4 16.5,16 21,13 21,18" fill={c} />
        <rect x="3" y="17.5" width="18" height="3.5" rx="1.5" fill={c} />
        {/* Gems */}
        <circle cx="7" cy="19.5" r="1" fill={d} />
        <circle cx="12" cy="19.5" r="1" fill={d} />
        <circle cx="17" cy="19.5" r="1" fill={d} />
      </svg>
    );
    case "beetle": return (
      <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
        {/* Wing-case body */}
        <path d="M12 4C8.5 4 5.5 7 5.5 11.5C5.5 16.5 8.5 21 12 21C15.5 21 18.5 16.5 18.5 11.5C18.5 7 15.5 4 12 4Z" fill={c} stroke={outline} strokeWidth="0.85" />
        {/* Head */}
        <circle cx="12" cy="3.5" r="2.5" fill={c} stroke={outline} strokeWidth="0.85" />
        {/* Elytra seam */}
        <line x1="12" y1="4.5" x2="12" y2="21" stroke={d} strokeWidth="1.8" />
        {/* Antennae */}
        <path d="M10.5 2 Q8 0 6 0.5" stroke={outline} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M13.5 2 Q16 0 18 0.5" stroke={outline} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </svg>
    );
    case "spider": return (
      <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
        {/* Abdomen */}
        <circle cx="12" cy="14" r="4.5" fill={c} />
        {/* Cephalothorax */}
        <circle cx="12" cy="7" r="2.8" fill={c} />
        {/* 4 leg pairs */}
        <g stroke={c} strokeWidth="1.4" strokeLinecap="round" fill="none">
          <path d="M8.5 11 L4 8" /><path d="M8.5 13 L2.5 13" />
          <path d="M8.5 16 L4 19" /><path d="M9.5 18 L7 22" />
          <path d="M15.5 11 L20 8" /><path d="M15.5 13 L21.5 13" />
          <path d="M15.5 16 L20 19" /><path d="M14.5 18 L17 22" />
        </g>
        {/* Eyes */}
        <circle cx="10.5" cy="6.5" r="0.9" fill={d} />
        <circle cx="13.5" cy="6.5" r="0.9" fill={d} />
      </svg>
    );
    case "grasshopper": return (
      <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
        {/* Body */}
        <ellipse cx="10.5" cy="14" rx="9" ry="3.5" transform="rotate(-15 10.5 14)" fill={c} />
        {/* Head */}
        <circle cx="19.5" cy="8.5" r="2.5" fill={c} />
        {/* Hind leg (bent) */}
        <path d="M4 13 L1 7.5 L3.5 5" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {/* Front legs */}
        <path d="M15 10.5 L17.5 8" stroke={c} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M17 11.5 L20 10" stroke={c} strokeWidth="1.5" strokeLinecap="round" fill="none" />
        {/* Antenna */}
        <path d="M20.5 7 Q22 4.5 23 4" stroke={c} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </svg>
    );
    case "ant": return (
      <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
        {/* Head */}
        <circle cx="12" cy="4.5" r="2.5" fill={c} />
        {/* Thorax */}
        <circle cx="12" cy="11" r="3" fill={c} />
        {/* Abdomen */}
        <ellipse cx="12" cy="19" rx="3.5" ry="4" fill={c} />
        {/* Antennae */}
        <path d="M10.5 2.5 Q8.5 0.5 7 1" stroke={c} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M13.5 2.5 Q15.5 0.5 17 1" stroke={c} strokeWidth="1.3" fill="none" strokeLinecap="round" />
        {/* 6 legs */}
        <g stroke={c} strokeWidth="1.3" strokeLinecap="round" fill="none">
          <path d="M9.5 10 L5.5 7.5" /><path d="M9.5 11.5 L5 11.5" /><path d="M9.5 13 L5.5 15.5" />
          <path d="M14.5 10 L18.5 7.5" /><path d="M14.5 11.5 L19 11.5" /><path d="M14.5 13 L18.5 15.5" />
        </g>
      </svg>
    );
  }
}

function ConfettiLayer() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, idx) => ({
        id: idx,
        left: (idx * 19) % 100,
        delay: (idx % 7) * 0.16,
        duration: 2.1 + (idx % 5) * 0.34,
        hue: (idx * 41) % 360,
        rotate: (idx * 29) % 180
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

/** Piece disc — wraps the bug SVG icon in a player-coloured circle */
function HivePiece({ player, bug, size = "board" }: { player: Player; bug: BugType; size?: "board" | "reserve" | "mini" }) {
  const iconSize = size === "board" ? 36 : size === "reserve" ? 26 : 16;
  return (
    <div className={`hive-disc hive-disc-${player} hive-disc-${bug}`}>
      <BugIcon bug={bug} player={player} size={iconSize} />
    </div>
  );
}

function computeVisibleHexes(state: HiveState, legalMoves: HiveMove[], selectedReserve: BugType | null, selectedHex: HexCoordinate | null) {
  const map = new Map<string, HexCoordinate>();
  const addHex = (hex: HexCoordinate) => map.set(keyOf(hex), hex);

  const occupied = Object.keys(state.cells).map(parseKey);
  if (occupied.length === 0) {
    addHex({ q: 0, r: 0 });
  }

  for (const hex of occupied) {
    addHex(hex);
    addHex({ q: hex.q + 1, r: hex.r });
    addHex({ q: hex.q - 1, r: hex.r });
    addHex({ q: hex.q, r: hex.r + 1 });
    addHex({ q: hex.q, r: hex.r - 1 });
    addHex({ q: hex.q + 1, r: hex.r - 1 });
    addHex({ q: hex.q - 1, r: hex.r + 1 });
  }

  for (const move of legalMoves) {
    if (move.type === "place") addHex(move.to);
    if (move.type === "move") {
      addHex(move.from);
      addHex(move.to);
    }
  }

  if (selectedHex) addHex(selectedHex);

  const selectedTargets = legalMoves.filter((move) => {
    if (selectedReserve && move.type === "place") return move.bug === selectedReserve;
    if (selectedHex && move.type === "move") return sameHex(move.from, selectedHex);
    return false;
  });
  for (const move of selectedTargets) {
    if (move.type === "place") addHex(move.to);
    if (move.type === "move") addHex(move.to);
  }

  const hexes = [...map.values()];
  const qs = hexes.map((hex) => hex.q);
  const rs = hexes.map((hex) => hex.r);
  const minQ = Math.min(...qs, 0);
  const maxQ = Math.max(...qs, 0);
  const minR = Math.min(...rs, 0);
  const maxR = Math.max(...rs, 0);

  return { hexes, minQ, maxQ, minR, maxR };
}

function axialToPixel(hex: HexCoordinate): { x: number; y: number } {
  return {
    x: hex.q * HEX_X_STEP,
    y: hex.r * HEX_Y_STEP + hex.q * HEX_COLUMN_OFFSET
  };
}

export default function HiveApp() {
  const [state, setState] = useState<HiveState>(() => makeInitialHiveState(77));
  const [humanSide, setHumanSide] = useState<Player>("white");
  const [botMode, setBotMode] = useState<HiveBotMode>("random");
  const [trainingManifest, setTrainingManifest] = useState<HiveTrainingManifestEntry[]>([]);
  const [botTiers, setBotTiers] = useState<HiveBotTierManifest | null>(null);
  const [selectedGenomeRunId, setSelectedGenomeRunId] = useState<string>("");
  const [trainedWeights, setTrainedWeights] = useState<HiveHeuristicWeights | null>(null);
  const [selectedReserve, setSelectedReserve] = useState<BugType | null>(null);
  const [selectedHex, setSelectedHex] = useState<HexCoordinate | null>(null);
  const [status, setStatus] = useState("Place a piece from your reserve to begin.");
  const [history, setHistory] = useState<string[]>([]);

  const legalMoves = useMemo(() => hiveEngine.legalMoves(state), [state]);
  const isHumanTurn = state.currentPlayer === humanSide && !state.winner;
  const opponentSide: Player = humanSide === "white" ? "black" : "white";
  const opponentAgent = useMemo(() => {
    if (botMode === "trained" && trainedWeights) {
      return new HiveHeuristicAgent(
        trainedWeights,
        HIVE_TRAINED_BOT_DEPTH,
        selectedGenomeRunId || "trained-hive-bot"
      );
    }
    return createRandomHiveAgent(9000 + state.turn, "hive-random-bot");
  }, [botMode, trainedWeights, selectedGenomeRunId, state.turn]);

  const selectedTargets = useMemo(() => {
    return legalMoves.filter((move) => {
      if (selectedReserve && move.type === "place") return move.bug === selectedReserve;
      if (selectedHex && move.type === "move") return sameHex(move.from, selectedHex);
      return false;
    });
  }, [legalMoves, selectedReserve, selectedHex]);

  const visible = useMemo(
    () => computeVisibleHexes(state, legalMoves, selectedReserve, selectedHex),
    [state, legalMoves, selectedReserve, selectedHex]
  );
  const visiblePixels = useMemo(() => {
    const points = visible.hexes.map((hex) => ({
      key: keyOf(hex),
      hex,
      ...axialToPixel(hex)
    }));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs, 0);
    const maxX = Math.max(...xs, 0);
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, 0);
    return {
      points,
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX + HEX_WIDTH + BOARD_PADDING * 2,
      height: maxY - minY + HEX_HEIGHT + BOARD_PADDING * 2
    };
  }, [visible]);

  const activeGenome = useMemo(
    () => trainingManifest.find((entry) => entry.runId === selectedGenomeRunId),
    [trainingManifest, selectedGenomeRunId]
  );

  function resetGame(nextHumanSide = humanSide, nextBotMode = botMode) {
    setState(makeInitialHiveState(77));
    setSelectedReserve(null);
    setSelectedHex(null);
    setHistory([]);
    const botLabel = nextBotMode === "trained" && activeGenome ? `trained bot ${activeGenome.runId}` : "random bot";
    setStatus(nextHumanSide === "white" ? "Place a piece from your reserve to begin." : `${botLabel} opens the game.`);
  }

  function applyMove(move: HiveMove) {
    const next = hiveEngine.applyMove(state, move);
    setState(next);
    setSelectedReserve(null);
    setSelectedHex(null);
    setHistory((prev) => [...prev, `${PLAYER_LABELS[state.currentPlayer]}: ${describeMove(move)}`]);
    if (next.winner) {
      setStatus(winnerLabel(next.winner));
    } else {
      setStatus(`${PLAYER_LABELS[next.currentPlayer]} to move.`);
    }
  }

  function describeMove(move: HiveMove): string {
    if (move.type === "pass") return "pass";
    if (move.type === "place") return `place ${BUG_LABELS[move.bug]} at (${move.to.q}, ${move.to.r})`;
    return `move from (${move.from.q}, ${move.from.r}) to (${move.to.q}, ${move.to.r})`;
  }

  function handleHexClick(hex: HexCoordinate) {
    if (!isHumanTurn) return;

    const placeMove = selectedReserve
      ? selectedTargets.find((move): move is Extract<HiveMove, { type: "place" }> => move.type === "place" && sameHex(move.to, hex))
      : undefined;
    if (placeMove) {
      applyMove(placeMove);
      return;
    }

    const moveTarget = selectedHex
      ? selectedTargets.find((move): move is Extract<HiveMove, { type: "move" }> => move.type === "move" && sameHex(move.to, hex))
      : undefined;
    if (moveTarget) {
      applyMove(moveTarget);
      return;
    }

    const top = topPieceAt(state, hex);
    if (top?.player === humanSide) {
      const hasMoves = legalMoves.some((move) => move.type === "move" && sameHex(move.from, hex));
      setSelectedReserve(null);
      setSelectedHex(hasMoves ? hex : null);
      setStatus(hasMoves ? `Selected ${BUG_LABELS[top.bug]}. Choose a highlighted destination.` : "That piece cannot move right now.");
      return;
    }

    setSelectedReserve(null);
    setSelectedHex(null);
  }

  useEffect(() => {
    Promise.all([
      fetch("/hive-training-manifest.json", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return [] as HiveTrainingManifestEntry[];
        return (await response.json()) as HiveTrainingManifestEntry[];
      }),
      fetch("/hive-bot-tiers.json", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as HiveBotTierManifest;
        })
        .catch(() => null)
    ])
      .then(([entries, tiers]) => {
        const normalizedEntries = entries.map((entry) => ({
          ...entry,
          weights: normalizeHiveWeights(entry.weights)
        }));
        setTrainingManifest(normalizedEntries);
        setBotTiers(tiers);
        if (!selectedGenomeRunId) {
          const preferredRunId = tiers?.mediumRunId ?? normalizedEntries[0]?.runId;
          const preferredGenome = normalizedEntries.find((entry) => entry.runId === preferredRunId) ?? normalizedEntries[0];
          if (preferredGenome) {
            setSelectedGenomeRunId(preferredGenome.runId);
            setTrainedWeights(preferredGenome.weights);
          }
        }
      })
      .catch(() => {
        setTrainingManifest([]);
        setBotTiers(null);
      });
  }, []);

  useEffect(() => {
    if (!state.winner && !isHumanTurn) {
      const timeout = window.setTimeout(() => {
        const move = opponentAgent.selectMove(state, legalMoves);
        applyMove(move);
      }, botMode === "trained" ? 550 : 700 + (state.turn % 3) * 250);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [state, isHumanTurn, legalMoves, opponentAgent, botMode]);

  useEffect(() => {
    if (botMode === "trained" && !trainedWeights) {
      setStatus("No trained Hive genome is available yet. Run hive-train first.");
    }
  }, [botMode, trainedWeights]);

  const passMove = legalMoves.length === 1 && legalMoves[0]?.type === "pass" ? legalMoves[0] : null;

  function applySelectedGenome(runId: string) {
    const genome = trainingManifest.find((entry) => entry.runId === runId);
    if (!genome) {
      setStatus("Selected Hive genome was not found.");
      return;
    }
    setSelectedGenomeRunId(runId);
    setTrainedWeights(normalizeHiveWeights(genome.weights));
    setBotMode("trained");
    setStatus(`Loaded Hive genome ${runId} (fitness ${genome.fitness.toFixed(4)}).`);
  }

  return (
    <div className="hive-page">
      <header className="hive-topbar">
        <div>
          <h1>Hive Playground</h1>
          <p>Base game only. White starts. No expansions yet.</p>
        </div>
        <div className="hive-topbar-actions">
          <a href="/">Onitama</a>
          <button type="button" onClick={() => resetGame()}>New Game</button>
        </div>
      </header>

      <section className="hive-toolbar">
        <div className="hive-toolbar-group">
          <span>Play as</span>
          <button type="button" className={humanSide === "white" ? "active" : ""} onClick={() => { setHumanSide("white"); resetGame("white", botMode); }}>White</button>
          <button type="button" className={humanSide === "black" ? "active" : ""} onClick={() => { setHumanSide("black"); resetGame("black", botMode); }}>Black</button>
        </div>
        <div className="hive-toolbar-group">
          <span>Opponent</span>
          <button type="button" className={botMode === "random" ? "active" : ""} onClick={() => { setBotMode("random"); resetGame(humanSide, "random"); }}>Random</button>
          <button
            type="button"
            className={botMode === "trained" ? "active" : ""}
            disabled={!trainedWeights}
            onClick={() => {
              if (!trainedWeights) {
                setStatus("No trained Hive genome is available yet. Run hive-train first.");
                return;
              }
              setBotMode("trained");
              resetGame(humanSide, "trained");
            }}
          >
            Trained
          </button>
        </div>
        <div className="hive-toolbar-group status">
          <span>Turn</span>
          <strong>{state.turn}</strong>
          <span>{status}</span>
        </div>
        <div className="hive-toolbar-group status">
          <span>Hash</span>
          <code>{stateHash(state).slice(0, 28)}...</code>
        </div>
      </section>

      <div className="hive-layout">
        <aside className="hive-sidebar">
          <section className="hive-panel">
            <h2>Your Reserve</h2>
            <div className="hive-reserve-list">
              {HIVE_BASE_BUGS.map((bug) => {
                const available = state.reserves[humanSide][bug];
                const canPlace = legalMoves.some((move) => move.type === "place" && move.bug === bug);
                return (
                  <button
                    key={bug}
                    type="button"
                    className={`hive-reserve-item hive-reserve-${bug} ${selectedReserve === bug ? "active" : ""}`.trim()}
                    disabled={!isHumanTurn || available === 0 || !canPlace}
                    onClick={() => {
                      setSelectedHex(null);
                      setSelectedReserve((current) => (current === bug ? null : bug));
                      setStatus(`Selected ${BUG_LABELS[bug]}. Choose a highlighted placement hex.`);
                    }}
                  >
                    <span className="hive-reserve-main">
                      <HivePiece player={humanSide} bug={bug} size="reserve" />
                      <span>
                        <strong>{BUG_LABELS[bug]}</strong>
                        <small>{bugDescription(bug)}</small>
                      </span>
                    </span>
                    <span className="hive-reserve-count">{available}</span>
                  </button>
                );
              })}
            </div>
            {isHumanTurn && passMove ? (
              <button type="button" className="hive-pass-button" onClick={() => applyMove(passMove)}>
                Pass
              </button>
            ) : null}
          </section>

          <section className="hive-panel">
            <h2>Opponent Bot</h2>
            <p>
              {botMode === "trained" && activeGenome
                ? `${PLAYER_LABELS[opponentSide]} uses trained genome ${activeGenome.runId}.`
                : `${PLAYER_LABELS[opponentSide]} uses a random legal-move agent. This is only for engine testing.`}
            </p>
            <label className="hive-genome-picker">
              <span>Available Hive genomes</span>
              <select
                value={selectedGenomeRunId}
                onChange={(event) => {
                  const runId = event.target.value;
                  setSelectedGenomeRunId(runId);
                  const genome = trainingManifest.find((entry) => entry.runId === runId) ?? null;
                  setTrainedWeights(genome ? normalizeHiveWeights(genome.weights) : null);
                }}
              >
                <option value="">Select a trained genome</option>
                {trainingManifest.map((entry) => (
                  <option key={entry.runId} value={entry.runId}>
                    {entry.runId} | fitness {entry.fitness.toFixed(4)}
                  </option>
                ))}
              </select>
            </label>
            <div className="hive-opponent-actions">
              <button
                type="button"
                disabled={trainingManifest.length === 0}
                onClick={() => {
                  const mediumRunId = botTiers?.mediumRunId;
                  if (!mediumRunId) {
                    setStatus("No medium Hive bot is pinned yet.");
                    return;
                  }
                  applySelectedGenome(mediumRunId);
                  resetGame(humanSide, "trained");
                }}
              >
                Use medium bot
              </button>
              <button
                type="button"
                disabled={trainingManifest.length === 0}
                onClick={() => {
                  const latest = trainingManifest[0];
                  if (!latest) {
                    setStatus("No Hive training manifest found yet.");
                    return;
                  }
                  applySelectedGenome(latest.runId);
                  resetGame(humanSide, "trained");
                }}
              >
                Use latest genome
              </button>
              {activeGenome ? <strong className="hive-genome-badge">{activeGenome.runId}</strong> : null}
            </div>
            <div className="hive-reserve-mini">
              {HIVE_BASE_BUGS.map((bug) => (
                <div key={bug} className="hive-mini-row">
                  <HivePiece player={opponentSide} bug={bug} size="mini" />
                  <span>{BUG_LABELS[bug]}</span>
                  <strong>{state.reserves[opponentSide][bug]}</strong>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <main className="hive-board-panel">
          <div className="hive-board-wrap">
            <div
              className="hive-board-canvas"
              style={{
                width: `${visiblePixels.width}px`,
                height: `${visiblePixels.height}px`
              }}
            >
              {visiblePixels.points.map(({ hex, x, y }) => {
                const stack = stackAt(state, hex);
                const top = stack[stack.length - 1];
                const isSelected = selectedHex ? sameHex(selectedHex, hex) : false;
                const isTarget = selectedTargets.some((move) => move.type !== "pass" && sameHex(move.to, hex));
                const isSource = selectedTargets.some((move) => move.type === "move" && sameHex(move.from, hex));
                const left = x - visiblePixels.minX + BOARD_PADDING;
                const topPx = y - visiblePixels.minY + BOARD_PADDING;
                return (
                  <button
                    key={keyOf(hex)}
                    type="button"
                    data-bug={top?.bug}
                    data-player={top?.player}
                    className={`hive-hex ${top ? "occupied" : "empty"} ${isSelected ? "selected" : ""} ${isTarget ? "target" : ""} ${isSource ? "source" : ""}`.trim()}
                    onClick={() => handleHexClick(hex)}
                    style={{ left: `${left}px`, top: `${topPx}px` }}
                  >
                    {top ? (
                      <>
                        <HivePiece player={top.player} bug={top.bug} size="board" />
                        {stack.length > 1 ? <span className="hive-stack-count">×{stack.length}</span> : null}
                      </>
                    ) : (
                      <span className="hive-empty-dot" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {state.winner ? (
            <div className="hive-win-overlay">
              <ConfettiLayer />
              <div className="hive-win-banner">
                <strong>{winnerLabel(state.winner)}</strong>
                <span>Queens can no longer escape the hive.</span>
                <button type="button" onClick={() => resetGame()}>
                  Play Again
                </button>
              </div>
            </div>
          ) : null}
        </main>

        <aside className="hive-sidebar right">
          <section className="hive-panel">
            <h2>Rules Snapshot</h2>
            <ul className="hive-rule-list">
              <li>Place your queen by your fourth turn.</li>
              <li>You cannot move pieces before your queen is placed.</li>
              <li>The hive must stay in one connected group.</li>
              <li>Surround the opposing queen to win.</li>
            </ul>
          </section>

          <section className="hive-panel">
            <h2>Move Log</h2>
            <div className="hive-history">
              {history.length === 0 ? <p>No moves yet.</p> : history.slice().reverse().map((entry, index) => <div key={`${entry}-${index}`}>{entry}</div>)}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
