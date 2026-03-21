"use client";

import useSWR from "swr";
import type { SkillDetailResponse } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const IN_PROGRESS_STATUSES = new Set([
  "pending",
  "cloning",
  "parsing",
  "generating_scenarios",
  "benchmarking",
  "scoring",
]);

/**
 * Poll skill benchmark status. Refreshes every 3s while in progress,
 * stops polling when completed or failed.
 */
export function useBenchmarkStatus(skillId: string) {
  return useSWR<SkillDetailResponse>(
    `/api/skills/${skillId}`,
    fetcher,
    {
      refreshInterval: (data) => {
        if (!data?.skill) return 3000;
        if (IN_PROGRESS_STATUSES.has(data.skill.status)) return 3000;
        return 0; // Stop polling when done
      },
      revalidateOnFocus: true,
    }
  );
}

/**
 * Get human-readable status label and progress percentage.
 */
export function getStatusInfo(status: string): {
  label: string;
  progress: number;
  color: string;
} {
  switch (status) {
    case "pending":
      return { label: "Queued", progress: 5, color: "text-yellow-500" };
    case "cloning":
      return { label: "Cloning Repository", progress: 15, color: "text-blue-500" };
    case "parsing":
      return { label: "Parsing Skill", progress: 25, color: "text-blue-500" };
    case "generating_scenarios":
      return { label: "Generating Benchmarks", progress: 40, color: "text-purple-500" };
    case "benchmarking":
      return { label: "Running Benchmarks", progress: 65, color: "text-orange-500" };
    case "scoring":
      return { label: "Computing Scores", progress: 90, color: "text-cyan-500" };
    case "completed":
      return { label: "Complete", progress: 100, color: "text-green-500" };
    case "failed":
      return { label: "Failed", progress: 0, color: "text-red-500" };
    default:
      return { label: status, progress: 0, color: "text-muted-foreground" };
  }
}
