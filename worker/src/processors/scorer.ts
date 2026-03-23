/**
 * Scoring processor — aggregates benchmark results and computes
 * composite scores. Also uses LLM-as-judge for quality preservation.
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

const WEIGHTS = {
  tokenEfficiency: 0.3,
  taskCompletion: 0.3,
  qualityPreservation: 0.25,
  latencyImpact: 0.15,
};

export async function computeScores(
  results: readonly ExecutionResult[],
  openrouterApiKey: string
): Promise<SkillScores> {
  const withSkill = results.filter((r) => r.withSkill);
  const baseline = results.filter((r) => !r.withSkill);

  const tokenEfficiency = scoreTokenEfficiency(withSkill, baseline);
  const taskCompletion = scoreTaskCompletion(withSkill, baseline);
  const qualityPreservation = await scoreQualityPreservation(
    withSkill,
    baseline,
    openrouterApiKey
  );
  const latencyImpact = scoreLatencyImpact(withSkill, baseline);

  const overall = Math.round(
    (tokenEfficiency * WEIGHTS.tokenEfficiency +
      taskCompletion * WEIGHTS.taskCompletion +
      qualityPreservation * WEIGHTS.qualityPreservation +
      latencyImpact * WEIGHTS.latencyImpact) *
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

function scoreTokenEfficiency(
  withSkill: readonly ExecutionResult[],
  baseline: readonly ExecutionResult[]
): number {
  const totalTokens = (r: ExecutionResult) =>
    r.result.totalPromptTokens + r.result.totalCompletionTokens;
  const avgWith = mean(
    withSkill
      .filter((r) => totalTokens(r) > 0)
      .map((r) => totalTokens(r))
  );
  const avgBase = mean(
    baseline
      .filter((r) => totalTokens(r) > 0)
      .map((r) => totalTokens(r))
  );

  if (avgBase === 0) return 50;

  const reduction = ((avgBase - avgWith) / avgBase) * 100;
  if (reduction < 0) return Math.max(0, 50 + reduction);
  return Math.min(100, 50 + reduction * 0.556);
}

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

async function scoreQualityPreservation(
  withSkill: readonly ExecutionResult[],
  baseline: readonly ExecutionResult[],
  apiKey: string
): Promise<number> {
  const client = new OpenRouterClient({ apiKey });
  const scores: number[] = [];

  // Pair up results by scenario + model + agent loop
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
        ws.result.finalAssistantMessage
      );
      scores.push(score);
    } catch {
      // Skip failed quality judgments
    }
  }

  return scores.length > 0 ? mean(scores) : 70;
}

async function judgeQuality(
  client: OpenRouterClient,
  baselineOutput: string,
  skillOutput: string
): Promise<number> {
  const response = await client.chatCompletion({
    model: "z-ai/glm-4.7-flash:free",
    messages: [
      {
        role: "user",
        content: `You are evaluating whether an AI skill preserves response quality.

BASELINE RESPONSE (without skill):
${baselineOutput.slice(0, 2000)}

SKILL-ENHANCED RESPONSE (with skill):
${skillOutput.slice(0, 2000)}

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

function scoreLatencyImpact(
  withSkill: readonly ExecutionResult[],
  baseline: readonly ExecutionResult[]
): number {
  const avgWith = mean(
    withSkill
      .filter((r) => r.result.avgTurnLatencyMs > 0)
      .map((r) => r.result.avgTurnLatencyMs)
  );
  const avgBase = mean(
    baseline
      .filter((r) => r.result.avgTurnLatencyMs > 0)
      .map((r) => r.result.avgTurnLatencyMs)
  );

  if (avgBase === 0) return 50;

  const improvement = ((avgBase - avgWith) / avgBase) * 100;
  return Math.min(100, Math.max(0, 50 + improvement * 0.5));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
