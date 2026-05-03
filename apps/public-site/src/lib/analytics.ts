import { track } from "@vercel/analytics";
import type { BugType, HiveMove, Player as HivePlayer, Winner } from "@board-ai-lab/hive-engine";
import type { CardId, Move, Player } from "@board-ai-lab/onitama-engine";
import type { OnitamaDifficultyId } from "@board-ai-lab/onitama-play";
import type { PublicSitePage } from "../shared/site.js";

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue>;

function sendEvent(name: string, properties?: AnalyticsProperties): void {
  try {
    track(name, properties);
  } catch {
    // Analytics must never break local tests or gameplay.
  }
}

export function trackSiteNavigation(fromPage: PublicSitePage, toPage: PublicSitePage): void {
  sendEvent("site_navigation", {
    from_page: fromPage,
    to_page: toPage
  });
}

export function trackBenchmarkDataLoaded(siteName: string, gameCount: number, recordCount: number): void {
  sendEvent("benchmark_data_loaded", {
    site_name: siteName,
    game_count: gameCount,
    record_count: recordCount
  });
}

export function trackBenchmarkDataError(error: string): void {
  sendEvent("benchmark_data_error", {
    error: error.slice(0, 160)
  });
}

export type PlayGameId = "onitama" | "hive" | string;
export type PlayDifficultyId = OnitamaDifficultyId | "easy" | "standard" | "hard" | string;

export function trackPlayGameSelected(gameId: PlayGameId): void {
  sendEvent("play_game_selected", { game_id: gameId });
}

export function trackPlayMatchStarted(gameId: PlayGameId, difficultyId: PlayDifficultyId, side?: Player | HivePlayer): void {
  sendEvent("play_match_started", {
    game_id: gameId,
    difficulty_id: difficultyId,
    side
  });
}

export function trackPlayDifficultyChanged(gameId: PlayGameId, difficultyId: PlayDifficultyId): void {
  sendEvent("play_difficulty_changed", {
    game_id: gameId,
    difficulty_id: difficultyId
  });
}

export function trackPlaySideChanged(gameId: PlayGameId, side: Player | HivePlayer): void {
  sendEvent("play_side_changed", {
    game_id: gameId,
    side
  });
}

export function trackOnitamaMove(move: Move, turn: number, side: Player): void {
  sendEvent("play_move_made", {
    game_id: "onitama",
    turn,
    side,
    card: move.card,
    from_x: move.from.x,
    from_y: move.from.y,
    to_x: move.to.x,
    to_y: move.to.y
  });
}

export function trackOnitamaCardSelected(card: CardId, selected: boolean): void {
  sendEvent("play_card_selected", {
    game_id: "onitama",
    card,
    selected
  });
}

export function trackHiveReserveSelected(bug: BugType, selected: boolean): void {
  sendEvent("play_hive_reserve_selected", {
    game_id: "hive",
    bug,
    selected
  });
}

export function trackHiveMove(move: HiveMove, turn: number, side: HivePlayer): void {
  sendEvent("play_move_made", {
    game_id: "hive",
    turn,
    side,
    move_type: move.type,
    bug: move.type === "place" ? move.bug : undefined
  });
}

export function trackPlayMatchEnded(gameId: PlayGameId, winner: Winner | Player, humanWon: boolean, turn: number): void {
  sendEvent("play_match_ended", {
    game_id: gameId,
    winner,
    human_won: humanWon,
    turn
  });
}
