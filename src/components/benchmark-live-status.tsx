"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import useSWR from "swr";
import {
  CheckCircle2,
  ArrowRight,
  Info,
  AlertCircle,
  RefreshCw,
  Loader2,
  FlaskConical,
  ChevronDown,
  ChevronUp,
  XCircle,
  RotateCcw,
  Share2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SKILL_STATUSES, type SkillStatus } from "@/lib/constants";
import type { Skill } from "@/lib/types";

// ─── Types ──────────────────────────────────────────────────────────────

interface ActivityEvent {
  readonly id: string;
  readonly skill_id: string;
  readonly event_type: "status_change" | "progress" | "info" | "error";
  readonly stage: string;
  readonly message: string;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
}

interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly system_prompt: string;
  readonly user_prompt: string;
  readonly max_turns: number;
  readonly expected_tool_calls: number | null;
}

interface SkillStatusResponse {
  readonly skill: Skill;
  readonly latestScenarios: readonly Scenario[];
}

interface EventsResponse {
  readonly events: readonly ActivityEvent[];
}

interface BenchmarkLiveStatusProps {
  readonly skillId: string;
}

// ─── Constants ──────────────────────────────────────────────────────────

const IN_PROGRESS_STATUSES = new Set<SkillStatus>([
  "pending",
  "cloning",
  "parsing",
  "generating_scenarios",
  "benchmarking",
  "scoring",
]);

const PIPELINE_STAGES = SKILL_STATUSES.filter(
  (s): s is Exclude<SkillStatus, "failed"> => s !== "failed"
);

const STAGE_BASE_PROGRESS: Record<string, number> = {
  pending: 2,
  cloning: 10,
  parsing: 20,
  generating_scenarios: 35,
  benchmarking: 40,
  scoring: 90,
  completed: 100,
};

const STAGE_LABELS: Record<string, string> = {
  pending: "Queued",
  cloning: "Cloning Repository",
  parsing: "Parsing Skill",
  generating_scenarios: "Generating Scenarios",
  benchmarking: "Running Benchmarks",
  scoring: "Computing Scores",
  completed: "Complete",
  failed: "Failed",
};

const EVENT_CONFIG = {
  status_change: {
    icon: CheckCircle2,
    color: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
  },
  progress: {
    icon: ArrowRight,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  info: {
    icon: Info,
    color: "text-zinc-400",
    bg: "bg-zinc-500/10",
    border: "border-zinc-500/20",
  },
  error: {
    icon: AlertCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
  },
} as const;

const POLL_INTERVAL_MS = 2000;

// ─── Helpers ────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatStatus(status: string): string {
  return STAGE_LABELS[status] ?? status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function computeProgress(
  status: SkillStatus,
  events: readonly ActivityEvent[]
): number {
  if (status === "failed") return 0;

  const base = STAGE_BASE_PROGRESS[status] ?? 0;

  if (status !== "benchmarking") return base;

  // Interpolate benchmarking progress using the latest progress event
  const latestProgressEvent = events.find(
    (e) => e.event_type === "progress" && e.stage === "benchmarking"
  );

  if (!latestProgressEvent) return base;

  const { completed, total } = latestProgressEvent.metadata as {
    completed?: number;
    total?: number;
  };

  if (
    typeof completed !== "number" ||
    typeof total !== "number" ||
    total <= 0
  ) {
    return base;
  }

  // benchmarking range: 40-85% (45% span)
  return Math.min(85, base + (completed / total) * 45);
}

// ─── Component ──────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  token_efficiency: "Token Efficiency",
  task_completion: "Task Completion",
  quality_preservation: "Quality",
  stress_test: "Stress Test",
};

const CATEGORY_COLORS: Record<string, string> = {
  token_efficiency: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  task_completion: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  quality_preservation: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  stress_test: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function BenchmarkLiveStatus({ skillId }: BenchmarkLiveStatusProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const hasReloaded = useRef(false);
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);

  // Poll skill status
  const { data: statusData } = useSWR<SkillStatusResponse>(
    `/api/skills/${skillId}`,
    fetcher,
    {
      refreshInterval: (data) => {
        if (!data?.skill) return POLL_INTERVAL_MS;
        if (IN_PROGRESS_STATUSES.has(data.skill.status)) return POLL_INTERVAL_MS;
        return 0;
      },
      revalidateOnFocus: true,
    }
  );

  // Poll activity events
  const { data: eventsData } = useSWR<EventsResponse>(
    `/api/skills/${skillId}/events`,
    fetcher,
    {
      refreshInterval: () => {
        if (!statusData?.skill) return POLL_INTERVAL_MS;
        if (IN_PROGRESS_STATUSES.has(statusData.skill.status)) {
          return POLL_INTERVAL_MS;
        }
        return 0;
      },
      revalidateOnFocus: true,
    }
  );

  const skill = statusData?.skill;
  const scenarios = statusData?.latestScenarios ?? [];
  const events = eventsData?.events ?? [];
  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const status = skill?.status ?? "pending";
  const progress = computeProgress(status, sortedEvents);
  const isInProgress = IN_PROGRESS_STATUSES.has(status);
  const isCompleted = status === "completed";
  const isFailed = status === "failed";

  // Auto-scroll activity feed when new events arrive
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [events.length]);

  // Reload page when completed to show full results
  const handleReload = useCallback(() => {
    if (isCompleted && !hasReloaded.current) {
      hasReloaded.current = true;
      // Short delay so the user sees the completed state briefly
      const timer = setTimeout(() => {
        window.location.reload();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isCompleted]);

  useEffect(() => {
    return handleReload();
  }, [handleReload]);

  const handleCancel = async () => {
    if (!confirm("Cancel this benchmark? This cannot be undone.")) return;
    await fetch(`/api/skills/${skillId}/cancel`, { method: "POST" });
    window.location.reload();
  };

  const handleRestart = async () => {
    if (!confirm("Restart this benchmark from scratch?")) return;
    await fetch(`/api/skills/${skillId}/restart`, { method: "POST" });
    window.location.reload();
  };

  const handleShare = async () => {
    const res = await fetch(`/api/skills/${skillId}/share`);
    const data = await res.json();
    if (navigator.share) {
      await navigator.share({ title: data.title, text: data.text, url: data.url });
    } else {
      await navigator.clipboard.writeText(data.url);
      alert("Link copied to clipboard!");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Progress Section ─────────────────────────────────── */}
      <Card className="border-zinc-800 bg-black">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-zinc-100">
            {isInProgress && (
              <Loader2 className="size-4 animate-spin text-blue-400" />
            )}
            {isCompleted && (
              <CheckCircle2 className="size-4 text-green-400" />
            )}
            {isFailed && (
              <AlertCircle className="size-4 text-red-400" />
            )}
            Processing Pipeline
          </CardTitle>
          <CardDescription className="text-zinc-400">
            {isFailed
              ? `Failed: ${skill?.error_message ?? "Unknown error"}`
              : `Current stage: ${formatStatus(status)}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Progress bar with percentage */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">
                {formatStatus(status)}
              </span>
              <span className="text-sm tabular-nums text-zinc-400">
                {Math.round(progress)}%
              </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-700 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Pipeline stage badges */}
          <div className="flex flex-wrap gap-2">
            {PIPELINE_STAGES.map((stage) => {
              const stageIdx = PIPELINE_STAGES.indexOf(stage);
              const currentIdx = PIPELINE_STAGES.indexOf(
                status as Exclude<SkillStatus, "failed">
              );
              const isDone = stageIdx < currentIdx;
              const isCurrent = stage === status;

              return (
                <Badge
                  key={stage}
                  variant={
                    isDone ? "default" : isCurrent ? "secondary" : "outline"
                  }
                  className={
                    isCurrent
                      ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                      : isDone
                        ? "border-green-500/30 bg-green-500/10 text-green-400"
                        : "border-zinc-700 text-zinc-500"
                  }
                >
                  {isDone && <CheckCircle2 className="mr-1 size-3" />}
                  {isCurrent && <Loader2 className="mr-1 size-3 animate-spin" />}
                  {formatStatus(stage)}
                </Badge>
              );
            })}
          </div>

          {/* Benchmark level indicator */}
          {(() => {
            const level = (skill as unknown as Record<string, unknown>)?.benchmark_level as string | null;
            const cfg = level === "comprehensive"
              ? { name: "Comprehensive", color: "border-amber-500/30 bg-amber-500/10 text-amber-400" }
              : level === "standard"
                ? { name: "Standard", color: "border-blue-500/30 bg-blue-500/10 text-blue-400" }
                : { name: "Basic", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" };
            return (
              <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                <span className="text-xs font-medium text-zinc-500">Level</span>
                <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.name}</Badge>
              </div>
            );
          })()}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {isInProgress && (
              <button
                type="button"
                onClick={handleCancel}
                className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                <XCircle className="size-3.5" />
                Cancel
              </button>
            )}
            {(isCompleted || isFailed) && (
              <button
                type="button"
                onClick={handleRestart}
                className="flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/20"
              >
                <RotateCcw className="size-3.5" />
                Restart
              </button>
            )}
            <button
              type="button"
              onClick={handleShare}
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700/50"
            >
              <Share2 className="size-3.5" />
              Share
            </button>
          </div>

          {/* Auto-update notice */}
          {isInProgress && (
            <p className="flex items-center gap-1.5 text-xs text-zinc-500">
              <RefreshCw className="size-3 animate-spin" />
              Updating every {POLL_INTERVAL_MS / 1000}s
            </p>
          )}

          {/* Success banner */}
          {isCompleted && (
            <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3">
              <CheckCircle2 className="size-4 text-green-400" />
              <span className="text-sm font-medium text-green-400">
                Benchmark complete! Loading results...
              </span>
              <Loader2 className="ml-auto size-4 animate-spin text-green-400" />
            </div>
          )}

          {/* Failed banner */}
          {isFailed && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
              <AlertCircle className="size-4 text-red-400" />
              <span className="text-sm text-red-400">
                {skill?.error_message ?? "An unexpected error occurred during benchmarking."}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Generated Scenarios ─────────────────────────────── */}
      {scenarios.length > 0 && (
        <Card className="border-zinc-800 bg-black">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-zinc-100">
              <FlaskConical className="size-4 text-purple-400" />
              Generated Scenarios
            </CardTitle>
            <CardDescription className="text-zinc-400">
              {scenarios.length} test scenarios generated for benchmarking
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {scenarios.map((scenario) => {
              const isExpanded = expandedScenario === scenario.id;
              const catColor = CATEGORY_COLORS[scenario.category] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";

              return (
                <div
                  key={scenario.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/50"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedScenario(isExpanded ? null : scenario.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-800/50"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-200">
                          {scenario.name.replace(/_/g, " ")}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-xs ${catColor}`}
                        >
                          {CATEGORY_LABELS[scenario.category] ?? scenario.category}
                        </Badge>
                      </div>
                      <span className="text-xs text-zinc-500 line-clamp-1">
                        {scenario.description}
                      </span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="size-4 shrink-0 text-zinc-500" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0 text-zinc-500" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
                      <div>
                        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">System Prompt</span>
                        <pre className="mt-1 max-h-32 overflow-auto rounded bg-zinc-950 p-2 text-xs text-zinc-300 whitespace-pre-wrap font-mono">
                          {scenario.system_prompt}
                        </pre>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">User Prompt</span>
                        <pre className="mt-1 max-h-32 overflow-auto rounded bg-zinc-950 p-2 text-xs text-zinc-300 whitespace-pre-wrap font-mono">
                          {scenario.user_prompt}
                        </pre>
                      </div>
                      <div className="flex gap-4 text-xs text-zinc-500">
                        <span>Max turns: <span className="text-zinc-300">{scenario.max_turns}</span></span>
                        {scenario.expected_tool_calls != null && (
                          <span>Expected tool calls: <span className="text-zinc-300">{scenario.expected_tool_calls}</span></span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Activity Feed Section ────────────────────────────── */}
      <Card className="border-zinc-800 bg-black">
        <CardHeader>
          <CardTitle className="text-zinc-100">Activity</CardTitle>
          <CardDescription className="text-zinc-400">
            {sortedEvents.length === 0
              ? "Waiting for events..."
              : `${sortedEvents.length} event${sortedEvents.length !== 1 ? "s" : ""}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            ref={feedRef}
            className="flex max-h-96 flex-col gap-1 overflow-y-auto pr-1"
          >
            {sortedEvents.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-zinc-600" />
              </div>
            )}
            {sortedEvents.map((event) => {
              const config = EVENT_CONFIG[event.event_type] ?? EVENT_CONFIG.info;
              const Icon = config.icon;
              const meta = event.metadata as Record<string, unknown>;
              const hasProgress = typeof meta.completed === "number" && typeof meta.total === "number";

              return (
                <div
                  key={event.id}
                  className={`flex items-start gap-3 rounded-md border px-3 py-2 ${config.bg} ${config.border}`}
                >
                  <Icon className={`mt-0.5 size-4 shrink-0 ${config.color}`} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm text-zinc-200">
                      {event.message}
                    </span>
                    {hasProgress && (
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all duration-500"
                            style={{ width: `${((meta.completed as number) / (meta.total as number)) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-zinc-500">
                          {meta.completed as number}/{meta.total as number}
                        </span>
                      </div>
                    )}
                    {meta.categories && Array.isArray(meta.categories) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(meta.categories as string[]).map((cat) => (
                          <Badge
                            key={cat}
                            variant="outline"
                            className={`text-xs ${CATEGORY_COLORS[cat] ?? "border-zinc-700 text-zinc-500"}`}
                          >
                            {CATEGORY_LABELS[cat] ?? cat}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <span className="text-xs text-zinc-500">
                      {formatRelativeTime(event.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
