/**
 * Claude CLI Agent Loop — The most realistic benchmark for Claude Code skills.
 *
 * Inspired by the divideandconquer benchmark approach:
 *   WITH skill:    claude -p --output-format json --permission-mode plan
 *                  --append-system-prompt "<SKILL.md content>" "<prompt>"
 *   WITHOUT skill: claude -p --output-format json --permission-mode plan
 *                  --bare --disable-slash-commands "<prompt>"
 *
 * Uses --permission-mode plan to measure PLANNING quality without building
 * full codebases (which would take hours per run).
 */

import { spawn } from "child_process";
import { estimateTokens } from "../lib/token-counter.js";
import type {
  AgentLoop,
  AgentLoopConfig,
  AgentLoopResult,
  TurnMetric,
} from "./types.js";

export class ClaudeCliLoop implements AgentLoop {
  async run(config: AgentLoopConfig): Promise<AgentLoopResult> {
    const startTime = Date.now();
    let error: string | null = null;
    let output = "";
    let parsedOutput: CliOutput | null = null;

    try {
      // Build command arguments
      const args = [
        "-p", // Non-interactive prompt mode
        "--output-format", "json",
        "--permission-mode", "plan",
        "--model", config.model,
      ];

      if (config.withSkill && config.skillContent) {
        // Inject skill via --append-system-prompt
        args.push("--append-system-prompt", config.skillContent);
      } else {
        // Clean baseline: no skills, no slash commands
        args.push("--bare", "--disable-slash-commands");
      }

      // Add the actual prompt
      args.push(config.userPrompt);

      output = await executeClaudeCli(args, config.timeoutMs);
      parsedOutput = parseCliOutput(output);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const wallTimeMs = Date.now() - startTime;
    const outputTokens = estimateTokens(output);

    // Build a single turn metric from the CLI execution
    const turnMetric: TurnMetric = {
      turnNumber: 0,
      promptTokens: parsedOutput?.usage?.prompt_tokens ?? estimateTokens(config.userPrompt),
      completionTokens: parsedOutput?.usage?.completion_tokens ?? outputTokens,
      contextChars: output.length,
      latencyMs: wallTimeMs,
      costUsd: parsedOutput?.usage?.cost_usd ?? 0,
      toolName: null,
      toolResultRawSize: 0,
      toolResultFilteredSize: 0,
    };

    const promptTokens = turnMetric.promptTokens;
    const completionTokens = turnMetric.completionTokens;

    return Object.freeze({
      taskCompleted: error === null && output.length > 0,
      totalTurns: 1,
      totalToolCalls: parsedOutput?.tool_calls ?? 0,
      totalPromptTokens: promptTokens,
      totalCompletionTokens: completionTokens,
      totalCostUsd: turnMetric.costUsd,
      initialContextTokens: promptTokens,
      finalContextTokens: promptTokens + completionTokens,
      peakContextTokens: promptTokens + completionTokens,
      avgTurnLatencyMs: wallTimeMs,
      p95TurnLatencyMs: wallTimeMs,
      turnMetrics: [turnMetric],
      finalAssistantMessage: parsedOutput?.result ?? output,
      error,
    });
  }
}

interface CliOutput {
  readonly result: string;
  readonly tool_calls: number;
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly cost_usd: number;
  } | null;
}

function parseCliOutput(raw: string): CliOutput {
  try {
    const parsed = JSON.parse(raw);
    return {
      result: parsed.result ?? parsed.content ?? raw,
      tool_calls: parsed.num_turns ?? 0,
      usage: parsed.usage
        ? {
            prompt_tokens: parsed.usage.input_tokens ?? 0,
            completion_tokens: parsed.usage.output_tokens ?? 0,
            cost_usd: parsed.cost_usd ?? 0,
          }
        : null,
    };
  } catch {
    return { result: raw, tool_calls: 0, usage: null };
  }
}

function executeClaudeCli(
  args: readonly string[],
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });
  });
}
