import type { CardId, Player } from "./types.js";

export interface CardDefinition {
  id: CardId;
  name: string;
  deltas: Array<readonly [number, number]>;
  stamp: Player;
}

// Deltas are from red's point of view (red forward is y - 1).
export const CARD_DEFINITIONS: Record<CardId, CardDefinition> = {
  tiger: {
    id: "tiger",
    name: "Tiger",
    deltas: [[0, -2], [0, 1]],
    stamp: "blue"
  },
  dragon: {
    id: "dragon",
    name: "Dragon",
    deltas: [[-2, -1], [2, -1], [-1, 1], [1, 1]],
    stamp: "red"
  },
  frog: {
    id: "frog",
    name: "Frog",
    deltas: [[-2, 0], [-1, -1], [1, 1]],
    stamp: "red"
  },
  rabbit: {
    id: "rabbit",
    name: "Rabbit",
    deltas: [[2, 0], [1, -1], [-1, 1]],
    stamp: "blue"
  },
  crab: {
    id: "crab",
    name: "Crab",
    deltas: [[0, -1], [-2, 0], [2, 0]],
    stamp: "blue"
  },
  elephant: {
    id: "elephant",
    name: "Elephant",
    deltas: [[-1, 0], [1, 0], [-1, -1], [1, -1]],
    stamp: "red"
  },
  goose: {
    id: "goose",
    name: "Goose",
    deltas: [[-1, 0], [-1, -1], [1, 0], [1, 1]],
    stamp: "blue"
  },
  rooster: {
    id: "rooster",
    name: "Rooster",
    deltas: [[1, 0], [1, -1], [-1, 0], [-1, 1]],
    stamp: "red"
  },
  monkey: {
    id: "monkey",
    name: "Monkey",
    deltas: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    stamp: "blue"
  },
  mantis: {
    id: "mantis",
    name: "Mantis",
    deltas: [[-1, -1], [1, -1], [0, 1]],
    stamp: "red"
  },
  horse: {
    id: "horse",
    name: "Horse",
    deltas: [[-1, 0], [0, -1], [0, 1]],
    stamp: "blue"
  },
  ox: {
    id: "ox",
    name: "Ox",
    deltas: [[1, 0], [0, -1], [0, 1]],
    stamp: "red"
  },
  crane: {
    id: "crane",
    name: "Crane",
    deltas: [[0, -1], [-1, 1], [1, 1]],
    stamp: "blue"
  },
  boar: {
    id: "boar",
    name: "Boar",
    deltas: [[-1, 0], [0, -1], [1, 0]],
    stamp: "red"
  },
  eel: {
    id: "eel",
    name: "Eel",
    deltas: [[-1, -1], [1, 0], [-1, 1]],
    stamp: "blue"
  },
  cobra: {
    id: "cobra",
    name: "Cobra",
    deltas: [[1, -1], [-1, 0], [1, 1]],
    stamp: "red"
  }
};

export const FIXED_CARD_SET: [CardId, CardId, CardId, CardId, CardId] = [
  "tiger",
  "dragon",
  "frog",
  "rabbit",
  "crab"
];

export const BASE_GAME_CARD_IDS: CardId[] = [
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
  "cobra"
];

export function orientedDeltas(card: CardId, player: Player): Array<readonly [number, number]> {
  const base = CARD_DEFINITIONS[card].deltas;
  if (player === "red") {
    return base;
  }
  return base.map(([dx, dy]) => [-dx, -dy] as const);
}
