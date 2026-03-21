"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GITHUB_URL_PATTERN } from "@/lib/constants";
import {
  Github,
  Search,
  Lock,
  Globe,
  FileText,
  Settings2,
  Loader2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  updated_at: string;
  language: string | null;
  private: boolean;
  has_skill_file: boolean;
  skill_format: "claude_code" | "openclaw" | null;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "loading"; repoId?: number }
  | { kind: "error"; message: string }
  | { kind: "success"; id: string };

type FetchState =
  | { kind: "loading" }
  | { kind: "error"; message: string; status?: number }
  | { kind: "success"; repos: readonly GitHubRepo[] };

function relativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `${diffYears}y ago`;
  if (diffMonths > 0) return `${diffMonths}mo ago`;
  if (diffWeeks > 0) return `${diffWeeks}w ago`;
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return "just now";
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "bg-blue-500",
  JavaScript: "bg-yellow-400",
  Python: "bg-green-500",
  Rust: "bg-orange-500",
  Go: "bg-cyan-500",
  Ruby: "bg-red-500",
  Java: "bg-red-700",
  "C++": "bg-pink-500",
  C: "bg-gray-500",
  Shell: "bg-emerald-500",
  Markdown: "bg-zinc-400",
};

function LanguageDot({ language }: { language: string }) {
  const color = LANGUAGE_COLORS[language] ?? "bg-zinc-500";
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      {language}
    </span>
  );
}

export default function SubmitPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "loading" });
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [manualUrl, setManualUrl] = useState("");

  const isManualValid = GITHUB_URL_PATTERN.test(manualUrl.trim());
  const isSubmitting = submitState.kind === "loading";

  // Fetch repos on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchRepos() {
      try {
        const response = await fetch("/api/github/repos");

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (!cancelled) {
            setFetchState({
              kind: "error",
              message:
                data.error ?? `Failed to fetch repositories (${response.status})`,
              status: response.status,
            });
          }
          return;
        }

        const data = await response.json();
        if (!cancelled) {
          setFetchState({ kind: "success", repos: data.repos ?? data });
        }
      } catch {
        if (!cancelled) {
          setFetchState({
            kind: "error",
            message: "Network error. Please check your connection and try again.",
          });
        }
      }
    }

    fetchRepos();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter and split repos
  const { skillRepos, otherRepos } = useMemo(() => {
    if (fetchState.kind !== "success") {
      return { skillRepos: [], otherRepos: [] };
    }

    const query = searchQuery.toLowerCase().trim();
    const filtered = query
      ? fetchState.repos.filter(
          (repo) =>
            repo.name.toLowerCase().includes(query) ||
            repo.full_name.toLowerCase().includes(query) ||
            (repo.description?.toLowerCase().includes(query) ?? false)
        )
      : fetchState.repos;

    const skill: GitHubRepo[] = [];
    const other: GitHubRepo[] = [];

    for (const repo of filtered) {
      if (repo.has_skill_file) {
        skill.push(repo);
      } else {
        other.push(repo);
      }
    }

    return { skillRepos: skill, otherRepos: other };
  }, [fetchState, searchQuery]);

  async function handleSelectRepo(repo: GitHubRepo) {
    setSubmitState({ kind: "loading", repoId: repo.id });

    try {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ github_url: repo.html_url }),
      });

      const data = await response.json();

      if (!response.ok) {
        const redirectId = data.id as string | undefined;
        if (response.status === 409 && redirectId) {
          router.push(`/skills/${redirectId}`);
          return;
        }
        setSubmitState({
          kind: "error",
          message: data.error ?? "Submission failed. Please try again.",
        });
        return;
      }

      setSubmitState({ kind: "success", id: data.skill.id });
      router.push(`/skills/${data.skill.id}`);
    } catch {
      setSubmitState({
        kind: "error",
        message: "Network error. Please check your connection and try again.",
      });
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedUrl = manualUrl.trim();
    if (!GITHUB_URL_PATTERN.test(trimmedUrl)) {
      setSubmitState({
        kind: "error",
        message:
          "Invalid GitHub URL. Must match https://github.com/owner/repo",
      });
      return;
    }

    setSubmitState({ kind: "loading" });

    try {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ github_url: trimmedUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        const redirectId = data.id as string | undefined;
        if (response.status === 409 && redirectId) {
          router.push(`/skills/${redirectId}`);
          return;
        }
        setSubmitState({
          kind: "error",
          message: data.error ?? "Submission failed. Please try again.",
        });
        return;
      }

      setSubmitState({ kind: "success", id: data.skill.id });
      router.push(`/skills/${data.skill.id}`);
    } catch {
      setSubmitState({
        kind: "error",
        message: "Network error. Please check your connection and try again.",
      });
    }
  }

  function renderRepoCard(repo: GitHubRepo) {
    const isThisLoading =
      submitState.kind === "loading" && submitState.repoId === repo.id;
    const owner = repo.full_name.split("/")[0];

    return (
      <button
        key={repo.id}
        type="button"
        disabled={isSubmitting}
        onClick={() => handleSelectRepo(repo)}
        className="group text-left"
      >
        <Card
          className={`h-full cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-zinc-600 ${
            isThisLoading ? "ring-2 ring-blue-500/60" : ""
          } ${isSubmitting && !isThisLoading ? "opacity-50" : ""}`}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isThisLoading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-400" />
              ) : (
                <Github className="h-4 w-4 shrink-0 text-zinc-400" />
              )}
              <span className="truncate font-bold text-zinc-50">
                {repo.name}
              </span>
            </CardTitle>
            <CardDescription>
              <span className="text-xs text-zinc-500">{owner}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {repo.description && (
              <p className="line-clamp-2 text-sm leading-relaxed text-zinc-400">
                {repo.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              {repo.private ? (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Lock className="h-3 w-3" />
                  Private
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Globe className="h-3 w-3" />
                  Public
                </Badge>
              )}

              {repo.has_skill_file && repo.skill_format === "claude_code" && (
                <Badge className="gap-1 bg-emerald-600/20 text-xs text-emerald-400 ring-1 ring-emerald-500/30">
                  <FileText className="h-3 w-3" />
                  SKILL.md
                </Badge>
              )}

              {repo.has_skill_file && repo.skill_format === "openclaw" && (
                <Badge className="gap-1 bg-emerald-600/20 text-xs text-emerald-400 ring-1 ring-emerald-500/30">
                  <Settings2 className="h-3 w-3" />
                  _meta.json
                </Badge>
              )}

              {repo.has_skill_file && repo.skill_format === null && (
                <Badge className="gap-1 bg-emerald-600/20 text-xs text-emerald-400 ring-1 ring-emerald-500/30">
                  <FileText className="h-3 w-3" />
                  Skill detected
                </Badge>
              )}

              {repo.language && <LanguageDot language={repo.language} />}
            </div>

            <p className="text-xs text-zinc-500">
              Updated {relativeTime(repo.updated_at)}
            </p>
          </CardContent>
        </Card>
      </button>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-black px-4 py-16">
      <div className="w-full max-w-5xl space-y-10">
        {/* Header */}
        <div className="space-y-3 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
            Submit a Skill for Benchmarking
          </h1>
          <p className="mx-auto max-w-lg text-base leading-relaxed text-zinc-400">
            Select a repository containing your skill definition. We&apos;ll
            clone it, detect the format, generate benchmark scenarios, run them
            in sandboxed containers, and produce a detailed performance score.
          </p>
        </div>

        {/* Submit error banner */}
        {submitState.kind === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {submitState.message}
          </div>
        )}

        {/* Repo picker */}
        {fetchState.kind === "loading" && (
          <div className="flex flex-col items-center justify-center gap-4 py-20">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            <p className="text-sm text-zinc-500">
              Loading your repositories...
            </p>
          </div>
        )}

        {fetchState.kind === "error" && (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-10">
              <AlertCircle className="h-10 w-10 text-red-400" />
              <p className="text-center text-sm text-zinc-400">
                {fetchState.message}
              </p>
              {fetchState.status === 401 && (
                <a
                  href="/api/auth/login"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 underline underline-offset-4 transition-colors hover:text-blue-300"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Re-login with GitHub
                </a>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setFetchState({ kind: "loading" });
                  fetch("/api/github/repos")
                    .then(async (res) => {
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        setFetchState({
                          kind: "error",
                          message:
                            data.error ??
                            `Failed to fetch repositories (${res.status})`,
                          status: res.status,
                        });
                        return;
                      }
                      const data = await res.json();
                      setFetchState({
                        kind: "success",
                        repos: data.repos ?? data,
                      });
                    })
                    .catch(() => {
                      setFetchState({
                        kind: "error",
                        message:
                          "Network error. Please check your connection and try again.",
                      });
                    });
                }}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        )}

        {fetchState.kind === "success" && (
          <div className="space-y-8">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                type="text"
                placeholder="Filter repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                aria-label="Filter repositories by name"
              />
            </div>

            {/* Repos with Skills */}
            {skillRepos.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-medium text-zinc-50">
                    Repos with Skills
                  </h2>
                  <Badge variant="secondary">{skillRepos.length}</Badge>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {skillRepos.map(renderRepoCard)}
                </div>
              </div>
            )}

            {/* All Repos */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-medium text-zinc-50">
                  {skillRepos.length > 0 ? "All Repos" : "Your Repositories"}
                </h2>
                <Badge variant="secondary">{otherRepos.length}</Badge>
              </div>
              {otherRepos.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {otherRepos.map(renderRepoCard)}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-zinc-500">
                  {searchQuery
                    ? "No repositories match your search."
                    : "No other repositories found."}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Manual URL fallback */}
        <div className="space-y-4 border-t border-zinc-800 pt-8">
          <h2 className="text-lg font-medium text-zinc-50">
            Or enter a URL manually
          </h2>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Github className="h-5 w-5" />
                GitHub Repository URL
              </CardTitle>
              <CardDescription>
                Paste a direct link to a repository containing your skill file
                (SKILL.md or _meta.json).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleManualSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Input
                    type="url"
                    placeholder="https://github.com/user/repo"
                    value={manualUrl}
                    onChange={(e) => {
                      setManualUrl(e.target.value);
                      if (submitState.kind === "error") {
                        setSubmitState({ kind: "idle" });
                      }
                    }}
                    disabled={isSubmitting}
                    aria-label="GitHub repository URL"
                    className="font-mono text-sm"
                  />
                  {manualUrl.length > 0 && !isManualValid && (
                    <p className="text-xs text-zinc-500">
                      Must be a valid GitHub URL (e.g.
                      https://github.com/owner/repo)
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting || !isManualValid}
                  className="w-full"
                >
                  {isSubmitting && !("repoId" in submitState) ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit for Benchmarking"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
