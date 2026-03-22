import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink,
  GitBranch,
  Zap,
  Brain,
  Clock,
  Award,
  BarChart3,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Info,
  Lightbulb,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BenchmarkLiveStatus } from "@/components/benchmark-live-status";
import { BenchmarkActions } from "@/components/benchmark-actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScoreBadge } from "@/components/score-badge";

import { createServerSupabase } from "@/lib/supabase/server";
import type { SkillDetailResponse, Execution } from "@/lib/types";
import type { SkillStatus, AgentLoopType } from "@/lib/constants";
import { AGENT_LOOP_TYPES } from "@/lib/constants";
import { generateReport, type FindingSeverity } from "@/lib/report/generate-findings";

// ─── Helpers ──────────────────────────────────────────────────────────

function formatStatus(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatAgentLoop(loop: AgentLoopType): string {
  const labels: Record<AgentLoopType, string> = {
    hermes: "Hermes",
    claude_api: "Claude API",
    claude_cli: "Claude CLI",
  };
  return labels[loop] ?? loop;
}

function formatFormat(format: string): string {
  return format === "claude_code" ? "Claude Code" : "OpenClaw";
}

function statusVariant(
  status: SkillStatus
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

// ─── Execution grouping ──────────────────────────────────────────────

interface BenchmarkRow {
  readonly model: string;
  readonly withSkillTokens: number | null;
  readonly baselineTokens: number | null;
  readonly reductionPct: number | null;
  readonly taskCompleted: boolean | null;
  readonly qualityScore: number | null;
  readonly latencyMs: number | null;
}

function groupExecutionsByAgentLoop(
  executions: readonly Execution[]
): Record<string, readonly BenchmarkRow[]> {
  const byLoop: Record<string, Execution[]> = {};

  for (const exec of executions) {
    const key = exec.agent_loop;
    const list = byLoop[key] ?? [];
    byLoop[key] = [...list, exec];
  }

  const result: Record<string, readonly BenchmarkRow[]> = {};

  for (const [loop, execs] of Object.entries(byLoop)) {
    // Group by model, then pair with_skill / baseline
    const byModel: Record<string, { withSkill?: Execution; baseline?: Execution }> = {};

    for (const exec of execs) {
      const entry = byModel[exec.model] ?? {};
      if (exec.with_skill) {
        byModel[exec.model] = { ...entry, withSkill: exec };
      } else {
        byModel[exec.model] = { ...entry, baseline: exec };
      }
    }

    result[loop] = Object.entries(byModel).map(([model, pair]) => {
      const ws = pair.withSkill?.total_tokens ?? null;
      const bs = pair.baseline?.total_tokens ?? null;
      const reduction =
        ws !== null && bs !== null && bs > 0
          ? Math.round(((bs - ws) / bs) * 100)
          : null;

      return {
        model,
        withSkillTokens: ws,
        baselineTokens: bs,
        reductionPct: reduction,
        taskCompleted: pair.withSkill?.task_completed ?? null,
        qualityScore: pair.withSkill?.completion_quality ?? null,
        latencyMs: pair.withSkill?.avg_turn_latency_ms ?? null,
      };
    });
  }

  return result;
}

// ─── Score card icons ────────────────────────────────────────────────

const SCORE_ICONS: Record<string, typeof Zap> = {
  token_efficiency: Zap,
  task_completion: Award,
  quality: Brain,
  latency: Clock,
};

// ─── Page ────────────────────────────────────────────────────────────

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function SkillDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: skill } = await supabase
    .from("skills")
    .select("*")
    .eq("id", id)
    .single();

  if (!skill) {
    notFound();
  }

  // Fetch runs, scenarios, executions
  const { data: runs } = await supabase
    .from("benchmark_runs")
    .select("*")
    .eq("skill_id", id)
    .order("run_number", { ascending: false });

  const latestRun = runs?.[0];
  let latestExecutions: Execution[] = [];

  if (latestRun) {
    const { data: executions } = await supabase
      .from("executions")
      .select("*")
      .eq("benchmark_run_id", latestRun.id)
      .order("model", { ascending: true });
    latestExecutions = (executions ?? []) as Execution[];
  }
  const isCompleted = skill.status === "completed";
  const groupedExecutions = groupExecutionsByAgentLoop(latestExecutions);

  // Generate data-driven report from execution data
  const report = isCompleted
    ? generateReport(
        {
          overall: skill.overall_score,
          tokenEfficiency: skill.token_efficiency_score,
          taskCompletion: skill.task_completion_score,
          quality: skill.quality_preservation_score,
          latency: skill.latency_impact_score,
        },
        latestExecutions
      )
    : null;

  // Determine which agent loop tabs have data
  const availableLoops = AGENT_LOOP_TYPES.filter(
    (loop) => groupedExecutions[loop] && groupedExecutions[loop].length > 0
  );
  const defaultLoop = availableLoops[0] ?? "hermes";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {skill.display_name ?? skill.name ?? "Unnamed Skill"}
            </h1>
            <Badge variant="outline">{formatFormat(skill.format)}</Badge>
            <Badge variant={statusVariant(skill.status)}>
              {formatStatus(skill.status)}
            </Badge>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground font-mono">
            {skill.repo_owner}/{skill.repo_name}
          </p>
          {skill.description && (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground line-clamp-3">
              {skill.description}
            </p>
          )}
        </div>

        <Link
          href={skill.github_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          <Button variant="outline" size="sm">
            <GitBranch className="mr-1.5 size-4" />
            GitHub
            <ExternalLink className="ml-1.5 size-3" />
          </Button>
        </Link>
      </div>

      <Separator className="my-6" />

      {/* ── In-progress / Failed state (live) ─────────────────── */}
      {!isCompleted && (
        <BenchmarkLiveStatus skillId={skill.id} />
      )}

      {/* ── Completed results ─────────────────────────────────── */}
      {isCompleted && (
        <div className="flex flex-col gap-8">
          {/* Score Overview */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <BarChart3 className="size-5" />
              Score Overview
            </h2>

            {/* Overall Score */}
            {skill.overall_score !== null && (
              <div className="mb-6 flex justify-center">
                <ScoreBadge
                  score={skill.overall_score}
                  label="Overall Score"
                  size="lg"
                />
              </div>
            )}

            {/* 4 score cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                {
                  key: "token_efficiency",
                  label: "Token Efficiency",
                  score: skill.token_efficiency_score,
                },
                {
                  key: "task_completion",
                  label: "Task Completion",
                  score: skill.task_completion_score,
                },
                {
                  key: "quality",
                  label: "Quality",
                  score: skill.quality_preservation_score,
                },
                {
                  key: "latency",
                  label: "Latency",
                  score: skill.latency_impact_score,
                },
              ].map((item) => {
                const Icon = SCORE_ICONS[item.key];
                return (
                  <Card key={item.key}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-1.5 text-sm">
                        <Icon className="size-4 text-muted-foreground" />
                        {item.label}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex justify-center pb-4">
                      <ScoreBadge
                        score={item.score ?? 0}
                        label=""
                        size="sm"
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* Benchmark Report */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <FileText className="size-5" />
              Benchmark Report
            </h2>
            <Card>
              <CardContent className="pt-6 space-y-5">
                {/* Data-driven findings */}
                {report && (
                  <div className="space-y-4">
                    {report.findings.map((finding) => {
                      const colorMap: Record<FindingSeverity, { border: string; bg: string; text: string; Icon: typeof CheckCircle2 }> = {
                        success: { border: "border-green-500/20", bg: "bg-green-500/5", text: "text-green-400", Icon: CheckCircle2 },
                        warning: { border: "border-amber-500/20", bg: "bg-amber-500/5", text: "text-amber-400", Icon: AlertTriangle },
                        error: { border: "border-red-500/20", bg: "bg-red-500/5", text: "text-red-400", Icon: AlertTriangle },
                        info: { border: "border-blue-500/20", bg: "bg-blue-500/5", text: "text-blue-400", Icon: Info },
                      };
                      const style = colorMap[finding.severity];
                      const { Icon } = style;

                      return (
                        <div key={finding.dimension} className={`rounded-lg border ${style.border} ${style.bg} px-4 py-3`}>
                          <div className="flex items-start gap-3">
                            <Icon className={`mt-0.5 size-4 shrink-0 ${style.text}`} />
                            <div className="flex-1 space-y-2">
                              <div>
                                <p className={`text-sm font-medium ${style.text}`}>{finding.title}</p>
                                <p className="text-xs text-zinc-400 mt-0.5">{finding.summary}</p>
                              </div>

                              {/* Data points */}
                              {finding.dataPoints.length > 0 && (
                                <div className="space-y-0.5">
                                  {finding.dataPoints.map((point, i) => (
                                    <p key={i} className="text-xs text-zinc-500 font-mono">
                                      {point}
                                    </p>
                                  ))}
                                </div>
                              )}

                              {/* Improvement suggestions */}
                              {finding.suggestions.length > 0 && (
                                <div className="border-t border-zinc-800 pt-2 mt-2">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Lightbulb className="size-3 text-zinc-500" />
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Suggestions</span>
                                  </div>
                                  {finding.suggestions.map((suggestion, i) => (
                                    <p key={i} className="text-xs text-zinc-400 leading-relaxed">
                                      &bull; {suggestion}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Overall summary */}
                {report && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                    <p className="text-sm text-zinc-300">
                      <span className="font-medium">Overall: </span>
                      {report.overallSummary}
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <BenchmarkActions
                  skillId={skill.id}
                  githubUrl={skill.github_url}
                  overallScore={skill.overall_score}
                  tokenEfficiencyScore={skill.token_efficiency_score}
                  taskCompletionScore={skill.task_completion_score}
                  qualityScore={skill.quality_preservation_score}
                  latencyScore={skill.latency_impact_score}
                />
              </CardContent>
            </Card>
          </section>

          <Separator />

          {/* Benchmark Results */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <BarChart3 className="size-5" />
              Benchmark Results
            </h2>

            {availableLoops.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No execution data available yet.
              </p>
            ) : (
              <Tabs defaultValue={defaultLoop}>
                <TabsList>
                  {AGENT_LOOP_TYPES.map((loop) => (
                    <TabsTrigger
                      key={loop}
                      value={loop}
                      disabled={!availableLoops.includes(loop)}
                    >
                      {formatAgentLoop(loop)}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {availableLoops.map((loop) => (
                  <TabsContent key={loop} value={loop}>
                    <Card>
                      <CardContent className="pt-4">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Model</TableHead>
                              <TableHead className="text-right">
                                With Skill
                              </TableHead>
                              <TableHead className="text-right">
                                Baseline
                              </TableHead>
                              <TableHead className="text-right">
                                Reduction
                              </TableHead>
                              <TableHead className="text-center">
                                Completed
                              </TableHead>
                              <TableHead className="text-right">
                                Quality
                              </TableHead>
                              <TableHead className="text-right">
                                Latency
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(groupedExecutions[loop] ?? []).map((row) => (
                              <TableRow key={row.model}>
                                <TableCell className="font-medium">
                                  {row.model}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {row.withSkillTokens?.toLocaleString() ?? "--"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {row.baselineTokens?.toLocaleString() ?? "--"}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.reductionPct !== null ? (
                                    <Badge
                                      variant={
                                        row.reductionPct > 0
                                          ? "default"
                                          : "destructive"
                                      }
                                    >
                                      {row.reductionPct > 0 ? "-" : "+"}
                                      {Math.abs(row.reductionPct)}%
                                    </Badge>
                                  ) : (
                                    "--"
                                  )}
                                </TableCell>
                                <TableCell className="text-center">
                                  {row.taskCompleted === null
                                    ? "--"
                                    : row.taskCompleted
                                      ? "Yes"
                                      : "No"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {row.qualityScore !== null
                                    ? `${Math.round(row.qualityScore)}/100`
                                    : "--"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {row.latencyMs !== null
                                    ? `${Math.round(row.latencyMs)}ms`
                                    : "--"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </section>

          <Separator />

          {/* Context Growth Placeholder */}
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <BarChart3 className="size-5" />
              Context Growth
            </h2>
            <Card>
              <CardContent className="flex min-h-[200px] items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Context growth chart coming soon
                </p>
              </CardContent>
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}
