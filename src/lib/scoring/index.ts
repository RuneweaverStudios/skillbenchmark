import { SCORING_WEIGHTS } from "../constants";
import type { Execution } from "../types";

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Score token efficiency: how much does the skill reduce token usage?
 * 50 = no change, 100 = 90%+ reduction, 0 = skill doubles tokens
 */
export function scoreTokenEfficiency(executions: readonly Execution[]): number {
  const withSkill = executions.filter((e) => e.with_skill && e.final_context_tokens != null);
  const baseline = executions.filter((e) => !e.with_skill && e.final_context_tokens != null);

  if (baseline.length === 0 || withSkill.length === 0) return 50;

  const avgWithSkill = mean(withSkill.map((e) => e.final_context_tokens!));
  const avgBaseline = mean(baseline.map((e) => e.final_context_tokens!));

  if (avgBaseline === 0) return 50;

  const reductionPct = ((avgBaseline - avgWithSkill) / avgBaseline) * 100;

  if (reductionPct < 0) {
    return Math.max(0, 50 + reductionPct);
  }
  return Math.min(100, 50 + reductionPct * 0.556);
}

/**
 * Score task completion: does the agent still complete tasks with the skill?
 * 70 = same as baseline, 100 = significantly better, 0 = much worse
 */
export function scoreTaskCompletion(executions: readonly Execution[]): number {
  const withSkill = executions.filter((e) => e.with_skill && e.task_completed != null);
  const baseline = executions.filter((e) => !e.with_skill && e.task_completed != null);

  if (baseline.length === 0 || withSkill.length === 0) return 70;

  const withSkillRate = mean(withSkill.map((e) => (e.task_completed ? 100 : 0)));
  const baselineRate = mean(baseline.map((e) => (e.task_completed ? 100 : 0)));

  const delta = withSkillRate - baselineRate;

  if (delta >= 0) {
    return Math.min(100, 70 + delta * 0.3);
  }
  return Math.max(0, 70 + delta * 0.7);
}

/**
 * Score quality preservation: is response quality maintained?
 * Based on LLM-judged completion_quality (0-100)
 */
export function scoreQualityPreservation(executions: readonly Execution[]): number {
  const withSkill = executions.filter((e) => e.with_skill && e.completion_quality != null);

  if (withSkill.length === 0) return 70;

  return mean(withSkill.map((e) => e.completion_quality!));
}

/**
 * Score latency impact: does the skill improve or degrade latency?
 * 50 = no change, 100 = much faster, 0 = much slower
 */
export function scoreLatencyImpact(executions: readonly Execution[]): number {
  const withSkill = executions.filter((e) => e.with_skill && e.avg_turn_latency_ms != null);
  const baseline = executions.filter((e) => !e.with_skill && e.avg_turn_latency_ms != null);

  if (baseline.length === 0 || withSkill.length === 0) return 50;

  const avgWithSkill = mean(withSkill.map((e) => e.avg_turn_latency_ms!));
  const avgBaseline = mean(baseline.map((e) => e.avg_turn_latency_ms!));

  if (avgBaseline === 0) return 50;

  // Positive = faster, negative = slower
  const improvementPct = ((avgBaseline - avgWithSkill) / avgBaseline) * 100;

  return Math.min(100, Math.max(0, 50 + improvementPct * 0.5));
}

/**
 * Compute the weighted composite score.
 */
export function computeCompositeScore(scores: {
  readonly tokenEfficiency: number;
  readonly taskCompletion: number;
  readonly qualityPreservation: number;
  readonly latencyImpact: number;
}): number {
  return Math.round(
    (scores.tokenEfficiency * SCORING_WEIGHTS.tokenEfficiency +
      scores.taskCompletion * SCORING_WEIGHTS.taskCompletion +
      scores.qualityPreservation * SCORING_WEIGHTS.qualityPreservation +
      scores.latencyImpact * SCORING_WEIGHTS.latencyImpact) *
      100
  ) / 100;
}

/**
 * Compute all scores from a set of executions.
 */
export function computeAllScores(executions: readonly Execution[]) {
  const tokenEfficiency = scoreTokenEfficiency(executions);
  const taskCompletion = scoreTaskCompletion(executions);
  const qualityPreservation = scoreQualityPreservation(executions);
  const latencyImpact = scoreLatencyImpact(executions);

  return Object.freeze({
    tokenEfficiency,
    taskCompletion,
    qualityPreservation,
    latencyImpact,
    overall: computeCompositeScore({
      tokenEfficiency,
      taskCompletion,
      qualityPreservation,
      latencyImpact,
    }),
  });
}

// Re-export for convenience
export { mean, percentile };
