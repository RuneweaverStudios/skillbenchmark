/**
 * Benchmark execution orchestrator.
 * Manages the full benchmark pipeline: scenarios × models × agent loops × with/without skill.
 * Coordinates parallel execution with rate limiting.
 */

import { HermesLoop } from "../agent-loops/hermes-loop.js";
import { ClaudeApiLoop } from "../agent-loops/claude-loop.js";
import { ClaudeCliLoop } from "../agent-loops/claude-cli-loop.js";
import type { AgentLoop, AgentLoopConfig, AgentLoopResult, ToolHandler } from "../agent-loops/types.js";

// Models to benchmark against (via OpenRouter)
// Free tier: Nemotron 70B (free on OpenRouter)
// Pro tier: Claude Opus, Codex, MiniMax, Kimi
const BENCHMARK_MODELS = [
  { id: "z-ai/glm-4.7-flash", supportsCliLoop: false },
];

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

/**
 * Run all benchmark executions for a skill.
 * Returns results for every (scenario, model, agent_loop, with/without) combination.
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
    concurrency = 4,
    timeoutMs = 300_000,
  } = params;

  // Build execution matrix
  const jobs: ExecutionJob[] = [];

  for (const scenario of scenarios) {
    for (const model of BENCHMARK_MODELS) {
      // Hermes loop for all models (OpenAI-compatible tool calling)
      for (const withSkill of [true, false]) {
        jobs.push({ scenario, model: model.id, loopType: "hermes", withSkill });
      }

      // Claude CLI only for models that support it
      if (model.supportsCliLoop) {
        for (const withSkill of [true, false]) {
          jobs.push({
            scenario,
            model: model.id,
            loopType: "claude_cli",
            withSkill,
          });
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
      const label = `${job.scenario.name} [${job.withSkill ? "with skill" : "baseline"}]`;
      console.log(`[benchmark] Starting: ${label}`);
      // Each job gets its own tool handler so callCount is isolated
      const toolHandler = createToolHandler();
      const result = await executeJob(job, {
        skillContent,
        openrouterApiKey,
        timeoutMs,
        toolHandler,
      });
      results.push(result);
      completed++;
      const status = result.result.error ? `failed: ${result.result.error}` : "done";
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

interface ExecutionJob {
  readonly scenario: BenchmarkScenario;
  readonly model: string;
  readonly loopType: "hermes" | "claude_api" | "claude_cli";
  readonly withSkill: boolean;
}

async function executeJob(
  job: ExecutionJob,
  ctx: {
    skillContent: string;
    openrouterApiKey: string;
    timeoutMs: number;
    toolHandler: ToolHandler;
  }
): Promise<ExecutionResult> {
  const loop = createLoop(job.loopType, ctx.toolHandler);

  const config: AgentLoopConfig = {
    model: job.model,
    systemPrompt: job.scenario.systemPrompt,
    userPrompt: job.scenario.userPrompt,
    tools: job.scenario.tools,
    maxTurns: job.scenario.maxTurns,
    skillContent: job.withSkill ? ctx.skillContent : null,
    withSkill: job.withSkill,
    openrouterApiKey: ctx.openrouterApiKey,
    timeoutMs: ctx.timeoutMs,
  };

  let result: AgentLoopResult;
  try {
    result = await loop.run(config);
  } catch (e) {
    result = {
      taskCompleted: false,
      totalTurns: 0,
      totalToolCalls: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCostUsd: 0,
      initialContextTokens: 0,
      finalContextTokens: 0,
      peakContextTokens: 0,
      avgTurnLatencyMs: 0,
      p95TurnLatencyMs: 0,
      turnMetrics: [],
      finalAssistantMessage: "",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return {
    scenarioId: job.scenario.id,
    model: job.model,
    agentLoop: job.loopType,
    withSkill: job.withSkill,
    result,
  };
}

function createLoop(
  type: "hermes" | "claude_api" | "claude_cli",
  toolHandler: ToolHandler
): AgentLoop {
  switch (type) {
    case "hermes":
      return new HermesLoop(toolHandler);
    case "claude_api":
      return new ClaudeApiLoop(toolHandler);
    case "claude_cli":
      return new ClaudeCliLoop();
  }
}

/**
 * Create a simulated tool handler that returns realistic output.
 * Tool outputs grow progressively to simulate real-world context accumulation.
 */
function createToolHandler(): ToolHandler {
  let callCount = 0;

  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    callCount++;

    // Generate progressively larger outputs to test context management
    const baseSize = 500;
    const growthFactor = Math.min(callCount * 0.5, 10);
    const targetSize = Math.floor(baseSize * (1 + growthFactor));

    const result: Record<string, unknown> = {
      tool: name,
      call_number: callCount,
      args,
      timestamp: new Date().toISOString(),
      data: generateRealisticData(name, targetSize),
    };

    return JSON.stringify(result, null, 2);
  };
}

function generateRealisticData(toolName: string, targetSize: number): unknown {
  // Generate data that resembles real tool output
  const items: Record<string, unknown>[] = [];
  const itemCount = Math.max(1, Math.floor(targetSize / 200));

  for (let i = 0; i < itemCount; i++) {
    items.push({
      id: `item-${i}`,
      name: `${toolName}-result-${i}`,
      status: i % 3 === 0 ? "error" : "ok",
      details: `Result from ${toolName} call, item ${i}. `.repeat(3),
      metadata: {
        timestamp: new Date().toISOString(),
        source: toolName,
        index: i,
      },
    });
  }

  return items;
}
