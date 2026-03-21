"use client";

import { useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import {
  CheckCircle2,
  ArrowRight,
  Info,
  AlertCircle,
  RefreshCw,
  Loader2,
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

interface SkillStatusResponse {
  readonly skill: Skill;
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

export function BenchmarkLiveStatus({ skillId }: BenchmarkLiveStatusProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const hasReloaded = useRef(false);

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
            className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1"
          >
            {sortedEvents.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-zinc-600" />
              </div>
            )}
            {sortedEvents.map((event) => {
              const config = EVENT_CONFIG[event.event_type] ?? EVENT_CONFIG.info;
              const Icon = config.icon;

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
