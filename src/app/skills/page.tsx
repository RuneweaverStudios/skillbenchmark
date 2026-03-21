import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Github, Trophy, User } from "lucide-react";
import type { Skill } from "@/lib/types";

function formatScore(score: number | null): string {
  if (score == null) return "--";
  return score.toFixed(1);
}

export default async function SkillsPage() {
  const supabase = await createServerSupabase();

  const { data: skills, error } = await supabase
    .from("skills")
    .select("*")
    .eq("status", "completed")
    .order("overall_score", { ascending: false });

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-black px-4 py-16">
        <p className="text-sm text-red-400">
          Failed to load skills. Please try again later.
        </p>
      </div>
    );
  }

  const completedSkills = (skills ?? []) as Skill[];

  return (
    <div className="flex flex-1 flex-col items-center bg-black px-4 py-16">
      <div className="w-full max-w-5xl space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
            All Benchmarked Skills
          </h1>
          <p className="max-w-lg text-sm leading-relaxed text-zinc-400">
            Browse skills that have completed the benchmark pipeline, ranked by
            overall score.
          </p>
        </div>

        {/* Skills Grid */}
        {completedSkills.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-zinc-400">
                No benchmarked skills yet. Be the first to{" "}
                <Link href="/submit" className="text-zinc-50 underline">
                  submit one
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {completedSkills.map((skill) => (
              <Link
                key={skill.id}
                href={`/skills/${skill.id}`}
                className="group"
              >
                <Card className="transition-colors group-hover:ring-zinc-700">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="line-clamp-1">
                        {skill.display_name ?? skill.name ?? skill.repo_name}
                      </CardTitle>
                      <Badge variant="secondary" className="shrink-0">
                        {skill.format === "claude_code"
                          ? "SKILL.md"
                          : "_meta.json"}
                      </Badge>
                    </div>
                    {skill.description && (
                      <CardDescription className="line-clamp-2">
                        {skill.description}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 text-sm">
                      {/* Overall Score */}
                      <div className="flex items-center justify-between rounded-lg bg-zinc-900/50 px-3 py-2">
                        <div className="flex items-center gap-1.5 text-zinc-400">
                          <Trophy className="h-4 w-4 text-amber-400" />
                          <span>Overall Score</span>
                        </div>
                        <span className="font-mono text-lg font-bold text-zinc-50">
                          {formatScore(skill.overall_score)}
                        </span>
                      </div>

                      {/* Sub-scores */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-500">
                        <div className="flex justify-between">
                          <span>Efficiency</span>
                          <span className="font-mono text-zinc-400">
                            {formatScore(skill.token_efficiency_score)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Completion</span>
                          <span className="font-mono text-zinc-400">
                            {formatScore(skill.task_completion_score)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Quality</span>
                          <span className="font-mono text-zinc-400">
                            {formatScore(skill.quality_preservation_score)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Latency</span>
                          <span className="font-mono text-zinc-400">
                            {formatScore(skill.latency_impact_score)}
                          </span>
                        </div>
                      </div>

                      {/* Meta */}
                      <div className="space-y-1.5 border-t border-zinc-800 pt-2">
                        {skill.author && (
                          <div className="flex items-center gap-1.5 text-zinc-500">
                            <User className="h-3.5 w-3.5" />
                            <span className="text-xs">{skill.author}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <Github className="h-3.5 w-3.5" />
                          <span className="truncate font-mono text-xs">
                            {skill.repo_owner}/{skill.repo_name}
                          </span>
                        </div>
                      </div>

                      {/* Tags */}
                      {skill.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {skill.tags.slice(0, 4).map((tag) => (
                            <Badge
                              key={tag}
                              variant="outline"
                              className="text-xs"
                            >
                              {tag}
                            </Badge>
                          ))}
                          {skill.tags.length > 4 && (
                            <Badge variant="outline" className="text-xs">
                              +{skill.tags.length - 4}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
