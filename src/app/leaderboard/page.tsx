import Link from "next/link";
import { Trophy, Medal, Award } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { createServerSupabase } from "@/lib/supabase/server";
import type { LeaderboardEntry } from "@/lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────

function formatFormat(format: string): string {
  return format === "claude_code" ? "Claude Code" : "OpenClaw";
}

function formatScore(score: number | null): string {
  if (score === null) return "--";
  return String(Math.round(score));
}

function getRankIcon(rank: number) {
  if (rank === 1) return <Trophy className="size-5 text-yellow-500" />;
  if (rank === 2) return <Medal className="size-5 text-zinc-400" />;
  if (rank === 3) return <Award className="size-5 text-amber-600" />;
  return (
    <span className="flex size-5 items-center justify-center text-sm text-muted-foreground tabular-nums">
      {rank}
    </span>
  );
}

function getRankRowClass(rank: number): string {
  if (rank === 1) return "bg-yellow-500/5";
  if (rank === 2) return "bg-zinc-400/5";
  if (rank === 3) return "bg-amber-600/5";
  return "";
}

// ─── Data fetching ──────────────────────────────────────────────────

async function fetchLeaderboard(): Promise<readonly LeaderboardEntry[]> {
  const supabase = await createServerSupabase();

  // Try materialized view first
  const { data: viewData, error: viewError } = await supabase
    .from("leaderboard")
    .select("*")
    .order("rank", { ascending: true });

  if (!viewError && viewData && viewData.length > 0) {
    return viewData as unknown as readonly LeaderboardEntry[];
  }

  // Fallback: query skills table directly
  const { data: skills, error: skillsError } = await supabase
    .from("skills")
    .select(
      "id, name, display_name, format, github_url, description, author, tags, overall_score, token_efficiency_score, task_completion_score, quality_preservation_score, latency_impact_score, submitted_by"
    )
    .eq("status", "completed")
    .not("overall_score", "is", null)
    .order("overall_score", { ascending: false });

  if (skillsError || !skills) {
    return [];
  }

  return skills.map(
    (skill, idx) =>
      ({
        skill_id: skill.id,
        name: skill.name ?? "Unnamed",
        display_name: skill.display_name,
        format: skill.format,
        github_url: skill.github_url,
        description: skill.description,
        author: skill.author,
        tags: skill.tags ?? [],
        overall_score: skill.overall_score ?? 0,
        token_efficiency_score: skill.token_efficiency_score,
        task_completion_score: skill.task_completion_score,
        quality_preservation_score: skill.quality_preservation_score,
        latency_impact_score: skill.latency_impact_score,
        submitted_by: skill.submitted_by,
        avatar_url: null,
        total_runs: 0,
        last_benchmarked_at: "",
        rank: idx + 1,
      }) satisfies LeaderboardEntry
  );
}

// ─── Page ───────────────────────────────────────────────────────────

export default async function LeaderboardPage() {
  const entries = await fetchLeaderboard();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <Trophy className="size-6 text-yellow-500" />
          Skill Leaderboard
        </h1>
        <p className="text-muted-foreground">
          Skills ranked by composite benchmark score
        </p>
      </div>

      {/* Table */}
      {entries.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">
            No benchmarked skills yet. Submit a skill to get started.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">Rank</TableHead>
                <TableHead>Skill</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right">Overall</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead className="text-right">Quality</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead>Author</TableHead>
                <TableHead className="text-right">Runs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={entry.skill_id}
                  className={getRankRowClass(entry.rank)}
                >
                  <TableCell className="text-center">
                    {getRankIcon(entry.rank)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/skills/${entry.skill_id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {entry.display_name ?? entry.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {formatFormat(entry.format)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-semibold tabular-nums">
                      {Math.round(entry.overall_score)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore(entry.token_efficiency_score)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore(entry.task_completion_score)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore(entry.quality_preservation_score)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatScore(entry.latency_impact_score)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar size="sm">
                        {entry.avatar_url ? (
                          <AvatarImage
                            src={entry.avatar_url}
                            alt={entry.author ?? "Author"}
                          />
                        ) : null}
                        <AvatarFallback>
                          {(entry.author ?? entry.submitted_by ?? "?")
                            .slice(0, 2)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm text-muted-foreground">
                        {entry.author ?? entry.submitted_by ?? "--"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {entry.total_runs}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
