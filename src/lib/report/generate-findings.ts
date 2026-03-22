/**
 * Generates data-driven benchmark findings from execution data.
 * Each dimension gets: what went well, what needs work, and actionable suggestions.
 */

import type { Execution } from "@/lib/types";

// ─── Types ──────────────────────────────────────────────────────────────

export type FindingSeverity = "success" | "warning" | "error" | "info";

export interface Finding {
  readonly dimension: string;
  readonly title: string;
  readonly severity: FindingSeverity;
  readonly summary: string;
  readonly dataPoints: readonly string[];
  readonly suggestions: readonly string[];
}

export interface ReportData {
  readonly findings: readonly Finding[];
  readonly overallSummary: string;
}

interface Scores {
  readonly overall: number | null;
  readonly tokenEfficiency: number | null;
  readonly taskCompletion: number | null;
  readonly quality: number | null;
  readonly latency: number | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function pct(a: number, b: number): number {
  if (b === 0) return 0;
  return Math.round(((b - a) / b) * 100);
}

function severity(score: number, thresholds: { error: number; warning: number }): FindingSeverity {
  if (score < thresholds.error) return "error";
  if (score < thresholds.warning) return "warning";
  return "success";
}

// ─── Per-model metrics ──────────────────────────────────────────────────

interface ModelMetric {
  readonly model: string;
  readonly withSkillTokens: number;
  readonly baselineTokens: number;
  readonly reductionPct: number;
  readonly withSkillCompleted: boolean;
  readonly baselineCompleted: boolean;
  readonly qualityScore: number | null;
  readonly withSkillLatency: number;
  readonly baselineLatency: number;
  readonly latencyDeltaPct: number;
}

function computeModelMetrics(executions: readonly Execution[]): readonly ModelMetric[] {
  const withSkill = executions.filter((e) => e.with_skill);
  const baseline = executions.filter((e) => !e.with_skill);

  const models = new Set(executions.map((e) => e.model));
  const metrics: ModelMetric[] = [];

  for (const model of models) {
    const ws = withSkill.filter((e) => e.model === model);
    const bl = baseline.filter((e) => e.model === model);

    if (ws.length === 0 || bl.length === 0) continue;

    const wsTokens = mean(ws.map((e) => e.total_tokens ?? 0));
    const blTokens = mean(bl.map((e) => e.total_tokens ?? 0));
    const wsLatency = mean(ws.filter((e) => e.avg_turn_latency_ms != null).map((e) => e.avg_turn_latency_ms!));
    const blLatency = mean(bl.filter((e) => e.avg_turn_latency_ms != null).map((e) => e.avg_turn_latency_ms!));

    metrics.push({
      model,
      withSkillTokens: Math.round(wsTokens),
      baselineTokens: Math.round(blTokens),
      reductionPct: pct(wsTokens, blTokens),
      withSkillCompleted: ws.some((e) => e.task_completed === true),
      baselineCompleted: bl.some((e) => e.task_completed === true),
      qualityScore: ws[0]?.completion_quality ?? null,
      withSkillLatency: Math.round(wsLatency),
      baselineLatency: Math.round(blLatency),
      latencyDeltaPct: pct(wsLatency, blLatency),
    });
  }

  return metrics;
}

// ─── Dimension analyzers ────────────────────────────────────────────────

function analyzeTokenEfficiency(score: number, metrics: readonly ModelMetric[]): Finding {
  const sev = severity(score, { error: 40, warning: 60 });

  const avgReduction = metrics.length > 0
    ? Math.round(mean(metrics.map((m) => m.reductionPct)))
    : 0;

  const best = metrics.length > 0
    ? [...metrics].sort((a, b) => b.reductionPct - a.reductionPct)[0]
    : null;
  const worst = metrics.length > 0
    ? [...metrics].sort((a, b) => a.reductionPct - b.reductionPct)[0]
    : null;

  const dataPoints: string[] = [];
  const suggestions: string[] = [];

  if (avgReduction > 0) {
    dataPoints.push(`Average context reduction: ${avgReduction}%`);
  } else {
    dataPoints.push(`Context size increased by ${Math.abs(avgReduction)}% on average`);
  }

  if (best && metrics.length > 1) {
    dataPoints.push(`Best: ${best.model} (${best.reductionPct > 0 ? "-" : "+"}${Math.abs(best.reductionPct)}% tokens)`);
  }
  if (worst && metrics.length > 1 && worst.model !== best?.model) {
    dataPoints.push(`Worst: ${worst.model} (${worst.reductionPct > 0 ? "-" : "+"}${Math.abs(worst.reductionPct)}% tokens)`);
  }

  for (const m of metrics) {
    dataPoints.push(`${m.model}: ${m.withSkillTokens.toLocaleString()} tokens (baseline: ${m.baselineTokens.toLocaleString()})`);
  }

  // Suggestions based on score tiers
  if (score < 40) {
    suggestions.push("Add output compression or summarization instructions to reduce context bloat");
    suggestions.push("Remove verbose tool output formatting — raw results are often smaller");
    suggestions.push("Consider adding instructions to truncate long tool results");
  } else if (score < 60) {
    suggestions.push("Good start, but there's room to cut more tokens — look for redundant instructions");
    if (worst && worst.reductionPct < 10) {
      suggestions.push(`${worst.model} shows minimal reduction — test your skill specifically with this model`);
    }
  } else if (score < 80) {
    suggestions.push("Solid efficiency — to push higher, consider aggressive output filtering for tool results");
  } else {
    suggestions.push("Excellent efficiency — maintain this by keeping instructions concise as you add features");
  }

  const title = score >= 60 ? "Good Token Efficiency" : score >= 40 ? "Moderate Token Efficiency" : "High Token Usage";
  const summary = avgReduction > 0
    ? `The skill reduces context by ~${avgReduction}% on average across models.`
    : `The skill increases context by ~${Math.abs(avgReduction)}% on average — it's adding more tokens than it saves.`;

  return { dimension: "Token Efficiency", title, severity: sev, summary, dataPoints, suggestions };
}

function analyzeTaskCompletion(score: number, metrics: readonly ModelMetric[]): Finding {
  const sev = severity(score, { error: 50, warning: 65 });

  const withRate = metrics.length > 0
    ? Math.round((metrics.filter((m) => m.withSkillCompleted).length / metrics.length) * 100)
    : 0;
  const baseRate = metrics.length > 0
    ? Math.round((metrics.filter((m) => m.baselineCompleted).length / metrics.length) * 100)
    : 0;
  const delta = withRate - baseRate;

  const dataPoints: string[] = [];
  const suggestions: string[] = [];

  dataPoints.push(`Completion rate with skill: ${withRate}%`);
  dataPoints.push(`Baseline completion rate: ${baseRate}%`);
  if (delta !== 0) {
    dataPoints.push(`Delta: ${delta > 0 ? "+" : ""}${delta}pp ${delta > 0 ? "(improvement)" : "(degradation)"}`);
  }

  const failedModels = metrics.filter((m) => !m.withSkillCompleted && m.baselineCompleted);
  for (const m of failedModels) {
    dataPoints.push(`${m.model}: failed with skill active (baseline succeeded)`);
  }

  if (score < 50) {
    suggestions.push("The skill is likely adding constraints that block task completion — review restrictive instructions");
    suggestions.push("Check if the skill overrides or conflicts with tool usage patterns");
    if (failedModels.length > 0) {
      suggestions.push(`Focus on ${failedModels.map((m) => m.model).join(", ")} — these models fail only with the skill active`);
    }
  } else if (score < 65) {
    suggestions.push("Some tasks fail with the skill active — simplify instructions that may over-constrain the model");
    suggestions.push("Ensure the skill doesn't add conflicting instructions about output format or tool usage");
  } else if (score < 80) {
    suggestions.push("Task completion is solid — review edge cases where the skill might add unnecessary constraints");
  } else {
    suggestions.push("Excellent completion rate — the skill enhances rather than restricts model capability");
  }

  const title = score >= 65 ? "Solid Task Completion" : score >= 50 ? "Moderate Task Completion" : "Low Task Completion";
  const summary = delta >= 0
    ? `The skill maintains or improves task completion (${withRate}% vs ${baseRate}% baseline).`
    : `Task completion drops by ${Math.abs(delta)}pp with the skill active (${withRate}% vs ${baseRate}% baseline).`;

  return { dimension: "Task Completion", title, severity: sev, summary, dataPoints, suggestions };
}

function analyzeQuality(score: number, metrics: readonly ModelMetric[]): Finding {
  const sev = severity(score, { error: 40, warning: 60 });

  const qualityScores = metrics
    .filter((m) => m.qualityScore != null)
    .map((m) => ({ model: m.model, score: m.qualityScore! }));

  const avgQuality = qualityScores.length > 0
    ? Math.round(mean(qualityScores.map((q) => q.score)))
    : score;

  const best = qualityScores.length > 0
    ? [...qualityScores].sort((a, b) => b.score - a.score)[0]
    : null;
  const worst = qualityScores.length > 0
    ? [...qualityScores].sort((a, b) => a.score - b.score)[0]
    : null;

  const dataPoints: string[] = [];
  const suggestions: string[] = [];

  dataPoints.push(`Average quality score: ${avgQuality}/100`);
  if (best && qualityScores.length > 1) {
    dataPoints.push(`Best: ${best.model} (${Math.round(best.score)}/100)`);
  }
  if (worst && qualityScores.length > 1 && worst.model !== best?.model) {
    dataPoints.push(`Worst: ${worst.model} (${Math.round(worst.score)}/100)`);
  }

  if (score < 40) {
    suggestions.push("Response quality drops significantly — the skill's instructions may be too restrictive");
    suggestions.push("Check if the skill forces output formats that strip important information");
    suggestions.push("Consider using softer language ('prefer' vs 'always') to give the model flexibility");
  } else if (score < 60) {
    suggestions.push("Noticeable quality loss — review instructions that constrain response content or length");
    if (worst && worst.score < 50) {
      suggestions.push(`${worst.model} quality is particularly low — this model may need different instruction style`);
    }
  } else if (score < 80) {
    suggestions.push("Quality is mostly preserved — minor improvements possible by reducing overly specific output constraints");
  } else {
    suggestions.push("Quality is well maintained — the skill enhances without degrading response content");
  }

  const title = score >= 60 ? "Quality Preserved" : score >= 40 ? "Some Quality Loss" : "Quality Degradation";
  const summary = score >= 70
    ? `Response quality is well-preserved with the skill active (avg ${avgQuality}/100).`
    : `Response quality shows degradation with the skill active (avg ${avgQuality}/100).`;

  return { dimension: "Quality", title, severity: sev, summary, dataPoints, suggestions };
}

function analyzeLatency(score: number, metrics: readonly ModelMetric[]): Finding {
  const sev = severity(score, { error: 35, warning: 50 });

  const avgDelta = metrics.length > 0
    ? Math.round(mean(metrics.map((m) => m.latencyDeltaPct)))
    : 0;

  const dataPoints: string[] = [];
  const suggestions: string[] = [];

  if (avgDelta > 0) {
    dataPoints.push(`Average latency improvement: ${avgDelta}%`);
  } else if (avgDelta < 0) {
    dataPoints.push(`Average latency increase: ${Math.abs(avgDelta)}%`);
  } else {
    dataPoints.push("Latency unchanged from baseline");
  }

  for (const m of metrics) {
    if (m.withSkillLatency > 0) {
      dataPoints.push(`${m.model}: ${m.withSkillLatency}ms/turn (baseline: ${m.baselineLatency}ms)`);
    }
  }

  if (score < 35) {
    suggestions.push("Significant latency increase — reduce system prompt size or simplify instructions");
    suggestions.push("Consider lazy-loading skill instructions only when relevant triggers are detected");
    suggestions.push("Large skill files add overhead on every turn — keep instructions concise");
  } else if (score < 50) {
    suggestions.push("Moderate latency impact — look for verbose instructions that could be condensed");
    suggestions.push("Remove redundant examples or overly detailed formatting rules");
  } else if (score < 65) {
    suggestions.push("Acceptable latency — minor gains possible by trimming instruction length");
  } else {
    suggestions.push("Good latency profile — the skill doesn't add meaningful overhead");
  }

  const title = score >= 50 ? "Acceptable Latency" : score >= 35 ? "Elevated Latency" : "High Latency Impact";
  const summary = avgDelta >= 0
    ? `The skill improves or maintains response latency (${avgDelta}% faster on average).`
    : `The skill adds ~${Math.abs(avgDelta)}% latency per turn on average.`;

  return { dimension: "Latency", title, severity: sev, summary, dataPoints, suggestions };
}

// ─── Overall summary ────────────────────────────────────────────────────

function generateOverallSummary(scores: Scores, findings: readonly Finding[]): string {
  const overall = scores.overall ?? 0;
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  if (overall >= 80) {
    return `This skill scores ${overall}/100 and performs well across all dimensions. ${warningCount > 0 ? `There ${warningCount === 1 ? "is" : "are"} ${warningCount} area${warningCount === 1 ? "" : "s"} with room for minor improvement.` : "Ready for production use."}`;
  }
  if (overall >= 60) {
    return `This skill scores ${overall}/100 and shows solid performance with some areas for improvement. ${errorCount > 0 ? `${errorCount} dimension${errorCount === 1 ? "" : "s"} need${errorCount === 1 ? "s" : ""} attention.` : "Review the suggestions below to push scores higher."}`;
  }
  if (overall >= 40) {
    return `This skill scores ${overall}/100. There are ${errorCount + warningCount} dimensions that need work. Focus on the critical issues first — small changes to instruction style can yield big score improvements.`;
  }
  return `This skill scores ${overall}/100 and needs significant improvement across multiple dimensions. Start with the highest-impact suggestions below before re-benchmarking.`;
}

// ─── Main ───────────────────────────────────────────────────────────────

export function generateReport(
  scores: Scores,
  executions: readonly Execution[]
): ReportData {
  const metrics = computeModelMetrics(executions);

  const findings: Finding[] = [
    analyzeTokenEfficiency(scores.tokenEfficiency ?? 50, metrics),
    analyzeTaskCompletion(scores.taskCompletion ?? 70, metrics),
    analyzeQuality(scores.quality ?? 70, metrics),
    analyzeLatency(scores.latency ?? 50, metrics),
  ];

  const overallSummary = generateOverallSummary(scores, findings);

  return { findings, overallSummary };
}
