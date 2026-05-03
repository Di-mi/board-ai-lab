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
  stackAt,
  topPieceAt,
  type BugType,
  type HexCoordinate,
  type HiveMove,
  type HiveState,
  type Player as HivePlayer,
  type Winner
} from "@board-ai-lab/hive-engine";
import {
  PUBLIC_ONITAMA_DIFFICULTIES,
  allMovesForSelection,
  cardListFor,
  createPublicOnitamaBot,
  isTemple,
  makeInitialState,
  onitamaEngine,
  orientCard,
  samePosition,
  type OnitamaDifficultyId
} from "@board-ai-lab/onitama-play";
import { CARD_DEFINITIONS, type CardId, type GameState, type Move, type Player } from "@board-ai-lab/onitama-engine";
import type { PublicBenchmarks } from "../lib/benchmarks.js";
import {
  trackHiveMove,
  trackHiveReserveSelected,
  trackOnitamaCardSelected,
  trackOnitamaMove,
  trackPlayDifficultyChanged,
  trackPlayGameSelected,
  trackPlayMatchEnded,
  trackPlayMatchStarted,
  trackPlaySideChanged
} from "../lib/analytics.js";

const HIVE_HEX_WIDTH = 96;
const HIVE_HEX_HEIGHT = 84;
const HIVE_HEX_X_STEP = 72;
const HIVE_HEX_Y_STEP = 84;
const HIVE_HEX_COLUMN_OFFSET = 42;
const HIVE_BOARD_PADDING = 18;

const HIVE_BUG_LABELS: Record<BugType, string> = {
  queen: "Queen Bee",
  beetle: "Beetle",
  spider: "Spider",
  grasshopper: "Grasshopper",
  ant: "Soldier Ant"
};

const HIVE_PLAYER_LABELS: Record<HivePlayer, string> = {
  white: "White",
  black: "Black"
};

const HIVE_PUBLIC_DIFFICULTIES = [
  { id: "easy", label: "Easy", description: "Random legal-move bot." },
  { id: "standard", label: "Medium", description: "Pinned heuristic Hive bot." },
  { id: "hard", label: "Hard", description: "Pinned strongest Hive bot." }
] as const;

type HiveDifficultyId = (typeof HIVE_PUBLIC_DIFFICULTIES)[number]["id"];

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

function hiveWinnerLabel(winner: Winner | undefined): string {
  if (!winner) return "";
  if (winner === "draw") return "Draw";
  return `${HIVE_PLAYER_LABELS[winner]} wins`;
}

function hiveBugDescription(bug: BugType): string {
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
  }
}

function computeVisibleHiveHexes(
  state: HiveState,
  legalMoves: HiveMove[],
  selectedReserve: BugType | null,
  selectedHex: HexCoordinate | null
) {
  const map = new Map<string, HexCoordinate>();
  const addHex = (hex: HexCoordinate) => map.set(keyOf(hex), hex);
  const occupied = Object.keys(state.cells).map((key) => {
    const parts = key.split(",");
    const q = Number(parts[0] ?? 0);
    const r = Number(parts[1] ?? 0);
    return { q, r };
  });

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

  return [...map.values()];
}

function hiveAxialToPixel(hex: HexCoordinate): { x: number; y: number } {
  return {
    x: hex.q * HIVE_HEX_X_STEP,
    y: hex.r * HIVE_HEX_Y_STEP + hex.q * HIVE_HEX_COLUMN_OFFSET
  };
}

function HiveBugIcon({ bug, player, size = 32 }: { bug: BugType; player: HivePlayer; size?: number }) {
  const colors: Record<BugType, string> = {
    queen: "#fbbf24",
    beetle: "#c084fc",
    spider: "#fb923c",
    grasshopper: "#34d399",
    ant: "#60a5fa"
  };
  const color = colors[bug];
  const detail = player === "white" ? "rgba(20,10,0,0.45)" : "rgba(255,255,255,0.38)";
  const outline = player === "white" ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.82)";

  switch (bug) {
    case "queen":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size}>
          <polygon points="3,18 3,13 7.5,16 12,4 16.5,16 21,13 21,18" fill={color} />
          <rect x="3" y="17.5" width="18" height="3.5" rx="1.5" fill={color} />
          <circle cx="7" cy="19.5" r="1" fill={detail} />
          <circle cx="12" cy="19.5" r="1" fill={detail} />
          <circle cx="17" cy="19.5" r="1" fill={detail} />
        </svg>
      );
    case "beetle":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size}>
          <path d="M12 4C8.5 4 5.5 7 5.5 11.5C5.5 16.5 8.5 21 12 21C15.5 21 18.5 16.5 18.5 11.5C18.5 7 15.5 4 12 4Z" fill={color} stroke={outline} strokeWidth="0.85" />
          <circle cx="12" cy="3.5" r="2.5" fill={color} stroke={outline} strokeWidth="0.85" />
          <line x1="12" y1="4.5" x2="12" y2="21" stroke={detail} strokeWidth="1.8" />
          <path d="M10.5 2 Q8 0 6 0.5" stroke={outline} strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M13.5 2 Q16 0 18 0.5" stroke={outline} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "spider":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size}>
          <circle cx="12" cy="14" r="4.5" fill={color} />
          <circle cx="12" cy="7" r="2.8" fill={color} />
          <g stroke={color} strokeWidth="1.4" strokeLinecap="round" fill="none">
            <path d="M8.5 11 L4 8" /><path d="M8.5 13 L2.5 13" />
            <path d="M8.5 16 L4 19" /><path d="M9.5 18 L7 22" />
            <path d="M15.5 11 L20 8" /><path d="M15.5 13 L21.5 13" />
            <path d="M15.5 16 L20 19" /><path d="M14.5 18 L17 22" />
          </g>
          <circle cx="10.5" cy="6.5" r="0.9" fill={detail} />
          <circle cx="13.5" cy="6.5" r="0.9" fill={detail} />
        </svg>
      );
    case "grasshopper":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size}>
          <ellipse cx="10.5" cy="14" rx="9" ry="3.5" transform="rotate(-15 10.5 14)" fill={color} />
          <circle cx="19.5" cy="8.5" r="2.5" fill={color} />
          <path d="M4 13 L1 7.5 L3.5 5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M15 10.5 L17.5 8" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
          <path d="M17 11.5 L20 10" stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="none" />
          <path d="M20.5 7 Q22 4.5 23 4" stroke={color} strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "ant":
      return (
        <svg viewBox="0 0 24 24" width={size} height={size}>
          <circle cx="12" cy="4.5" r="2.5" fill={color} />
          <circle cx="12" cy="11" r="3" fill={color} />
          <ellipse cx="12" cy="19" rx="3.5" ry="4" fill={color} />
          <path d="M10.5 2.5 Q8.5 0.5 7 1" stroke={color} strokeWidth="1.3" fill="none" strokeLinecap="round" />
          <path d="M13.5 2.5 Q15.5 0.5 17 1" stroke={color} strokeWidth="1.3" fill="none" strokeLinecap="round" />
          <g stroke={color} strokeWidth="1.3" strokeLinecap="round" fill="none">
            <path d="M9.5 10 L5.5 7.5" /><path d="M9.5 11.5 L5 11.5" /><path d="M9.5 13 L5.5 15.5" />
            <path d="M14.5 10 L18.5 7.5" /><path d="M14.5 11.5 L19 11.5" /><path d="M14.5 13 L18.5 15.5" />
          </g>
        </svg>
      );
  }
}

function HivePiece({ player, bug, size = "board" }: { player: HivePlayer; bug: BugType; size?: "board" | "reserve" | "mini" }) {
  const iconSize = size === "board" ? 36 : size === "reserve" ? 26 : 16;
  return (
    <div className={`hive-disc hive-disc-${player} hive-disc-${bug}`}>
      <HiveBugIcon bug={bug} player={player} size={iconSize} />
    </div>
  );
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
  const def = CARD_DEFINITIONS[card];
  const deltas = def ? orientCard(card, perspective) : [];

  const contents = (
    <>
      <div className="move-card-header">
        <strong>{def?.name ?? card}</strong>
      </div>
      <div className="move-card-grid">
        {Array.from({ length: 25 }, (_, idx) => {
          const dr = Math.floor(idx / 5) - 2;
          const dc = (idx % 5) - 2;
          const isOrigin = dr === 0 && dc === 0;
          const isMove = deltas.some(([dx, dy]) => dx === dc && dy === dr);
          return <div key={idx} className={`move-card-cell${isOrigin ? " origin" : ""}${isMove ? " move" : ""}`} />;
        })}
      </div>
    </>
  );

  if (readonly) {
    return <div className={["move-card", "readonly", rotated ? "rotated" : ""].filter(Boolean).join(" ")}>{contents}</div>;
  }

  return (
    <button
      type="button"
      className={["move-card", selected ? "selected" : "", rotated ? "rotated" : ""].filter(Boolean).join(" ")}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
    >
      {contents}
    </button>
  );
}

function PieceIcon({ player, type }: { player: Player; type: string }) {
  const color = player === "red" ? "red" : "blue";
  if (type === "master") {
    return (
      <svg viewBox="0 0 32 32" fill="currentColor" className={`piece-icon ${color}`}>
        <polygon points="6,14 10,7 14,12 16,6 18,12 22,7 26,14" />
        <rect x="5" y="13" width="22" height="12" rx="5" ry="5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 32 32" fill="currentColor" className={`piece-icon ${color}`}>
      <circle cx="16" cy="9" r="5" />
      <path d="M9 28 Q7 22 10 18 Q13 15 16 15 Q19 15 22 18 Q25 22 23 28 Z" />
    </svg>
  );
}

function useConfetti(active: boolean) {
  useEffect(() => {
    if (!active) return;

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const context = canvas.getContext("2d");
    if (!context) {
      canvas.remove();
      return;
    }
    const ctx = context;

    const colors = ["#e8b96a", "#8b7cf8", "#36d983", "#f0665c", "#28c4ae", "#f0b740", "#b2a8fb"];
    const particles = Array.from({ length: 140 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 80,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      w: 7 + Math.random() * 7,
      h: 4 + Math.random() * 4,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.18,
      color: colors[Math.floor(Math.random() * colors.length)] ?? "#e8b96a",
      alpha: 1
    }));

    let raf = 0;
    let frame = 0;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame += 1;
      let alive = 0;
      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.07;
        particle.angle += particle.spin;
        if (frame > 90) particle.alpha = Math.max(0, particle.alpha - 0.012);
        if (particle.alpha > 0 && particle.y < canvas.height + 30) alive += 1;
        ctx.save();
        ctx.globalAlpha = particle.alpha;
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.angle);
        ctx.fillStyle = particle.color;
        ctx.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h);
        ctx.restore();
      }

      if (alive > 0) {
        raf = requestAnimationFrame(draw);
      } else {
        canvas.remove();
      }
    }

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      canvas.remove();
    };
  }, [active]);
}

function OnitamaArena() {
  const humanSide: Player = "red";
  const [difficultyId, setDifficultyId] = useState<OnitamaDifficultyId>("standard");
  const [state, setState] = useState<GameState>(() => makeInitialState());
  const [selectedFrom, setSelectedFrom] = useState<{ x: number; y: number } | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardId | null>(null);
  const [status, setStatus] = useState("New match loaded.");
  const [showConfetti, setShowConfetti] = useState(false);
  const legalMoves = useMemo(() => onitamaEngine.legalMoves(state), [state]);
  const isHumanTurn = state.currentPlayer === humanSide && !state.winner;
  const opponentSide: Player = humanSide === "red" ? "blue" : "red";

  useConfetti(showConfetti);

  const selectionMoves = useMemo(() => {
    if (!selectedFrom || !selectedCard) return [];
    return allMovesForSelection(legalMoves, selectedFrom, selectedCard);
  }, [legalMoves, selectedCard, selectedFrom]);

  function resetMatch(nextDifficulty = difficultyId): void {
    if (nextDifficulty !== difficultyId) {
      trackPlayDifficultyChanged("onitama", nextDifficulty);
    }
    trackPlayMatchStarted("onitama", nextDifficulty, humanSide);
    setDifficultyId(nextDifficulty);
    setState(makeInitialState());
    setSelectedCard(null);
    setSelectedFrom(null);
    setStatus("New match loaded.");
    setShowConfetti(false);
  }

  function applyMove(move: Move): void {
    const next = onitamaEngine.applyMove(state, move);
    if (state.currentPlayer === humanSide) {
      trackOnitamaMove(move, state.turn, humanSide);
    }
    setState(next);
    setSelectedCard(null);
    setSelectedFrom(null);
    if (next.winner) {
      const humanWon = next.winner === humanSide;
      trackPlayMatchEnded("onitama", next.winner, humanWon, next.turn);
      setStatus(humanWon ? "🎉 You win!" : "Bot wins.");
      if (humanWon) setShowConfetti(true);
      return;
    }
    setStatus(`${next.currentPlayer === humanSide ? "Your" : "Bot"} turn.`);
  }

  function onCellClick(x: number, y: number): void {
    if (!isHumanTurn) return;
    const position = { x, y };
    const piece = state.board[y * 5 + x];

    if (selectedFrom && selectedCard) {
      const matched = legalMoves.find(
        (move) => samePosition(move.from, selectedFrom) && samePosition(move.to, position) && move.card === selectedCard
      );
      if (matched) {
        applyMove(matched);
        return;
      }
    }

    if (piece?.player === humanSide) {
      setSelectedFrom(position);
    }
  }

  useEffect(() => {
    if (state.winner || isHumanTurn) return;
    const timeout = window.setTimeout(() => {
      const bot = createPublicOnitamaBot(difficultyId, { seed: state.turn + 91 });
      const move = bot.selectMove(state, legalMoves, { seed: state.turn });
      applyMove(move);
    }, 280);
    return () => window.clearTimeout(timeout);
  }, [difficultyId, isHumanTurn, legalMoves, state]);

  return (
    <section className="play-board-card">
      <div className="play-headline">
        <div>
          <h2>Onitama</h2>
          <p>Human as red. Bot tiers match the public benchmark labels.</p>
        </div>
        <div className="play-actions">
          {PUBLIC_ONITAMA_DIFFICULTIES.map((difficulty) => (
            <button key={difficulty.id} type="button" className={difficultyId === difficulty.id ? "mini-button active" : "mini-button"} onClick={() => resetMatch(difficulty.id)}>
              {difficulty.label}
            </button>
          ))}
          <button type="button" className="mini-button" onClick={() => resetMatch()}>
            New match
          </button>
        </div>
      </div>
      <p className="play-status">{status}</p>
      <div className="arena-layout">
        <div className="arena-stage">
          <section className="hand-row" aria-label="Opponent cards">
            {cardListFor(state, opponentSide).map((card) => (
              <CardDiagram key={`opponent-${card}`} card={card} perspective={humanSide} readonly rotated />
            ))}
          </section>
          <div className="board-layout">
            <div className="board-card">
              <div className="board-grid" role="grid" aria-label="Onitama board">
                {Array.from({ length: 25 }, (_, idx) => {
                  const x = idx % 5;
                  const y = Math.floor(idx / 5);
                  const piece = state.board[idx] ?? null;
                  const isSelected = selectedFrom ? selectedFrom.x === x && selectedFrom.y === y : false;
                  const isTarget = selectionMoves.some((move) => move.to.x === x && move.to.y === y);
                  const temple = isTemple(x, y);
                  const cellClass = ["board-cell", isSelected ? "selected" : "", isTarget ? "target" : "", temple ? `temple-${temple}` : ""].filter(Boolean).join(" ");
                  return (
                    <button type="button" key={`${x}-${y}`} className={cellClass} onClick={() => onCellClick(x, y)}>
                      {piece ? <PieceIcon player={piece.player} type={piece.type} /> : <span className="empty-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </div>
            <aside className="side-card-panel">
              <span className="panel-label">Center card</span>
              <CardDiagram card={state.cards.side} perspective={state.currentPlayer} readonly />
            </aside>
          </div>
          <section className="hand-row" aria-label="Player cards">
            {cardListFor(state, humanSide).map((card) => (
              <CardDiagram
                key={`player-${card}`}
                card={card}
                perspective={humanSide}
                selected={selectedCard === card}
                disabled={!isHumanTurn}
                onClick={() => {
                  const selected = selectedCard !== card;
                  trackOnitamaCardSelected(card, selected);
                  setSelectedCard(selected ? card : null);
                }}
              />
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}

function HiveArena() {
  const [state, setState] = useState<HiveState>(() => makeInitialHiveState(77));
  const [humanSide, setHumanSide] = useState<HivePlayer>("white");
  const [difficultyId, setDifficultyId] = useState<HiveDifficultyId>("standard");
  const [trainingManifest, setTrainingManifest] = useState<HiveTrainingManifestEntry[]>([]);
  const [botTiers, setBotTiers] = useState<HiveBotTierManifest | null>(null);
  const [selectedReserve, setSelectedReserve] = useState<BugType | null>(null);
  const [selectedHex, setSelectedHex] = useState<HexCoordinate | null>(null);
  const [status, setStatus] = useState("Place a piece from your reserve to begin.");
  const [history, setHistory] = useState<string[]>([]);

  const legalMoves = useMemo(() => hiveEngine.legalMoves(state), [state]);
  const isHumanTurn = state.currentPlayer === humanSide && !state.winner;
  const opponentSide: HivePlayer = humanSide === "white" ? "black" : "white";

  const selectedRunId = useMemo(() => {
    if (difficultyId === "standard") return botTiers?.mediumRunId;
    if (difficultyId === "hard") return botTiers?.hardRunId ?? botTiers?.latestRunId;
    return undefined;
  }, [botTiers, difficultyId]);

  const selectedGenome = useMemo(
    () => trainingManifest.find((entry) => entry.runId === selectedRunId),
    [trainingManifest, selectedRunId]
  );

  const opponentAgent = useMemo(() => {
    if (difficultyId === "easy" || !selectedGenome) {
      return createRandomHiveAgent(9000 + state.turn, "public-hive-random");
    }

    const depth = difficultyId === "hard" ? 2 : 1;
    return new HiveHeuristicAgent(selectedGenome.weights, depth, selectedGenome.runId);
  }, [difficultyId, selectedGenome, state.turn]);

  const selectedTargets = useMemo(
    () =>
      legalMoves.filter((move) => {
        if (selectedReserve && move.type === "place") return move.bug === selectedReserve;
        if (selectedHex && move.type === "move") return sameHex(move.from, selectedHex);
        return false;
      }),
    [legalMoves, selectedReserve, selectedHex]
  );

  const visibleHexes = useMemo(
    () => computeVisibleHiveHexes(state, legalMoves, selectedReserve, selectedHex),
    [state, legalMoves, selectedReserve, selectedHex]
  );

  const visiblePixels = useMemo(() => {
    const points = visibleHexes.map((hex) => ({ key: keyOf(hex), hex, ...hiveAxialToPixel(hex) }));
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
      width: maxX - minX + HIVE_HEX_WIDTH + HIVE_BOARD_PADDING * 2,
      height: maxY - minY + HIVE_HEX_HEIGHT + HIVE_BOARD_PADDING * 2
    };
  }, [visibleHexes]);

  const passMove = legalMoves.length === 1 && legalMoves[0]?.type === "pass" ? legalMoves[0] : null;

  function describeHiveMove(move: HiveMove): string {
    if (move.type === "pass") return "pass";
    if (move.type === "place") return `place ${HIVE_BUG_LABELS[move.bug]} at (${move.to.q}, ${move.to.r})`;
    return `move from (${move.from.q}, ${move.from.r}) to (${move.to.q}, ${move.to.r})`;
  }

  function resetGame(nextHumanSide = humanSide, nextDifficulty = difficultyId) {
    if (nextHumanSide !== humanSide) {
      trackPlaySideChanged("hive", nextHumanSide);
    }
    if (nextDifficulty !== difficultyId) {
      trackPlayDifficultyChanged("hive", nextDifficulty);
    }
    trackPlayMatchStarted("hive", nextDifficulty, nextHumanSide);
    setState(makeInitialHiveState(77));
    setSelectedReserve(null);
    setSelectedHex(null);
    setHistory([]);
    const difficultyLabel = HIVE_PUBLIC_DIFFICULTIES.find((entry) => entry.id === nextDifficulty)?.label ?? "bot";
    setStatus(nextHumanSide === "white" ? "Place a piece from your reserve to begin." : `${difficultyLabel} bot opens the game.`);
  }

  function applyHiveMove(move: HiveMove) {
    const next = hiveEngine.applyMove(state, move);
    if (state.currentPlayer === humanSide) {
      trackHiveMove(move, state.turn, humanSide);
    }
    setState(next);
    setSelectedReserve(null);
    setSelectedHex(null);
    setHistory((previous) => [...previous, `${HIVE_PLAYER_LABELS[state.currentPlayer]}: ${describeHiveMove(move)}`]);
    if (next.winner) {
      trackPlayMatchEnded("hive", next.winner, next.winner === humanSide, next.turn);
      setStatus(hiveWinnerLabel(next.winner));
      return;
    }
    setStatus(`${HIVE_PLAYER_LABELS[next.currentPlayer]} to move.`);
  }

  function handleHiveHexClick(hex: HexCoordinate) {
    if (!isHumanTurn) return;

    const placeMove = selectedReserve
      ? selectedTargets.find((move): move is Extract<HiveMove, { type: "place" }> => move.type === "place" && sameHex(move.to, hex))
      : undefined;
    if (placeMove) {
      applyHiveMove(placeMove);
      return;
    }

    const moveTarget = selectedHex
      ? selectedTargets.find((move): move is Extract<HiveMove, { type: "move" }> => move.type === "move" && sameHex(move.to, hex))
      : undefined;
    if (moveTarget) {
      applyHiveMove(moveTarget);
      return;
    }

    const top = topPieceAt(state, hex);
    if (top?.player === humanSide) {
      const hasMoves = legalMoves.some((move) => move.type === "move" && sameHex(move.from, hex));
      setSelectedReserve(null);
      setSelectedHex(hasMoves ? hex : null);
      setStatus(hasMoves ? `Selected ${HIVE_BUG_LABELS[top.bug]}. Choose a highlighted destination.` : "That piece cannot move right now.");
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
      fetch("/hive-bot-tiers.json", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as HiveBotTierManifest;
      })
    ])
      .then(([manifest, tiers]) => {
        setTrainingManifest(
          manifest.map((entry) => ({
            ...entry,
            weights: normalizeHiveWeights(entry.weights)
          }))
        );
        setBotTiers(tiers);
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
        applyHiveMove(move);
      }, difficultyId === "easy" ? 550 : difficultyId === "standard" ? 420 : 360);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [state, isHumanTurn, legalMoves, opponentAgent, difficultyId]);

  useEffect(() => {
    if (difficultyId !== "easy" && !selectedGenome && trainingManifest.length > 0) {
      setStatus(`Pinned ${difficultyId} Hive bot is not available in the public manifest yet.`);
    }
  }, [difficultyId, selectedGenome, trainingManifest.length]);

  return (
    <section className="play-board-card hive-play-card">
      <div className="play-headline">
        <div>
          <h2>Hive</h2>
          <p>Base Hive. Same easy, medium, and hard tiers used in the public benchmark.</p>
        </div>
        <div className="play-actions">
          <button type="button" className={humanSide === "white" ? "mini-button active" : "mini-button"} onClick={() => { setHumanSide("white"); resetGame("white", difficultyId); }}>
            Play White
          </button>
          <button type="button" className={humanSide === "black" ? "mini-button active" : "mini-button"} onClick={() => { setHumanSide("black"); resetGame("black", difficultyId); }}>
            Play Black
          </button>
          {HIVE_PUBLIC_DIFFICULTIES.map((difficulty) => (
            <button
              key={difficulty.id}
              type="button"
              className={difficultyId === difficulty.id ? "mini-button active" : "mini-button"}
              onClick={() => {
                setDifficultyId(difficulty.id);
                resetGame(humanSide, difficulty.id);
              }}
            >
              {difficulty.label}
            </button>
          ))}
          <button type="button" className="mini-button" onClick={() => resetGame()}>
            New match
          </button>
        </div>
      </div>
      <p className="play-status">{status}</p>

      <div className="hive-public-layout">
        <aside className="hive-public-sidebar">
          <section className="hive-public-panel">
            <h3>Your Reserve</h3>
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
                      const selected = selectedReserve !== bug;
                      trackHiveReserveSelected(bug, selected);
                      setSelectedHex(null);
                      setSelectedReserve(selected ? bug : null);
                      setStatus(selected ? `Selected ${HIVE_BUG_LABELS[bug]}. Choose a highlighted placement hex.` : "Place a piece from your reserve.");
                    }}
                  >
                    <span className="hive-reserve-main">
                      <HivePiece player={humanSide} bug={bug} size="reserve" />
                      <span>
                        <strong>{HIVE_BUG_LABELS[bug]}</strong>
                        <small>{hiveBugDescription(bug)}</small>
                      </span>
                    </span>
                    <span className="hive-reserve-count">{available}</span>
                  </button>
                );
              })}
            </div>
            {isHumanTurn && passMove ? (
              <button type="button" className="hive-pass-button" onClick={() => applyHiveMove(passMove)}>
                Pass
              </button>
            ) : null}
          </section>

          <section className="hive-public-panel">
            <h3>Benchmark Tier</h3>
            <p>{HIVE_PUBLIC_DIFFICULTIES.find((entry) => entry.id === difficultyId)?.description}</p>
            <div className="hive-reserve-mini">
              {HIVE_BASE_BUGS.map((bug) => (
                <div key={bug} className="hive-mini-row">
                  <HivePiece player={opponentSide} bug={bug} size="mini" />
                  <span>{HIVE_BUG_LABELS[bug]}</span>
                  <strong>{state.reserves[opponentSide][bug]}</strong>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <main className="hive-public-board">
          <div className="hive-board-wrap">
            <div className="hive-board-canvas" style={{ width: `${visiblePixels.width}px`, height: `${visiblePixels.height}px` }}>
              {visiblePixels.points.map(({ hex, x, y }) => {
                const stack = stackAt(state, hex);
                const top = stack[stack.length - 1];
                const isSelected = selectedHex ? sameHex(selectedHex, hex) : false;
                const isTarget = selectedTargets.some((move) => move.type !== "pass" && sameHex(move.to, hex));
                const isSource = selectedTargets.some((move) => move.type === "move" && sameHex(move.from, hex));
                const left = x - visiblePixels.minX + HIVE_BOARD_PADDING;
                const topPx = y - visiblePixels.minY + HIVE_BOARD_PADDING;

                return (
                  <button
                    key={keyOf(hex)}
                    type="button"
                    data-bug={top?.bug}
                    data-player={top?.player}
                    className={`hive-hex ${top ? "occupied" : "empty"} ${isSelected ? "selected" : ""} ${isTarget ? "target" : ""} ${isSource ? "source" : ""}`.trim()}
                    onClick={() => handleHiveHexClick(hex)}
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
                <strong>{hiveWinnerLabel(state.winner)}</strong>
                <span>The queen is fully surrounded.</span>
                <button type="button" onClick={() => resetGame()}>
                  Play Again
                </button>
              </div>
            </div>
          ) : null}
        </main>

        <aside className="hive-public-sidebar">
          <section className="hive-public-panel">
            <h3>Rules Snapshot</h3>
            <ul className="hive-rule-list">
              <li>Place your queen by your fourth turn.</li>
              <li>You cannot move pieces before your queen is placed.</li>
              <li>The hive must stay connected.</li>
              <li>Surround the opposing queen to win.</li>
            </ul>
          </section>

          <section className="hive-public-panel">
            <h3>Move Log</h3>
            <div className="hive-history">
              {history.length === 0 ? <p>No moves yet.</p> : history.slice().reverse().map((entry, index) => <div key={`${entry}-${index}`}>{entry}</div>)}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

export function PlayPage({ data }: { data: PublicBenchmarks }) {
  const availableGames = data.games.filter((game) => game.status === "playable");
  const [activeGameId, setActiveGameId] = useState<string>(availableGames[0]?.id ?? "onitama");

  return (
    <div className="play-layout">
      <section className="page-card play-callout">
        <div className="play-top-bar">
          <div className="play-top-left">
            <h2 className="play-page-title">Play The Benchmarks</h2>
            <p className="play-page-sub">Same public tiers, same rules, direct browser play.</p>
          </div>
          <div className="game-switcher" role="tablist">
            {availableGames.map((game) => (
              <button
                key={game.id}
                type="button"
                role="tab"
                aria-selected={activeGameId === game.id}
                className={`game-switcher-tab${activeGameId === game.id ? " active" : ""}`}
                onClick={() => {
                  trackPlayGameSelected(game.id);
                  setActiveGameId(game.id);
                }}
              >
                <span className="game-switcher-name">{game.label}</span>
                <span className="game-switcher-hint">{game.id === "hive" ? "Hex strategy" : "5×5 tactics"}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
      {activeGameId === "hive" ? <HiveArena /> : <OnitamaArena />}
    </div>
  );
}
