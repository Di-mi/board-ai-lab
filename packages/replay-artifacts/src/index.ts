import { z } from "zod";

export const positionSchema = z.object({
  x: z.number().int().min(0).max(4),
  y: z.number().int().min(0).max(4)
});

export const replayMoveSchema = z.object({
  card: z.enum([
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
  ]),
  from: positionSchema,
  to: positionSchema
});

export const replayTurnSchema = z.object({
  turn: z.number().int().nonnegative(),
  player: z.enum(["red", "blue"]),
  move: replayMoveSchema,
  stateHashBefore: z.string(),
  stateHashAfter: z.string(),
  pngDataUrl: z.string().optional()
});

export const replaySchema = z.object({
  runId: z.string(),
  startedAtIso: z.string(),
  seed: z.number().int().optional(),
  players: z.object({
    red: z.string(),
    blue: z.string()
  }),
  winner: z.enum(["red", "blue"]).optional(),
  winReason: z.enum(["captured-master", "temple-arch"]).optional(),
  turns: z.array(replayTurnSchema)
});

export type Replay = z.infer<typeof replaySchema>;
export type ReplayTurn = z.infer<typeof replayTurnSchema>;

export function validateReplay(payload: unknown): Replay {
  return replaySchema.parse(payload);
}
