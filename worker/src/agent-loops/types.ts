/**
 * Common interface for all agent loop implementations.
 * Each loop type (Hermes, Claude API, Claude CLI) implements this interface
 * but uses different message formatting and tool calling conventions.
 */

export interface AgentLoopConfig {
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly tools: readonly ToolDef[];
  readonly maxTurns: number;
  readonly skillContent: string | null;
  readonly withSkill: boolean;
  readonly openrouterApiKey: string;
  readonly timeoutMs: number;
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface TurnMetric {
  readonly turnNumber: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly contextChars: number;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly toolName: string | null;
  readonly toolResultRawSize: number;
  readonly toolResultFilteredSize: number;
}

export interface AgentLoopResult {
  readonly taskCompleted: boolean;
  readonly totalTurns: number;
  readonly totalToolCalls: number;
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalCostUsd: number;
  readonly initialContextTokens: number;
  readonly finalContextTokens: number;
  readonly peakContextTokens: number;
  readonly avgTurnLatencyMs: number;
  readonly p95TurnLatencyMs: number;
  readonly turnMetrics: readonly TurnMetric[];
  readonly finalAssistantMessage: string;
  readonly error: string | null;
}

export interface AgentLoop {
  run(config: AgentLoopConfig): Promise<AgentLoopResult>;
}

/** Simulated tool handler — returns realistic output for benchmark scenarios */
export type ToolHandler = (
  name: string,
  args: Record<string, unknown>
) => Promise<string>;
