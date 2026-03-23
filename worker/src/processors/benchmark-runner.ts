/**
 * Benchmark execution orchestrator.
 *
 * Runs each benchmark in an isolated Docker container with real bash execution.
 * The container receives config via mounted JSON, runs an actual agent loop
 * with real tool execution, and writes results to output.json.
 */

import {
  runBenchmarkContainer,
  ensureImageBuilt,
  type ContainerResult,
} from "../docker/container-manager.js";
import type { AgentLoopResult, TurnMetric } from "../agent-loops/types.js";

// ─── Config ─────────────────────────────────────────────────────────────

const BENCHMARK_MODELS = [
  { id: "z-ai/glm-4.7-flash", supportsCliLoop: false },
];

const DOCKER_IMAGE = "skillbench-runner:latest";

// ─── Types ──────────────────────────────────────────────────────────────

export interface BenchmarkScenario {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly tools: readonly {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
  readonly maxTurns: number;
}

export interface ExecutionResult {
  readonly scenarioId: string;
  readonly model: string;
  readonly agentLoop: "hermes" | "claude_api" | "claude_cli";
  readonly withSkill: boolean;
  readonly result: AgentLoopResult;
}

// ─── Main ───────────────────────────────────────────────────────────────

/**
 * Run all benchmark executions for a skill using Docker containers.
 * Each execution runs in an isolated container with real bash.
 */
export async function runBenchmarks(params: {
  scenarios: readonly BenchmarkScenario[];
  skillContent: string;
  openrouterApiKey: string;
  concurrency?: number;
  timeoutMs?: number;
  onProgress?: (completed: number, total: number) => void;
}): Promise<readonly ExecutionResult[]> {
  const {
    scenarios,
    skillContent,
    openrouterApiKey,
    concurrency = 2,
    timeoutMs = 300_000,
  } = params;

  // Ensure the Docker image is built before starting benchmarks
  await ensureImageBuilt("", DOCKER_IMAGE);

  // Build execution matrix: scenario × model × with/without skill
  const jobs: ExecutionJob[] = [];

  for (const scenario of scenarios) {
    for (const model of BENCHMARK_MODELS) {
      for (const withSkill of [true, false]) {
        jobs.push({ scenario, model: model.id, withSkill });
      }

      // Claude CLI loop for models that support it
      if (model.supportsCliLoop) {
        for (const withSkill of [true, false]) {
          jobs.push({ scenario, model: model.id, withSkill, cliLoop: true });
        }
      }
    }
  }

  const total = jobs.length;
  let completed = 0;
  const results: ExecutionResult[] = [];

  // Execute with concurrency limit
  const executing = new Set<Promise<void>>();

  for (const job of jobs) {
    const promise = (async () => {
      const label = `${job.scenario.name} [${job.withSkill ? "skill" : "baseline"}]`;
      console.log(`[benchmark] Starting container: ${label}`);

      const containerResult = await runBenchmarkContainer({
        image: DOCKER_IMAGE,
        model: job.model,
        systemPrompt: job.scenario.systemPrompt,
        userPrompt: job.scenario.userPrompt,
        tools: job.scenario.tools,
        skillContent: job.withSkill ? skillContent : null,
        withSkill: job.withSkill,
        maxTurns: job.scenario.maxTurns,
        timeoutMs,
        openrouterApiKey,
      });

      const agentResult = containerResultToAgentResult(containerResult);

      results.push({
        scenarioId: job.scenario.id,
        model: job.model,
        agentLoop: job.cliLoop ? "claude_cli" : "hermes",
        withSkill: job.withSkill,
        result: agentResult,
      });

      completed++;
      const status = agentResult.error
        ? `failed: ${agentResult.error}`
        : `done (${agentResult.totalTurns} turns, ${agentResult.totalPromptTokens + agentResult.totalCompletionTokens} tokens)`;
      console.log(`[benchmark] ${completed}/${total} ${label} — ${status}`);
      params.onProgress?.(completed, total);
    })();

    executing.add(promise);
    promise.finally(() => executing.delete(promise));

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);

  return Object.freeze(results);
}

// ─── Helpers ────────────────────────────────────────────────────────────

interface ExecutionJob {
  readonly scenario: BenchmarkScenario;
  readonly model: string;
  readonly withSkill: boolean;
  readonly cliLoop?: boolean;
}

/** Map ContainerResult to AgentLoopResult for compatibility with scorer */
function containerResultToAgentResult(cr: ContainerResult): AgentLoopResult {
  const turnMetrics: TurnMetric[] = (cr.turnMetrics as unknown[]).map(
    (t: unknown) => {
      const raw = t as Record<string, unknown>;
      return {
        turnNumber: Number(raw.turn ?? raw.turnNumber ?? 0),
        promptTokens: Number(raw.prompt_tokens ?? raw.promptTokens ?? 0),
        completionTokens: Number(raw.completion_tokens ?? raw.completionTokens ?? 0),
        contextChars: Number(raw.contextChars ?? 0),
        latencyMs: Number(raw.latency_ms ?? raw.latencyMs ?? 0),
        costUsd: Number(raw.costUsd ?? 0),
        toolName: (raw.tool_calls as unknown[])?.length > 0
          ? String((raw.tool_calls as Record<string, unknown>[])[0]?.tool_name ?? null)
          : null,
        toolResultRawSize: Number(raw.tool_result_size ?? raw.toolResultRawSize ?? 0),
        toolResultFilteredSize: Number(raw.tool_result_size ?? raw.toolResultFilteredSize ?? 0),
      };
    }
  );

  return Object.freeze({
    taskCompleted: cr.taskCompleted,
    totalTurns: cr.totalTurns,
    totalToolCalls: cr.totalToolCalls,
    totalPromptTokens: cr.totalPromptTokens,
    totalCompletionTokens: cr.totalCompletionTokens,
    totalCostUsd: cr.totalCostUsd,
    initialContextTokens: cr.initialContextTokens,
    finalContextTokens: cr.finalContextTokens,
    peakContextTokens: cr.peakContextTokens,
    avgTurnLatencyMs: cr.avgTurnLatencyMs,
    p95TurnLatencyMs: cr.p95TurnLatencyMs,
    turnMetrics,
    finalAssistantMessage: cr.finalAssistantMessage,
    error: cr.error,
  });
}
