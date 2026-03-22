"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RotateCcw, Wrench, Loader2 } from "lucide-react";

interface BenchmarkActionsProps {
  readonly skillId: string;
  readonly githubUrl: string;
  readonly overallScore: number | null;
  readonly tokenEfficiencyScore: number | null;
  readonly taskCompletionScore: number | null;
  readonly qualityScore: number | null;
  readonly latencyScore: number | null;
}

export function BenchmarkActions({
  skillId,
  overallScore,
}: BenchmarkActionsProps) {
  const router = useRouter();
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  const handleRestart = async () => {
    if (!confirm("Restart this benchmark from scratch?")) return;
    setRestarting(true);
    try {
      await fetch(`/api/skills/${skillId}/restart`, { method: "POST" });
      window.location.reload();
    } finally {
      setRestarting(false);
    }
  };

  const handleFix = async () => {
    const confirmed = confirm(
      `This will:\n` +
        `1. Use AI to generate an improved version of your skill\n` +
        `2. Push it to a new branch on your repo\n` +
        `3. Benchmark the improved version\n\n` +
        `Current score: ${overallScore}/100\n\n` +
        `Continue?`
    );
    if (!confirmed) return;

    setFixing(true);
    setFixError(null);

    try {
      const res = await fetch(`/api/skills/${skillId}/fix`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        setFixError(data.error ?? "Failed to generate improvements");
        return;
      }

      // Redirect to the new skill's benchmark page
      router.push(`/skills/${data.newSkillId}`);
    } catch {
      setFixError("Network error — please try again");
    } finally {
      setFixing(false);
    }
  };

  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRestart}
          disabled={restarting || fixing}
        >
          {restarting ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-1.5 size-4" />
          )}
          Re-benchmark
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleFix}
          disabled={fixing || restarting}
        >
          {fixing ? (
            <>
              <Loader2 className="mr-1.5 size-4 animate-spin" />
              Generating improvements...
            </>
          ) : (
            <>
              <Wrench className="mr-1.5 size-4" />
              Fix Issues &amp; Re-benchmark
            </>
          )}
        </Button>
      </div>
      {fixError && (
        <p className="text-xs text-red-400">{fixError}</p>
      )}
    </div>
  );
}
