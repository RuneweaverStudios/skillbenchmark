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
 *
 * Output size varies by tool type to simulate real-world behavior:
 * - Native MCP tools (mcp__*, query, search, fetch, read): large verbose JSON
 * - CLI/bash tools (bash, exec, run, shell, command): compact output
 * - Other tools: medium output
 *
 * This is critical for skills that route tool calls through compact CLIs
 * (e.g., dietmcp) — their value shows up as smaller tool results.
 */
function createToolHandler(): ToolHandler {
  let callCount = 0;

  return async (name: string, args: Record<string, unknown>): Promise<string> => {
    callCount++;
    const lowerName = name.toLowerCase();
    const argsStr = JSON.stringify(args).toLowerCase();

    // Detect tool type by name and arguments
    const isCompactTool = isCompactToolCall(lowerName, argsStr);
    const isVerboseTool = isVerboseToolCall(lowerName, argsStr);

    // Compact tools: ~200-500 chars (CLI output, compressed results)
    // Verbose tools: ~2000-8000 chars (full MCP JSON, raw API responses)
    // Default tools: ~500-2000 chars
    let baseSize: number;
    if (isCompactTool) {
      baseSize = 200;
    } else if (isVerboseTool) {
      baseSize = 2000;
    } else {
      baseSize = 500;
    }

    // Progressive growth to simulate context accumulation
    const growthFactor = Math.min(callCount * 0.3, 5);
    const targetSize = Math.floor(baseSize * (1 + growthFactor));

    if (isCompactTool) {
      return generateCompactOutput(name, args, callCount, targetSize);
    }

    const result: Record<string, unknown> = {
      tool: name,
      call_number: callCount,
      args,
      timestamp: new Date().toISOString(),
      data: generateVerboseData(name, targetSize),
    };

    return JSON.stringify(result, null, isVerboseTool ? 2 : 0);
  };
}

/** CLI/bash tools, exec commands, compact routers */
function isCompactToolCall(name: string, argsStr: string): boolean {
  // Direct CLI tool names
  if (/\b(bash|shell|exec|run_command|terminal|command)\b/.test(name)) return true;
  // Tool args that suggest CLI routing (e.g., "dietmcp exec", "npx", "curl")
  if (/\b(dietmcp|npx|curl|cli|pipe)\b/.test(argsStr)) return true;
  return false;
}

/** Native MCP tools, large data fetchers, API responses */
function isVerboseToolCall(name: string, _argsStr: string): boolean {
  // Native MCP tool naming convention
  if (name.startsWith("mcp__") || name.startsWith("mcp_")) return true;
  // Common verbose tool patterns
  if (/\b(query|search|fetch|read_file|get_contents|list_|find_|api_call)\b/.test(name)) return true;
  return false;
}

/** Compact CLI-style output */
function generateCompactOutput(
  name: string,
  args: Record<string, unknown>,
  callNumber: number,
  targetSize: number
): string {
  // Simulate concise CLI output (like dietmcp exec produces)
  const lines: string[] = [];
  const lineCount = Math.max(2, Math.floor(targetSize / 80));

  lines.push(`$ ${name} ${Object.values(args).join(" ")}`.slice(0, 120));
  for (let i = 0; i < lineCount - 1; i++) {
    lines.push(`  result_${i}: item-${callNumber}-${i} [ok]`);
  }

  return lines.join("\n");
}

/** Verbose MCP/API-style JSON output */
function generateVerboseData(toolName: string, targetSize: number): unknown {
  const items: Record<string, unknown>[] = [];
  const itemCount = Math.max(1, Math.floor(targetSize / 200));

  for (let i = 0; i < itemCount; i++) {
    items.push({
      id: `item-${i}`,
      name: `${toolName}-result-${i}`,
      type: "resource",
      status: i % 3 === 0 ? "error" : "ok",
      details: `Result from ${toolName} call, item ${i}. `.repeat(3),
      content: `Full content block ${i} with detailed information about the resource returned by ${toolName}.`.repeat(2),
      metadata: {
        timestamp: new Date().toISOString(),
        source: toolName,
        index: i,
        schema_version: "1.0",
        provider: toolName.split("_")[0],
      },
    });
  }

  return items;
}
