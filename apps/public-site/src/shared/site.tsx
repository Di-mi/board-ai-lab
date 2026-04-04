import { type CSSProperties, type ReactNode } from "react";
import type { Filters } from "../lib/benchmarks.js";

export type PublicSitePage = "leaderboard" | "latency" | "methodology" | "rulebook" | "play";

const PAGE_PATHS: Record<PublicSitePage, string> = {
  leaderboard: "/index.html",
  latency: "/latency.html",
  methodology: "/methodology.html",
  rulebook: "/rulebook.html",
  play: "/play.html"
};

export function fixed(value: number): string {
  return value.toFixed(1);
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function formatMs(value: number): string {
  return `${Math.round(value)} ms`;
}

export function pageTitle(page: PublicSitePage): string {
  switch (page) {
    case "leaderboard":
      return "Meeples & Models | Leaderboard";
    case "latency":
      return "Meeples & Models | Latency";
    case "methodology":
      return "Meeples & Models | Methodology";
    case "rulebook":
      return "Meeples & Models | Rulebook";
    case "play":
      return "Meeples & Models | Play";
  }
}

export function providerClass(provider: string | undefined): string {
  if (!provider) return "provider-other";
  return `provider-${provider}`;
}

export function isPublicSitePage(value: string | null): value is PublicSitePage {
  return value === "leaderboard" || value === "latency" || value === "methodology" || value === "rulebook" || value === "play";
}

export function readFilters(): Filters {
  const params = new URLSearchParams(window.location.search);
  return {
    gameId: params.get("game") ?? "all",
    difficultyId: params.get("difficulty") ?? "all",
    modelId: params.get("model") ?? "all"
  };
}

export function readPageFromLocation(): PublicSitePage {
  const pathname = window.location.pathname;
  const matchedPage = (Object.entries(PAGE_PATHS) as Array<[PublicSitePage, string]>).find(([, pagePath]) => pagePath === pathname)?.[0];
  if (matchedPage) {
    return matchedPage;
  }

  const params = new URLSearchParams(window.location.search);
  const pageParam = params.get("page");
  return isPublicSitePage(pageParam) ? pageParam : "leaderboard";
}

export function writeUrlState(page: PublicSitePage, filters: Filters): void {
  const params = new URLSearchParams();
  if (filters.gameId !== "all") params.set("game", filters.gameId);
  if (filters.difficultyId !== "all") params.set("difficulty", filters.difficultyId);
  if (filters.modelId !== "all") params.set("model", filters.modelId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  window.history.replaceState({}, "", `${PAGE_PATHS[page]}${suffix}`);
}

export function pageHref(page: PublicSitePage, filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.gameId !== "all") params.set("game", filters.gameId);
  if (filters.difficultyId !== "all") params.set("difficulty", filters.difficultyId);
  if (filters.modelId !== "all") params.set("model", filters.modelId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `${PAGE_PATHS[page]}${suffix}`;
}

export function MeepleGlyph({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <circle cx="12" cy="5.5" r="3.2" />
      <path d="M4 22c0-5 2.5-8.2 5-9l-1.2 8h8.4L15 13c2.5.8 5 4 5 9H4z" />
    </svg>
  );
}

export function HexToken({
  className,
  children
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span className={`hex-badge${className ? ` ${className}` : ""}`}>
      <svg viewBox="0 0 56 48" className="hex-badge-bg" aria-hidden="true">
        <polygon points="54,24 41,1.5 15,1.5 2,24 15,46.5 41,46.5" />
      </svg>
      {children ? <span className="hex-badge-label">{children}</span> : null}
    </span>
  );
}

export function CornerMeeple({ className }: { className?: string }) {
  return <MeepleGlyph className={`corner-meeple${className ? ` ${className}` : ""}`} />;
}

export function RankMeeple() {
  return <MeepleGlyph className="rank-meeple" />;
}

export function HexBadge({ children, className }: { children: ReactNode; className?: string }) {
  return <HexToken className={className}>{children}</HexToken>;
}

export function MeepleBullet({ color }: { color?: string }) {
  return <MeepleGlyph className="meeple-bullet" style={color ? { color } : undefined} />;
}

export function DiceFace({ pips, color }: { pips: 1 | 3 | 6; color: string }) {
  const activePips =
    pips === 1
      ? [5]
      : pips === 3
        ? [1, 5, 9]
        : [1, 3, 4, 6, 7, 9];

  const pipPositions = [
    { id: 1, cx: 6.5, cy: 6.5 },
    { id: 2, cx: 12, cy: 6.5 },
    { id: 3, cx: 17.5, cy: 6.5 },
    { id: 4, cx: 6.5, cy: 12 },
    { id: 5, cx: 12, cy: 12 },
    { id: 6, cx: 17.5, cy: 12 },
    { id: 7, cx: 6.5, cy: 17.5 },
    { id: 8, cx: 12, cy: 17.5 },
    { id: 9, cx: 17.5, cy: 17.5 }
  ];

  return (
    <svg viewBox="0 0 24 24" className="dice-face" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="none" stroke={color} strokeWidth="1.5" />
      {pipPositions.map((pip) =>
        activePips.includes(pip.id) ? <circle key={pip.id} cx={pip.cx} cy={pip.cy} r="1.6" fill={color} /> : null
      )}
    </svg>
  );
}

export function SiteHeader({
  page,
  filters,
  onNavigate
}: {
  page: PublicSitePage;
  filters: Filters;
  onNavigate?: (page: PublicSitePage) => void;
}) {
  function navProps(targetPage: PublicSitePage) {
    const href = pageHref(targetPage, filters);
    if (onNavigate) {
      return {
        href,
        onClick(e: { preventDefault(): void }) {
          e.preventDefault();
          onNavigate(targetPage);
        }
      };
    }
    return { href };
  }

  return (
    <header className="site-header">
      <div className="brand-cluster">
        <div className="brand-wordmark">
          <span className="brand-word brand-word-meeples">Meeples</span>
          <span className="brand-slash">&amp;</span>
          <span className="brand-word brand-word-models">Models</span>
        </div>
        <p className="brand-tagline">LLM benchmarks on strategic board games</p>
      </div>
      <nav className="site-nav">
        <a {...navProps("leaderboard")} className={page === "leaderboard" ? "active" : ""}>
          Leaderboard
        </a>
        <a {...navProps("latency")} className={page === "latency" ? "active" : ""}>
          Latency
        </a>
        <a {...navProps("methodology")} className={page === "methodology" ? "active" : ""}>
          Methodology
        </a>
        <a {...navProps("rulebook")} className={page === "rulebook" ? "active" : ""}>
          Rulebook
        </a>
        <a {...navProps("play")} className={page === "play" ? "active" : ""}>
          Play
        </a>
      </nav>
    </header>
  );
}
