import { generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import type { GameState, Move } from "@board-ai-lab/onitama-engine";
import { buildOnitamaPrompt, ONITAMA_LLM_SKILL_TEXT, renderBoardTable, renderCardGuide, renderLegalMoveList } from "./skill.js";
export * from "./hive.js";
export * from "./hive-skill.js";

export const llmMoveCommandSchema = z.object({
  command: z.literal("play"),
  moveId: z.string().regex(/^m\d+$/)
});

export interface LLMMoveDecision {
  move: Move;
  moveId: string;
  rawText: string;
  systemPrompt: string;
  userPrompt: string;
  finishReason: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
  responseId?: string;
  responseModelId?: string;
  warnings?: unknown;
}

export interface OpenRouterAgentConfig {
  modelId: string;
  apiKey?: string;
  appName?: string;
  siteUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
  jsonRetryCount?: number;
  requestTimeoutMs?: number;
  reasoning?: {
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    maxTokens?: number;
    exclude?: boolean;
    enabled?: boolean;
  };
}

export interface LlmDecisionAgent {
  selectMove(state: GameState, legalMoves: Move[]): Promise<LLMMoveDecision>;
}

export class LlmMoveSelectionError extends Error {
  public readonly rawText?: string;
  public readonly systemPrompt: string;
  public readonly userPrompt: string;
  public readonly finishReason?: string;
  public readonly latencyMs: number;
  public readonly responseId?: string;
  public readonly responseModelId?: string;
  public readonly warnings?: unknown;

  public constructor(
    message: string,
    details: {
      rawText?: string;
      systemPrompt: string;
      userPrompt: string;
      finishReason?: string;
      latencyMs: number;
      responseId?: string;
      responseModelId?: string;
      warnings?: unknown;
    }
  ) {
    super(message);
    this.name = "LlmMoveSelectionError";
    this.rawText = details.rawText;
    this.systemPrompt = details.systemPrompt;
    this.userPrompt = details.userPrompt;
    this.finishReason = details.finishReason;
    this.latencyMs = details.latencyMs;
    this.responseId = details.responseId;
    this.responseModelId = details.responseModelId;
    this.warnings = details.warnings;
  }
}

export class OpenRouterOnitamaAgent implements LlmDecisionAgent {
  private readonly model;
  private readonly config: Required<Pick<OpenRouterAgentConfig, "modelId" | "temperature" | "maxOutputTokens" | "jsonRetryCount" | "requestTimeoutMs">> & OpenRouterAgentConfig;

  public constructor(config: OpenRouterAgentConfig) {
    const provider = createOpenRouter({
      apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY,
      headers: {
        ...(config.siteUrl ? { "HTTP-Referer": config.siteUrl } : {}),
        ...(config.appName ? { "X-Title": config.appName } : {})
      },
      compatibility: "strict"
    });

    this.config = {
      ...config,
      modelId: config.modelId,
      temperature: config.temperature ?? 0,
      maxOutputTokens: config.maxOutputTokens ?? 120,
      jsonRetryCount: config.jsonRetryCount ?? 1,
      requestTimeoutMs: config.requestTimeoutMs ?? 120_000
    };
    this.model = provider(this.config.modelId, {
      provider: { allow_fallbacks: true },
      plugins: [{ id: "response-healing" }]
    });
  }

  public async selectMove(state: GameState, legalMoves: Move[]): Promise<LLMMoveDecision> {
    const prompts = buildOnitamaPrompt(state, legalMoves);
    const providerOptions = this.config.reasoning
      ? {
          openrouter: {
            reasoning: {
              ...(this.config.reasoning.effort ? { effort: this.config.reasoning.effort } : {}),
              ...(typeof this.config.reasoning.maxTokens === "number" ? { max_tokens: this.config.reasoning.maxTokens } : {}),
              ...(typeof this.config.reasoning.exclude === "boolean" ? { exclude: this.config.reasoning.exclude } : {}),
              ...(typeof this.config.reasoning.enabled === "boolean" ? { enabled: this.config.reasoning.enabled } : {})
            }
          }
        }
      : undefined;

    const invalidAttempts: Array<{
      attempt: number;
      error: string;
      rawText: string;
      finishReason: string;
      responseId?: string;
      responseModelId?: string;
    }> = [];

    let currentUserPrompt = prompts.user;
    let totalLatencyMs = 0;

    for (let attempt = 0; attempt <= this.config.jsonRetryCount; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(`LLM request timed out after ${this.config.requestTimeoutMs}ms.`), this.config.requestTimeoutMs);
      try {
        const result = await generateObject({
          model: this.model,
          system: prompts.system,
          prompt: currentUserPrompt,
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxOutputTokens,
          abortSignal: controller.signal,
          timeout: { totalMs: this.config.requestTimeoutMs },
          schema: llmMoveCommandSchema,
          schemaName: "onitama_move",
          schemaDescription: "The exact legal move to play on this turn.",
          providerOptions
        });
        clearTimeout(timeoutHandle);
        totalLatencyMs += Date.now() - startedAt;

        const parsed = llmMoveCommandSchema.parse(result.object);
        const moveIndex = Number(parsed.moveId.slice(1)) - 1;
        const move = legalMoves[moveIndex];
        if (!move) {
          throw new Error(`Model returned unknown moveId ${parsed.moveId}.`);
        }

        return {
          move,
          moveId: parsed.moveId,
          rawText: JSON.stringify(result.object),
          systemPrompt: prompts.system,
          userPrompt: currentUserPrompt,
          finishReason: result.finishReason,
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens
          },
          latencyMs: totalLatencyMs,
          responseId: result.response.id,
          responseModelId: result.response.modelId,
          warnings: invalidAttempts.length > 0 || result.warnings
            ? {
                providerWarnings: result.warnings,
                invalidAttempts
              }
            : undefined
        };
      } catch (error) {
        clearTimeout(timeoutHandle);
        totalLatencyMs += Date.now() - startedAt;
        const message = error instanceof Error ? error.message : "Invalid JSON response.";
        invalidAttempts.push({
          attempt: attempt + 1,
          error: message,
          rawText: "",
          finishReason: "error"
        });

        if (attempt >= this.config.jsonRetryCount) {
          throw new LlmMoveSelectionError(message, {
            rawText: "",
            systemPrompt: prompts.system,
            userPrompt: currentUserPrompt,
            finishReason: "error",
            latencyMs: totalLatencyMs,
            warnings: {
              invalidAttempts
            }
          });
        }

        currentUserPrompt = `${prompts.user}

Your previous reply could not be accepted because: ${message}
Reply again. Return ONLY one JSON object in exactly this format:
{"command":"play","moveId":"mN"}

Do not include markdown. Do not include explanation.`;
      }
    }

    throw new Error("Model did not return a valid move.");
  }
}

export class RandomOnitamaSimulator implements LlmDecisionAgent {
  private state = 0;

  public constructor(
    private readonly modelId = "simulator/random",
    seed = 42,
    private readonly minLatencyMs = 900,
    private readonly maxLatencyMs = 1600
  ) {
    this.state = seed >>> 0;
  }

  private next(): number {
    this.state += 0x6d2b79f5;
    let value = Math.imul(this.state ^ (this.state >>> 15), this.state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  public async selectMove(state: GameState, legalMoves: Move[]): Promise<LLMMoveDecision> {
    const prompts = buildOnitamaPrompt(state, legalMoves);
    const moveIndex = Math.floor(this.next() * legalMoves.length);
    const move = legalMoves[Math.min(moveIndex, legalMoves.length - 1)] as Move;
    const latencyMs = Math.round(this.minLatencyMs + this.next() * (this.maxLatencyMs - this.minLatencyMs));
    await new Promise((resolve) => setTimeout(resolve, latencyMs));

    return {
      move,
      moveId: `m${moveIndex + 1}`,
      rawText: JSON.stringify({ command: "play", moveId: `m${moveIndex + 1}` }),
      systemPrompt: prompts.system,
      userPrompt: prompts.user,
      finishReason: "stop",
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined
      },
      latencyMs,
      responseId: undefined,
      responseModelId: this.modelId,
      warnings: undefined
    };
  }
}

export {
  buildOnitamaPrompt,
  ONITAMA_LLM_SKILL_TEXT,
  renderBoardTable,
  renderCardGuide,
  renderLegalMoveList
};
