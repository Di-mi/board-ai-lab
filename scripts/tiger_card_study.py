from __future__ import annotations

import argparse
import csv
import json
import math
import random
import time
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Literal, Optional, Sequence, Tuple

Player = Literal["red", "blue"]
PieceType = Literal["master", "student"]
CardId = Literal[
    "tiger",
    "dragon",
    "frog",
    "rabbit",
    "crab",
    "elephant",
    "goose",
    "rooster",
    "monkey",
    "mantis",
    "horse",
    "ox",
    "crane",
    "boar",
    "eel",
    "cobra",
]

BOARD_SIZE = 5
BOARD_CELLS = BOARD_SIZE * BOARD_SIZE
MAX_TURNS = 120
RED_TEMPLE = (2, 4)
BLUE_TEMPLE = (2, 0)
BASE_GAME_CARD_IDS: Tuple[CardId, ...] = (
    "tiger",
    "dragon",
    "frog",
    "rabbit",
    "crab",
    "elephant",
    "goose",
    "rooster",
    "monkey",
    "mantis",
    "horse",
    "ox",
    "crane",
    "boar",
    "eel",
    "cobra",
)

CARD_DEFINITIONS: Dict[CardId, Dict[str, object]] = {
    "tiger": {"stamp": "blue", "deltas": ((0, -2), (0, 1))},
    "dragon": {"stamp": "red", "deltas": ((-2, -1), (2, -1), (-1, 1), (1, 1))},
    "frog": {"stamp": "red", "deltas": ((-2, 0), (-1, -1), (1, 1))},
    "rabbit": {"stamp": "blue", "deltas": ((2, 0), (1, -1), (-1, 1))},
    "crab": {"stamp": "blue", "deltas": ((0, -1), (-2, 0), (2, 0))},
    "elephant": {"stamp": "red", "deltas": ((-1, 0), (1, 0), (-1, -1), (1, -1))},
    "goose": {"stamp": "blue", "deltas": ((-1, 0), (-1, -1), (1, 0), (1, 1))},
    "rooster": {"stamp": "red", "deltas": ((1, 0), (1, -1), (-1, 0), (-1, 1))},
    "monkey": {"stamp": "blue", "deltas": ((-1, -1), (1, -1), (-1, 1), (1, 1))},
    "mantis": {"stamp": "red", "deltas": ((-1, -1), (1, -1), (0, 1))},
    "horse": {"stamp": "blue", "deltas": ((-1, 0), (0, -1), (0, 1))},
    "ox": {"stamp": "red", "deltas": ((1, 0), (0, -1), (0, 1))},
    "crane": {"stamp": "blue", "deltas": ((0, -1), (-1, 1), (1, 1))},
    "boar": {"stamp": "red", "deltas": ((-1, 0), (0, -1), (1, 0))},
    "eel": {"stamp": "blue", "deltas": ((-1, -1), (1, 0), (-1, 1))},
    "cobra": {"stamp": "red", "deltas": ((1, -1), (-1, 0), (1, 1))},
}


@dataclass(frozen=True)
class Piece:
    player: Player
    type: PieceType


@dataclass(frozen=True)
class Move:
    card: CardId
    from_x: int
    from_y: int
    to_x: int
    to_y: int


@dataclass
class CardSet:
    red: Tuple[CardId, CardId]
    blue: Tuple[CardId, CardId]
    side: CardId


@dataclass
class GameState:
    board: List[Optional[Piece]]
    current_player: Player
    cards: CardSet
    turn: int
    winner: Optional[Player] = None
    win_reason: Optional[str] = None


class OnitamaEngine:
    def initial_state(self, cards: CardSet) -> GameState:
        starting_player = CARD_DEFINITIONS[cards.side]["stamp"]  # type: ignore[index]
        return GameState(
            board=self._initial_board(),
            current_player=starting_player,  # type: ignore[arg-type]
            cards=cards,
            turn=0,
        )

    def legal_moves(self, state: GameState) -> List[Move]:
        if state.winner is not None:
            return []

        moves: List[Move] = []
        cards = state.cards.red if state.current_player == "red" else state.cards.blue

        for index, piece in enumerate(state.board):
            if piece is None or piece.player != state.current_player:
                continue
            from_x = index % BOARD_SIZE
            from_y = index // BOARD_SIZE
            for card in cards:
                for dx, dy in oriented_deltas(card, state.current_player):
                    to_x = from_x + dx
                    to_y = from_y + dy
                    if not in_bounds(to_x, to_y):
                        continue
                    occupying = state.board[to_y * BOARD_SIZE + to_x]
                    if occupying is not None and occupying.player == state.current_player:
                        continue
                    moves.append(Move(card=card, from_x=from_x, from_y=from_y, to_x=to_x, to_y=to_y))
        return moves

    def apply_move(self, state: GameState, move: Move) -> GameState:
        legal = self.legal_moves(state)
        if move not in legal:
            raise ValueError(f"Illegal move: {move}")

        board = list(state.board)
        from_index = move.from_y * BOARD_SIZE + move.from_x
        to_index = move.to_y * BOARD_SIZE + move.to_x
        moving_piece = board[from_index]
        if moving_piece is None:
            raise ValueError("Source square is empty.")
        target_piece = board[to_index]
        board[from_index] = None
        board[to_index] = moving_piece

        winner: Optional[Player] = None
        win_reason: Optional[str] = None
        if target_piece is not None and target_piece.type == "master":
            winner = moving_piece.player
            win_reason = "captured-master"
        else:
            temple = BLUE_TEMPLE if moving_piece.player == "red" else RED_TEMPLE
            if moving_piece.type == "master" and (move.to_x, move.to_y) == temple:
                winner = moving_piece.player
                win_reason = "temple-arch"

        red_cards = list(state.cards.red)
        blue_cards = list(state.cards.blue)
        current_cards = red_cards if state.current_player == "red" else blue_cards
        used_index = current_cards.index(move.card)
        current_cards[used_index] = state.cards.side

        return GameState(
            board=board,
            current_player=opponent(state.current_player),
            cards=CardSet(red=(red_cards[0], red_cards[1]), blue=(blue_cards[0], blue_cards[1]), side=move.card),
            turn=state.turn + 1,
            winner=winner,
            win_reason=win_reason,
        )

    @staticmethod
    def _initial_board() -> List[Optional[Piece]]:
        board: List[Optional[Piece]] = [None] * BOARD_CELLS
        blue_rank = [
            Piece("blue", "student"),
            Piece("blue", "student"),
            Piece("blue", "master"),
            Piece("blue", "student"),
            Piece("blue", "student"),
        ]
        red_rank = [
            Piece("red", "student"),
            Piece("red", "student"),
            Piece("red", "master"),
            Piece("red", "student"),
            Piece("red", "student"),
        ]
        for x in range(BOARD_SIZE):
            board[x] = blue_rank[x]
            board[(BOARD_SIZE - 1) * BOARD_SIZE + x] = red_rank[x]
        return board


class HeuristicAgent:
    def __init__(self, weights: Dict[str, float], depth: int = 2) -> None:
        self.weights = weights
        self.depth = depth
        self.engine = OnitamaEngine()

    def select_move(self, state: GameState, legal_moves: List[Move]) -> Move:
        best_move = legal_moves[0]
        best_score = -math.inf
        perspective = state.current_player
        for move in legal_moves:
            next_state = self.engine.apply_move(state, move)
            score = self._minimax(next_state, perspective, self.depth - 1)
            if score > best_score:
                best_score = score
                best_move = move
        return best_move

    def _minimax(self, state: GameState, perspective: Player, depth: int) -> float:
        if depth <= 0 or state.winner is not None:
            return heuristic_score(state, perspective, self.weights, self.engine)

        legal = self.engine.legal_moves(state)
        if not legal:
            losing_state = deepcopy(state)
            losing_state.winner = opponent(state.current_player)
            losing_state.win_reason = "captured-master"
            return heuristic_score(losing_state, perspective, self.weights, self.engine)

        maximize = state.current_player == perspective
        best = -math.inf if maximize else math.inf
        for move in legal:
            next_state = self.engine.apply_move(state, move)
            score = self._minimax(next_state, perspective, depth - 1)
            if maximize:
                best = max(best, score)
            else:
                best = min(best, score)
        return best


def opponent(player: Player) -> Player:
    return "blue" if player == "red" else "red"


def in_bounds(x: int, y: int) -> bool:
    return 0 <= x < BOARD_SIZE and 0 <= y < BOARD_SIZE


def oriented_deltas(card: CardId, player: Player) -> Sequence[Tuple[int, int]]:
    deltas = CARD_DEFINITIONS[card]["deltas"]  # type: ignore[index]
    if player == "red":
        return deltas  # type: ignore[return-value]
    return [(-dx, -dy) for dx, dy in deltas]  # type: ignore[arg-type]


def pieces_of(state: GameState, player: Player) -> List[Piece]:
    return [piece for piece in state.board if piece is not None and piece.player == player]


def students_of(state: GameState, player: Player) -> int:
    return sum(1 for piece in pieces_of(state, player) if piece.type == "student")


def master_position(state: GameState, player: Player) -> Optional[Tuple[int, int]]:
    for idx, piece in enumerate(state.board):
        if piece is not None and piece.player == player and piece.type == "master":
            return idx % BOARD_SIZE, idx // BOARD_SIZE
    return None


def legal_moves_for(state: GameState, player: Player, engine: OnitamaEngine) -> List[Move]:
    switched = deepcopy(state)
    switched.current_player = player
    return engine.legal_moves(switched)


def capturing_moves(state: GameState, player: Player, engine: OnitamaEngine) -> int:
    opp = opponent(player)
    count = 0
    for move in legal_moves_for(state, player, engine):
        target = state.board[move.to_y * BOARD_SIZE + move.to_x]
        if target is not None and target.player == opp:
            count += 1
    return count


def center_control(state: GameState, player: Player) -> int:
    own = 0
    opp = 0
    opp_player = opponent(player)
    for y in range(1, 4):
        for x in range(1, 4):
            piece = state.board[y * BOARD_SIZE + x]
            if piece is not None and piece.player == player:
                own += 1
            elif piece is not None and piece.player == opp_player:
                opp += 1
    return own - opp


def temple_distance(state: GameState, player: Player) -> int:
    pos = master_position(state, player)
    if pos is None:
        return 10
    temple = BLUE_TEMPLE if player == "red" else RED_TEMPLE
    return abs(pos[0] - temple[0]) + abs(pos[1] - temple[1])


def master_threat_count(state: GameState, player: Player, engine: OnitamaEngine) -> int:
    pos = master_position(state, player)
    if pos is None:
        return 10
    opp = opponent(player)
    return sum(1 for move in legal_moves_for(state, opp, engine) if (move.to_x, move.to_y) == pos)


def card_tempo(state: GameState, player: Player, engine: OnitamaEngine) -> int:
    return len(legal_moves_for(state, player, engine)) - len(legal_moves_for(state, opponent(player), engine))


def heuristic_score(state: GameState, perspective: Player, weights: Dict[str, float], engine: OnitamaEngine) -> float:
    opp = opponent(perspective)
    if state.winner is not None:
        return 1000.0 if state.winner == perspective else -1000.0

    f_material = students_of(state, perspective) - students_of(state, opp)
    f_master_safety = -master_threat_count(state, perspective, engine) + master_threat_count(state, opp, engine)
    f_mobility = len(legal_moves_for(state, perspective, engine)) - len(legal_moves_for(state, opp, engine))
    f_temple_pressure = temple_distance(state, opp) - temple_distance(state, perspective)
    f_capture_threat = capturing_moves(state, perspective, engine) - capturing_moves(state, opp, engine)
    f_center_control = center_control(state, perspective)
    f_card_tempo = card_tempo(state, perspective, engine)

    return (
        weights["material"] * f_material
        + weights["masterSafety"] * f_master_safety
        + weights["mobility"] * f_mobility
        + weights["templePressure"] * f_temple_pressure
        + weights["captureThreat"] * f_capture_threat
        + weights["centerControl"] * f_center_control
        + weights["cardTempo"] * f_card_tempo
    )


def make_tiger_card_set(rng: random.Random) -> Tuple[CardSet, Player]:
    holder: Player = rng.choice(["red", "blue"])
    other_cards = rng.sample([card for card in BASE_GAME_CARD_IDS if card != "tiger"], 4)
    if holder == "red":
        cards = CardSet(red=("tiger", other_cards[0]), blue=(other_cards[1], other_cards[2]), side=other_cards[3])
    else:
        cards = CardSet(red=(other_cards[1], other_cards[2]), blue=("tiger", other_cards[0]), side=other_cards[3])
    return cards, holder


def run_single_game(engine: OnitamaEngine, agent_red: HeuristicAgent, agent_blue: HeuristicAgent, cards: CardSet) -> Tuple[Optional[Player], Optional[str], int, Player]:
    state = engine.initial_state(cards)
    starting_player = state.current_player
    for _ in range(MAX_TURNS):
        if state.winner is not None:
            return state.winner, state.win_reason, state.turn, starting_player
        legal = engine.legal_moves(state)
        if not legal:
            return opponent(state.current_player), "no-legal-moves", state.turn, starting_player
        actor = agent_red if state.current_player == "red" else agent_blue
        move = actor.select_move(state, legal)
        state = engine.apply_move(state, move)
    return state.winner, state.win_reason or "max-turns", state.turn, starting_player


def wilson_interval(successes: int, trials: int, z: float = 1.96) -> Tuple[float, float]:
    if trials == 0:
        return 0.0, 0.0
    phat = successes / trials
    denom = 1 + z * z / trials
    center = (phat + z * z / (2 * trials)) / denom
    margin = (z / denom) * math.sqrt((phat * (1 - phat) + z * z / (4 * trials)) / trials)
    return center - margin, center + margin


def main() -> None:
    parser = argparse.ArgumentParser(description="Tiger card side-quest experiment for Onitama.")
    parser.add_argument("--games", type=int, default=200, help="Number of self-play games to simulate.")
    parser.add_argument("--depth", type=int, default=2, help="Search depth for both bots.")
    parser.add_argument(
        "--genome",
        type=Path,
        default=Path("/Users/dimi/Documents/board-ai-lab/artifacts/training/train-1772878297644/best-genome.json"),
        help="Path to the best-genome.json file for the default champion.",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed for the experiment.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("/Users/dimi/Documents/board-ai-lab/artifacts/sidequests/tiger-card-study"),
        help="Directory where timestamped run outputs will be written.",
    )
    args = parser.parse_args()

    genome = json.loads(args.genome.read_text())
    weights = genome["weights"]
    engine = OnitamaEngine()
    red_agent = HeuristicAgent(weights, depth=args.depth)
    blue_agent = HeuristicAgent(weights, depth=args.depth)
    rng = random.Random(args.seed)

    timestamp = int(time.time() * 1000)
    run_dir = args.output_dir / f"run-{timestamp}"
    run_dir.mkdir(parents=True, exist_ok=True)

    results = []
    tiger_holder_wins = 0
    draws = 0
    by_holder: Dict[Player, Dict[str, int]] = {
        "red": {"wins": 0, "losses": 0, "draws": 0},
        "blue": {"wins": 0, "losses": 0, "draws": 0},
    }
    by_starting_relation = {
        "holder_started": {"wins": 0, "losses": 0, "draws": 0},
        "holder_did_not_start": {"wins": 0, "losses": 0, "draws": 0},
    }
    relation_bucket_key = {"win": "wins", "loss": "losses", "draw": "draws"}

    for game_index in range(args.games):
        cards, tiger_holder = make_tiger_card_set(rng)
        winner, win_reason, turns, starting_player = run_single_game(engine, red_agent, blue_agent, cards)
        holder_result: str
        if winner is None:
            holder_result = "draw"
            draws += 1
            by_holder[tiger_holder]["draws"] += 1
        elif winner == tiger_holder:
            holder_result = "win"
            tiger_holder_wins += 1
            by_holder[tiger_holder]["wins"] += 1
        else:
            holder_result = "loss"
            by_holder[tiger_holder]["losses"] += 1

        relation_key = "holder_started" if starting_player == tiger_holder else "holder_did_not_start"
        by_starting_relation[relation_key][relation_bucket_key[holder_result]] += 1

        results.append(
            {
                "gameIndex": game_index,
                "tigerHolder": tiger_holder,
                "startingPlayer": starting_player,
                "winner": winner,
                "holderResult": holder_result,
                "winReason": win_reason,
                "turns": turns,
                "cards": {"red": list(cards.red), "blue": list(cards.blue), "side": cards.side},
            }
        )

    non_draw_games = args.games - draws
    tiger_win_rate_all = tiger_holder_wins / args.games if args.games else 0.0
    tiger_win_rate_non_draw = tiger_holder_wins / non_draw_games if non_draw_games else 0.0
    wilson_low, wilson_high = wilson_interval(tiger_holder_wins, non_draw_games) if non_draw_games else (0.0, 0.0)

    summary = {
        "question": "Is Tiger overpowered when one identical best bot starts with Tiger in hand?",
        "championGenome": str(args.genome),
        "games": args.games,
        "depth": args.depth,
        "seed": args.seed,
        "tigerHolderWins": tiger_holder_wins,
        "tigerHolderLosses": args.games - tiger_holder_wins - draws,
        "draws": draws,
        "tigerWinRateAllGames": tiger_win_rate_all,
        "tigerWinRateExcludingDraws": tiger_win_rate_non_draw,
        "wilson95ExcludingDraws": [wilson_low, wilson_high],
        "byHolderColor": by_holder,
        "byStartingRelation": by_starting_relation,
    }

    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (run_dir / "games.json").write_text(json.dumps(results, indent=2) + "\n")

    with (run_dir / "games.csv").open("w", newline="") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow([
            "gameIndex",
            "tigerHolder",
            "startingPlayer",
            "winner",
            "holderResult",
            "winReason",
            "turns",
            "redCards",
            "blueCards",
            "sideCard",
        ])
        for row in results:
            writer.writerow([
                row["gameIndex"],
                row["tigerHolder"],
                row["startingPlayer"],
                row["winner"],
                row["holderResult"],
                row["winReason"],
                row["turns"],
                ",".join(row["cards"]["red"]),
                ",".join(row["cards"]["blue"]),
                row["cards"]["side"],
            ])

    (run_dir / "README.txt").write_text(
        "Tiger card study\n"
        f"Champion genome: {args.genome}\n"
        f"Games: {args.games}\n"
        f"Depth: {args.depth}\n"
        f"Seed: {args.seed}\n"
        f"Tiger holder win rate (all games): {tiger_win_rate_all:.4f}\n"
        f"Tiger holder win rate (excluding draws): {tiger_win_rate_non_draw:.4f}\n"
        f"Wilson 95% interval (excluding draws): [{wilson_low:.4f}, {wilson_high:.4f}]\n"
    )

    latest_file = args.output_dir / "latest-run.txt"
    latest_file.write_text(str(run_dir) + "\n")

    print(json.dumps({"runDir": str(run_dir), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
