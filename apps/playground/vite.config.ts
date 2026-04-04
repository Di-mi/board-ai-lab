import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { DatabaseSync } from "node:sqlite";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

interface HumanScoreEntry {
  id: string;
  recordedAtIso: string;
  humanPlayer: string;
  result: "win" | "loss" | "draw";
  moveCount: number;
  humanSide?: "red" | "blue";
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

const repoRoot = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config({ path: path.join(repoRoot, ".env") });
const scoreboardDir = path.join(repoRoot, "artifacts", "human-scoreboard");
const scoreboardPath = path.join(scoreboardDir, "scoreboard.json");
const publicScoreboardPath = path.join(repoRoot, "apps", "playground", "public", "human-scoreboard.json");
const llmMatchesDir = path.join(repoRoot, "artifacts", "llm-matches");
const llmMatchesDbPath = path.join(llmMatchesDir, "llm-matches.sqlite");

async function loadScoreboard(): Promise<HumanScoreboard> {
  try {
    const text = await readFile(scoreboardPath, "utf8");
    return JSON.parse(text) as HumanScoreboard;
  } catch {
    return {
      updatedAtIso: new Date(0).toISOString(),
      totals: {
        wins: 0,
        losses: 0,
        draws: 0,
        games: 0
      },
      entries: []
    };
  }
}

function computeTotals(entries: HumanScoreEntry[]): HumanScoreboard["totals"] {
  return entries.reduce(
    (totals, entry) => {
      totals.games += 1;
      if (entry.result === "win") totals.wins += 1;
      if (entry.result === "loss") totals.losses += 1;
      if (entry.result === "draw") totals.draws += 1;
      return totals;
    },
    { wins: 0, losses: 0, draws: 0, games: 0 }
  );
}

function withLlmDb<T>(reader: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(llmMatchesDbPath);
  try {
    return reader(db);
  } finally {
    db.close();
  }
}

function summarizeLlmResult(match: { winner?: "red" | "blue"; llmSide: "red" | "blue" }): "win" | "loss" | "draw" {
  if (!match.winner) return "draw";
  return match.winner === match.llmSide ? "win" : "loss";
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function rejectNonLocalRequest(
  req: { socket: { remoteAddress?: string } },
  res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }
): boolean {
  if (isLoopbackAddress(req.socket.remoteAddress)) {
    return false;
  }

  res.statusCode = 403;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: false, error: "Local dev API is available only from loopback clients." }));
  return true;
}

function localApiPlugin(): Plugin {
  return {
    name: "local-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/human-scoreboard", async (req, res, next) => {
        if (req.method !== "GET") {
          next();
          return;
        }
        if (rejectNonLocalRequest(req, res)) {
          return;
        }

        try {
          const scoreboard = await loadScoreboard();
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, scoreboard }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Failed to read scoreboard."
            })
          );
        }
      });

      server.middlewares.use("/api/human-scoreboard/record", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        if (rejectNonLocalRequest(req, res)) {
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });

        req.on("end", async () => {
          try {
            const payload = JSON.parse(body) as {
              humanPlayer?: string;
              result?: "win" | "loss" | "draw";
              moveCount?: number;
              humanSide?: "red" | "blue";
              trainedRunId?: string;
              notes?: string;
            };

            if (!payload.trainedRunId || typeof payload.moveCount !== "number" || !payload.result) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "Missing required scoreboard fields." }));
              return;
            }

            await mkdir(scoreboardDir, { recursive: true });
            const scoreboard = await loadScoreboard();
            const entry: HumanScoreEntry = {
              id: `human-${Date.now()}`,
              recordedAtIso: new Date().toISOString(),
              humanPlayer: payload.humanPlayer ?? "dimi",
              result: payload.result,
              moveCount: payload.moveCount,
              humanSide: payload.humanSide,
              trainedRunId: payload.trainedRunId,
              trainedGenomePath: path.join(repoRoot, "artifacts", "training", payload.trainedRunId, "best-genome.json"),
              notes: payload.notes ?? "Recorded automatically from playground."
            };

            const entries = [...scoreboard.entries, entry];
            const nextScoreboard: HumanScoreboard = {
              updatedAtIso: new Date().toISOString(),
              totals: computeTotals(entries),
              entries
            };

            await writeFile(scoreboardPath, `${JSON.stringify(nextScoreboard, null, 2)}\n`, "utf8");
            await writeFile(publicScoreboardPath, `${JSON.stringify(nextScoreboard, null, 2)}\n`, "utf8");

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, entry, totals: nextScoreboard.totals, scoreboard: nextScoreboard }));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : "Failed to record scoreboard entry."
              })
            );
          }
        });
      });

      server.middlewares.use("/api/review/llm/sessions", async (req, res, next) => {
        if (req.method !== "GET") {
          next();
          return;
        }
        if (rejectNonLocalRequest(req, res)) {
          return;
        }

        try {
          const sessions = withLlmDb((db) => {
            const rows = db
              .prepare(
                `SELECT session_id, started_at_iso, updated_at_iso, status, provider, model_id, raw_json
                 FROM llm_sessions
                 ORDER BY updated_at_iso DESC
                 LIMIT 24`
              )
              .all() as Array<{
                session_id: string;
                started_at_iso: string;
                updated_at_iso: string;
                status: string;
                provider: string;
                model_id: string;
                raw_json: string;
              }>;

            return rows.map((row) => {
              const raw = JSON.parse(row.raw_json) as {
                config?: Record<string, unknown>;
                matches?: Array<{ matchId: string; winner?: "red" | "blue"; llmSide: "red" | "blue"; status: string }>;
                llmLatencyMsTotal?: number;
                llmMoveCount?: number;
              };
              const matches = raw.matches ?? [];
              const totals = matches.reduce(
                (acc, match) => {
                  const result = summarizeLlmResult(match);
                  acc.matchCount += 1;
                  if (result === "win") acc.llmWins += 1;
                  if (result === "loss") acc.llmLosses += 1;
                  if (result === "draw") acc.draws += 1;
                  return acc;
                },
                { matchCount: 0, llmWins: 0, llmLosses: 0, draws: 0 }
              );

              return {
                sessionId: row.session_id,
                startedAtIso: row.started_at_iso,
                updatedAtIso: row.updated_at_iso,
                status: row.status,
                provider: row.provider,
                modelId: row.model_id,
                llmLatencyMsTotal: raw.llmLatencyMsTotal ?? 0,
                llmMoveCount: raw.llmMoveCount ?? 0,
                config: raw.config ?? {},
                ...totals
              };
            });
          });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, sessions }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Failed to load LLM review sessions."
            })
          );
        }
      });

      server.middlewares.use("/api/review/llm/session", async (req, res, next) => {
        if (req.method !== "GET") {
          next();
          return;
        }
        if (rejectNonLocalRequest(req, res)) {
          return;
        }

        try {
          const url = new URL(req.url ?? "", "http://localhost");
          const sessionId = url.searchParams.get("sessionId");
          if (!sessionId) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Missing sessionId." }));
            return;
          }

          const payload = withLlmDb((db) => {
            const row = db
              .prepare("SELECT raw_json FROM llm_sessions WHERE session_id = ?")
              .get(sessionId) as { raw_json: string } | undefined;
            if (!row) {
              return undefined;
            }
            return JSON.parse(row.raw_json);
          });

          if (!payload) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Session not found." }));
            return;
          }

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : "Failed to load LLM review session."
            })
          );
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()]
});
