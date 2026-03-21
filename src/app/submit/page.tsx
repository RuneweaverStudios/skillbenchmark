"use client";

import { useState } from "react";
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
  Loader2,
  FileText,
  Settings2,
  AlertCircle,
} from "lucide-react";

type SubmitState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "success"; id: string };

export default function SubmitPage() {
  const router = useRouter();
  const [githubUrl, setGithubUrl] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  const isValidUrl = GITHUB_URL_PATTERN.test(githubUrl.trim());
  const isLoading = submitState.kind === "loading";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedUrl = githubUrl.trim();
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

  return (
    <div className="flex flex-1 flex-col items-center bg-black px-4 py-16">
      <div className="w-full max-w-2xl space-y-10">
        {/* Header */}
        <div className="space-y-3 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
            Submit a Skill for Benchmarking
          </h1>
          <p className="mx-auto max-w-lg text-base leading-relaxed text-zinc-400">
            Provide a GitHub repository URL containing your skill definition.
            We&apos;ll clone it, detect the format, generate benchmark
            scenarios, run them in sandboxed containers, and produce a detailed
            performance score.
          </p>
        </div>

        {/* Submission Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              GitHub Repository
            </CardTitle>
            <CardDescription>
              Enter the URL of the repository that contains your skill file
              (SKILL.md or _meta.json).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Input
                  type="url"
                  placeholder="https://github.com/user/repo"
                  value={githubUrl}
                  onChange={(e) => {
                    setGithubUrl(e.target.value);
                    if (submitState.kind === "error") {
                      setSubmitState({ kind: "idle" });
                    }
                  }}
                  disabled={isLoading}
                  aria-label="GitHub repository URL"
                  className="font-mono text-sm"
                />
                {githubUrl.length > 0 && !isValidUrl && (
                  <p className="text-xs text-zinc-500">
                    Must be a valid GitHub URL (e.g.
                    https://github.com/owner/repo)
                  </p>
                )}
              </div>

              {submitState.kind === "error" && (
                <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {submitState.message}
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading || !isValidUrl}
                className="w-full"
              >
                {isLoading ? (
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

        {/* Supported Formats */}
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-zinc-50">
            Supported Formats
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-400" />
                  Claude Code
                  <Badge variant="secondary">SKILL.md</Badge>
                </CardTitle>
                <CardDescription>
                  The native Claude Code skill format
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-zinc-400">
                  A Markdown file defining the skill&apos;s name, description,
                  instructions, tool hooks, and triggers. Place a{" "}
                  <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                    SKILL.md
                  </code>{" "}
                  file at the root of your repository or inside a{" "}
                  <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                    .claude/
                  </code>{" "}
                  directory.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-emerald-400" />
                  OpenClaw
                  <Badge variant="secondary">_meta.json</Badge>
                </CardTitle>
                <CardDescription>
                  The OpenClaw registry format
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-zinc-400">
                  A JSON manifest describing the skill&apos;s metadata, tools,
                  permissions, and configuration. Include a{" "}
                  <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                    _meta.json
                  </code>{" "}
                  file at the repository root alongside any referenced skill
                  files.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
