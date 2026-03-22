"use client";

import { Button } from "@/components/ui/button";
import { RotateCcw, Wrench, ExternalLink } from "lucide-react";

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
  githubUrl,
  overallScore,
  tokenEfficiencyScore,
  taskCompletionScore,
  qualityScore,
  latencyScore,
}: BenchmarkActionsProps) {
  const handleRestart = async () => {
    if (!confirm("Restart this benchmark from scratch?")) return;
    await fetch(`/api/skills/${skillId}/restart`, { method: "POST" });
    window.location.reload();
  };

  const issueUrl = `${githubUrl}/issues/new?title=SkillBenchmark%3A%20Improvement%20suggestions&body=Score%3A%20${overallScore}%2F100%0A%0AToken%20Efficiency%3A%20${tokenEfficiencyScore}%0ATask%20Completion%3A%20${taskCompletionScore}%0AQuality%3A%20${qualityScore}%0ALatency%3A%20${latencyScore}`;

  return (
    <div className="flex flex-wrap gap-3 pt-2">
      <Button variant="outline" size="sm" onClick={handleRestart}>
        <RotateCcw className="mr-1.5 size-4" />
        Re-benchmark
      </Button>
      <a href={issueUrl} target="_blank" rel="noopener noreferrer">
        <Button variant="outline" size="sm">
          <Wrench className="mr-1.5 size-4" />
          Fix Issues & Re-benchmark
          <ExternalLink className="ml-1.5 size-3" />
        </Button>
      </a>
    </div>
  );
}
