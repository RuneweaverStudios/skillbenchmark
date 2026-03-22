import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Github, Calendar, LogIn } from "lucide-react";
import { DeleteSkillButton } from "@/components/delete-skill-button";
import type { Skill } from "@/lib/types";
import type { SkillStatus } from "@/lib/constants";

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  },
  cloning: {
    label: "Cloning",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  parsing: {
    label: "Parsing",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  generating_scenarios: {
    label: "Generating",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  benchmarking: {
    label: "Benchmarking",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  scoring: {
    label: "Scoring",
    className: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  },
};

function getStatusStyle(status: SkillStatus) {
  return (
    STATUS_STYLES[status] ?? {
      label: status,
      className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    }
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function DashboardPage() {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-black px-4 py-16">
        <div className="w-full max-w-md space-y-6 text-center">
          <LogIn className="mx-auto h-12 w-12 text-zinc-600" />
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Sign in to view your skills
          </h1>
          <p className="text-sm leading-relaxed text-zinc-400">
            You need to be logged in to see your submitted skills and track
            their benchmarking progress.
          </p>
          <Link
            href="/login"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary bg-clip-padding px-2.5 text-sm font-medium text-primary-foreground whitespace-nowrap transition-all outline-none select-none hover:bg-primary/80"
          >
            Sign in with GitHub
          </Link>
        </div>
      </div>
    );
  }

  const { data: skills, error } = await supabase
    .from("skills")
    .select("*")
    .eq("submitted_by", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-black px-4 py-16">
        <p className="text-sm text-red-400">
          Failed to load your skills. Please try again later.
        </p>
      </div>
    );
  }

  const userSkills = (skills ?? []) as Skill[];

  return (
    <div className="flex flex-1 flex-col items-center bg-black px-4 py-16">
      <div className="w-full max-w-5xl space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
            Your Skills
          </h1>
          <Link
            href="/submit"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary bg-clip-padding px-2.5 text-sm font-medium text-primary-foreground whitespace-nowrap transition-all outline-none select-none hover:bg-primary/80"
          >
            <Plus className="mr-2 h-4 w-4" />
            Submit a New Skill
          </Link>
        </div>

        {/* Skills Grid */}
        {userSkills.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <p className="text-sm text-zinc-400">
                You haven&apos;t submitted any skills yet.
              </p>
              <Link
                href="/submit"
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-secondary bg-clip-padding px-2.5 text-sm font-medium text-secondary-foreground whitespace-nowrap transition-all outline-none select-none hover:bg-secondary/80"
              >
                Submit your first skill
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {userSkills.map((skill) => {
              const statusStyle = getStatusStyle(skill.status);

              return (
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
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={statusStyle.className}
                          >
                            {statusStyle.label}
                          </Badge>
                          <DeleteSkillButton skillId={skill.id} />
                        </div>
                      </div>
                      {skill.description && (
                        <CardDescription className="line-clamp-2">
                          {skill.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        {skill.status === "completed" &&
                          skill.overall_score != null && (
                            <div className="flex items-center justify-between">
                              <span className="text-zinc-400">
                                Overall Score
                              </span>
                              <span className="font-mono font-semibold text-zinc-50">
                                {skill.overall_score.toFixed(1)}
                              </span>
                            </div>
                          )}
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <Github className="h-3.5 w-3.5" />
                          <span className="truncate font-mono text-xs">
                            {skill.repo_owner}/{skill.repo_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-zinc-500">
                          <Calendar className="h-3.5 w-3.5" />
                          <span className="text-xs">
                            {formatDate(skill.created_at)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
