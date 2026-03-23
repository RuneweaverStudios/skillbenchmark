/**
 * Scoring processor — category-aware benchmark scoring.
 *
 * Skills are auto-categorized into types that determine which metrics
 * matter and how they're weighted:
 *
 * - context_optimization: Skills that reduce context window overhead
 *   (dietmcp, skinnytools). Token efficiency measures CONTEXT overhead
 *   not total tokens. Latency weighted low — indirection is expected.
 *
 * - code_generation: Skills that generate/modify code.
 *   Quality and task completion matter most.
 *
 * - general: Default. Balanced weights.
 */

import { OpenRouterClient } from "../lib/openrouter.js";
import type { ExecutionResult } from "./benchmark-runner.js";

export interface SkillScores {
  readonly tokenEfficiency: number;
  readonly taskCompletion: number;
  readonly qualityPreservation: number;
  readonly latencyImpact: number;
  readonly overall: number;
}

// ─── Category detection ─────────────────────────────────────────────────

type SkillCategory = "context_optimization" | "code_generation" | "general";

const WEIGHT_PROFILES: Record<SkillCategory, {
  tokenEfficiency: number;
  taskCompletion: number;
  qualityPreservation: number;
  latencyImpact: number;
}> = {
  context_optimization: {
    tokenEfficiency: 0.35,
    taskCompletion: 0.35,
    qualityPreservation: 0.25,
    latencyImpact: 0.05, // indirection latency is expected, not a penalty
  },
  code_generation: {
    tokenEfficiency: 0.15,
    taskCompletion: 0.35,
    qualityPreservation: 0.35,
    latencyImpact: 0.15,
  },
  general: {
    tokenEfficiency: 0.3,
    taskCompletion: 0.3,
    qualityPreservation: 0.25,
    latencyImpact: 0.15,
  },
};

function detectCategory(results: readonly ExecutionResult[]): SkillCategory {
  // Heuristic: look at the tools used in with-skill runs
  const skillRuns = results.filter((r) => r.withSkill);
  const allToolNames = new Set<string>();

  for (const run of skillRuns) {
    for (const tm of run.result.turnMetrics) {
      const name = (tm as Record<string, unknown>).toolName ??
        ((tm as Record<string, unknown>).tool_calls as unknown[])
          ?.[0]
          ? "tool" : null;
      if (typeof name === "string") allToolNames.add(name.toLowerCase());
    }
  }

  // Context optimization: heavy bash usage (CLI routing), MCP-like tools
  // Count bash tool calls by inspecting turn metrics
  let bashCalls = 0;
  for (const run of skillRuns) {
    for (const tm of run.result.turnMetrics) {
      // turnMetrics may have toolName (in-process) or tool_calls array (container)
      const raw = tm as unknown as Record<string, unknown>;
      if (raw.toolName === "bash") {
        bashCalls++;
      } else if (Array.isArray(raw.tool_calls)) {
        for (const call of raw.tool_calls as { tool_name?: string }[]) {
          if (call.tool_name === "bash") bashCalls++;
        }
      }
    }
  }

  const totalCalls = skillRuns.reduce((s, r) => s + r.result.totalToolCalls, 0);

  // If >40% of tool calls are bash, likely a CLI-routing/context-optimization skill
  if (totalCalls > 0 && bashCalls / totalCalls > 0.4) {
    return "context_optimization";
  }

  return "general";
}

// ─── Main scorer ────────────────────────────────────────────────────────

export async function computeScores(
  results: readonly ExecutionResult[],
  openrouterApiKey: string
): Promise<SkillScores> {
  const withSkill = results.filter((r) => r.withSkill);
  const baseline = results.filter((r) => !r.withSkill);

  const category = detectCategory(results);
  const weights = WEIGHT_PROFILES[category];
  console.log(`[scorer] Detected skill category: ${category}`);
  console.log(`[scorer] Weights: token=${weights.tokenEfficiency} task=${weights.taskCompletion} quality=${weights.qualityPreservation} latency=${weights.latencyImpact}`);

  const tokenEfficiency = category === "context_optimization"
    ? scoreContextEfficiency(withSkill, baseline)
    : scoreTotalTokenEfficiency(withSkill, baseline);

  const taskCompletion = scoreTaskCompletion(withSkill, baseline);

  const qualityPreservation = await scoreQualityPreservation(
    withSkill,
    baseline,
    openrouterApiKey,
    category
  );

  const latencyImpact = scoreLatencyImpact(withSkill, baseline);

  const overall = Math.round(
    (tokenEfficiency * weights.tokenEfficiency +
      taskCompletion * weights.taskCompletion +
      qualityPreservation * weights.qualityPreservation +
      latencyImpact * weights.latencyImpact) *
      100
  ) / 100;

  return Object.freeze({
    tokenEfficiency,
    taskCompletion,
    qualityPreservation,
    latencyImpact,
    overall,
  });
}

// ─── Token Efficiency ───────────────────────────────────────────────────

/**
 * For context-optimization skills: measure CONTEXT OVERHEAD reduction.
 * Compares initial context tokens (system prompt + tool definitions)
 * and per-turn prompt token growth rate. This isolates the schema/tool
 * overhead that these skills actually reduce.
 */
function scoreContextEfficiency(
  withSkill: readonly ExecutionResult[],
  baseline: readonly ExecutionResult[]
): number {
  // Measure 1: Initial context overhead (tool schema bloat)
  const avgInitWith = mean(
    withSkill.filter((r) => r.result.initialContextTokens > 0)
      .map((r) => r.result.initialContextTokens)
  );
  const avgInitBase = mean(
    baseline.filter((r) => r.result.initialContextTokens > 0)
      .map((r) => r.result.initialContextTokens)
  );

  // Measure 2: Per-turn prompt token efficiency (tokens per turn)
  const avgPerTurnWith = mean(
    withSkill.filter((r) => r.result.totalTurns > 0)
      .map((r) => r.result.totalPromptTokens / r.result.totalTurns)
  );
  const avgPerTurnBase = mean(
    baseline.filter((r) => r.result.totalTurns > 0)
      .map((r) => r.result.totalPromptTokens / r.result.totalTurns)
  );

  // Measure 3: Total tokens (still counts, but less weight)
  const avgTotalWith = mean(
    withSkill.filter((r) => totalTokens(r) > 0).map(totalTokens)
  );
  const avgTotalBase = mean(
    baseline.filter((r) => totalTokens(r) > 0).map(totalTokens)
  );

  if (avgInitBase === 0 && avgPerTurnBase === 0) return 50;

  // Score each measure
  const initReduction = avgInitBase > 0 ? ((avgInitBase - avgInitWith) / avgInitBase) * 100 : 0;
  const perTurnReduction = avgPerTurnBase > 0 ? ((avgPerTurnBase - avgPerTurnWith) / avgPerTurnBase) * 100 : 0;
  const totalReduction = avgTotalBase > 0 ? ((avgTotalBase - avgTotalWith) / avgTotalBase) * 100 : 0;

  // Weighted combination: per-turn efficiency matters most for context optimization
  const combinedReduction = perTurnReduction * 0.5 + totalReduction * 0.3 + initReduction * 0.2;

  if (combinedReduction < 0) return Math.max(0, 50 + combinedReduction * 0.5);
  return Math.min(100, 50 + combinedReduction * 0.556);
}

/** For general skills: measure total token reduction (original behavior) */
function scoreTotalTokenEfficiency(
  withSkill: readonly ExecutionResult[],
  baseline: readonly ExecutionResult[]
): number {
  const avgWith = mean(
    withSkill.filter((r) => totalTokens(r) > 0).map(totalTokens)
  );
  const avgBase = mean(
    baseline.filter((r) => totalTokens(r) > 0).map(totalTokens)
  );

  if (avgBase === 0) return 50;

  const reduction = ((avgBase - avgWith) / avgBase) * 100;
  if (reduction < 0) return Math.max(0, 50 + reduction);
  return Math.min(100, 50 + reduction * 0.556);
}

function totalTokens(r: ExecutionResult): number {
  return r.result.totalPromptTokens + r.result.totalCompletionTokens;
}

// ─── Task Completion ────────────────────────────────────────────────────

function scoreTaskCompletion(
  withSkill: readonly ExecutionResult[],
  baseline: readonly ExecutionResult[]
): number {
  const withRate = mean(withSkill.map((r) => (r.result.taskCompleted ? 100 : 0)));
  const baseRate = mean(baseline.map((r) => (r.result.taskCompleted ? 100 : 0)));

  const delta = withRate - baseRate;
  if (delta >= 0) return Math.min(100, 70 + delta * 0.3);
  return Math.max(0, 70 + delta * 0.7);
}

// ─── Quality Preservation ───────────────────────────────────────────────

async function scoreQualityPreservation(
  withSkill: readonly ExecutionResult[],
  baseline: readonly ExecutionResult[],
  apiKey: string,
  category: SkillCategory
): Promise<number> {
  const client = new OpenRouterClient({ apiKey });
  const scores: number[] = [];

  for (const ws of withSkill) {
    const bl = baseline.find(
      (b) =>
        b.scenarioId === ws.scenarioId &&
        b.model === ws.model &&
        b.agentLoop === ws.agentLoop
    );
    if (!bl || !ws.result.finalAssistantMessage || !bl.result.finalAssistantMessage) {
      continue;
    }

    try {
      const score = await judgeQuality(
        client,
        bl.result.finalAssistantMessage,
        ws.result.finalAssistantMessage,
        category
      );
      scores.push(score);
    } catch {
      // Skip failed judgments
    }
  }

  return scores.length > 0 ? mean(scores) : 70;
}

async function judgeQuality(
  client: OpenRouterClient,
  baselineOutput: string,
  skillOutput: string,
  category: SkillCategory
): Promise<number> {
  // Category-aware judge prompt
  const categoryGuidance = category === "context_optimization"
    ? `IMPORTANT: This skill is a context-optimization tool that may intentionally
produce more concise output or truncate verbose data (piping full results to
files instead). Shorter output is NOT a quality loss if the key information
and conclusions are preserved. Judge based on whether the essential answer
and reasoning are present, not on output length or verbosity.`
    : "";

  const response = await client.chatCompletion({
    model: "z-ai/glm-4.7-flash",
    messages: [
      {
        role: "user",
        content: `You are evaluating whether an AI skill preserves response quality.

${categoryGuidance}

BASELINE RESPONSE (without skill):
${baselineOutput.slice(0, 3000)}

SKILL-ENHANCED RESPONSE (with skill):
${skillOutput.slice(0, 3000)}

Rate the skill-enhanced response's quality relative to baseline on a 0-100 scale:
- 100: Equal or better quality, all key information preserved
- 80-99: Minor quality loss, key information present
- 60-79: Noticeable quality loss, some information missing
- 40-59: Significant quality loss
- 0-39: Major quality degradation

Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief>"}`,
      },
    ],
    maxTokens: 200,
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return 70;

  try {
    const parsed = JSON.parse(content);
    return Math.max(0, Math.min(100, Number(parsed.score)));
  } catch {
    return 70;
  }
}

// ─── Latency Impact ─────────────────────────────────────────────────────

function scoreLatencyImpact(
  withSkill: readonly ExecutionResult[],
  baseline: readonly ExecutionResult[]
): number {
  const avgWith = mean(
    withSkill.filter((r) => r.result.avgTurnLatencyMs > 0)
      .map((r) => r.result.avgTurnLatencyMs)
  );
  const avgBase = mean(
    baseline.filter((r) => r.result.avgTurnLatencyMs > 0)
      .map((r) => r.result.avgTurnLatencyMs)
  );

  if (avgBase === 0) return 50;

  const improvement = ((avgBase - avgWith) / avgBase) * 100;
  return Math.min(100, Math.max(0, 50 + improvement * 0.5));
}

// ─── Helpers ────────────────────────────────────────────────────────────

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
