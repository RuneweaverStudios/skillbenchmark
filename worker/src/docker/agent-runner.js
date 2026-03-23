#!/usr/bin/env node

/**
 * agent-runner.js
 *
 * Standalone agent loop that runs inside a Docker container.
 * Reads /benchmark/config.json, calls an OpenRouter model with tool-use,
 * executes bash tool calls, and writes /benchmark/output.json.
 *
 * ZERO external dependencies — Node.js built-ins only.
 */

"use strict";

const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_PATH = "/benchmark/config.json";
const OUTPUT_PATH = "/benchmark/output.json";
const WORKSPACE_DIR = "/tmp/workspace";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const BASH_EXEC_TIMEOUT_MS = 30_000;
const MAX_TOOL_OUTPUT_BYTES = 10_240; // 10 KB
const SIMULATED_RESPONSE_BYTES = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Estimate token count from a string (chars / 4). */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Truncate a string to maxBytes (UTF-8 safe-ish). */
function truncate(str, maxBytes) {
  if (Buffer.byteLength(str, "utf8") <= maxBytes) return str;
  const buf = Buffer.from(str, "utf8").subarray(0, maxBytes);
  // Decode back — may lose a partial char at the boundary, which is fine.
  return buf.toString("utf8") + "\n...[truncated]";
}

/** Calculate the p95 value from a sorted (ascending) array of numbers. */
function p95(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(idx, 0)];
}

/** Estimate total message tokens for the current conversation. */
function estimateMessagesTokens(messages) {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content);
    }
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(JSON.stringify(tc));
      }
    }
  }
  return total;
}

/** Write output.json — always succeeds (best-effort). */
function writeOutput(data) {
  try {
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    // Last resort: write to stderr so the container logs capture something.
    process.stderr.write(`Failed to write output.json: ${err.message}\n`);
  }
}

/** Build an error-state output object. */
function errorOutput(errorMessage, partialResult) {
  return {
    taskCompleted: false,
    totalTurns: partialResult?.totalTurns ?? 0,
    totalToolCalls: partialResult?.totalToolCalls ?? 0,
    totalPromptTokens: partialResult?.totalPromptTokens ?? 0,
    totalCompletionTokens: partialResult?.totalCompletionTokens ?? 0,
    totalCostUsd: 0,
    initialContextTokens: partialResult?.initialContextTokens ?? 0,
    finalContextTokens: partialResult?.finalContextTokens ?? 0,
    peakContextTokens: partialResult?.peakContextTokens ?? 0,
    avgTurnLatencyMs: partialResult?.avgTurnLatencyMs ?? 0,
    p95TurnLatencyMs: partialResult?.p95TurnLatencyMs ?? 0,
    turnMetrics: partialResult?.turnMetrics ?? [],
    finalAssistantMessage: partialResult?.finalAssistantMessage ?? null,
    error: errorMessage,
  };
}

/**
 * Validate task completion against success criteria.
 * If no criteria provided, falls back to "model stopped and produced output".
 */
function validateCompletion(finalMessage, totalToolCalls, criteria) {
  if (!finalMessage || finalMessage.length < 10) return false;

  if (!criteria) return true; // No criteria = any non-empty response is a pass

  // Check required_tool_calls
  if (criteria.required_tool_calls && totalToolCalls < criteria.required_tool_calls) {
    return false;
  }

  // Check expected_output_contains
  if (criteria.expected_output_contains && Array.isArray(criteria.expected_output_contains)) {
    const lower = finalMessage.toLowerCase();
    const matched = criteria.expected_output_contains.filter(
      (phrase) => lower.includes(phrase.toLowerCase())
    );
    // Require at least half of expected phrases to be present
    if (matched.length < Math.ceil(criteria.expected_output_contains.length / 2)) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// OpenRouter API call (native fetch)
// ---------------------------------------------------------------------------

async function callOpenRouter(apiKey, model, messages, tools) {
  const body = {
    model,
    messages,
    temperature: 0,
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.parameters || { type: "object", properties: {} },
      },
    }));
    body.tool_choice = "auto";
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://skillbenchmark.dev",
      "X-Title": "SkillBenchmark Agent Runner",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `OpenRouter API error ${response.status}: ${truncate(text, 1024)}`
    );
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

function executeBash(command) {
  try {
    // Ensure workspace exists
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    const stdout = execSync(command, {
      cwd: WORKSPACE_DIR,
      timeout: BASH_EXEC_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10 MB buffer, we truncate after
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return truncate(String(stdout ?? ""), MAX_TOOL_OUTPUT_BYTES);
  } catch (err) {
    // execSync throws on non-zero exit or timeout — capture what we can.
    const output = [
      err.stdout ? String(err.stdout) : "",
      err.stderr ? String(err.stderr) : "",
      err.message || "",
    ]
      .filter(Boolean)
      .join("\n");

    return truncate(output || "Command failed with no output", MAX_TOOL_OUTPUT_BYTES);
  }
}

/**
 * Simulated tool response that returns REALISTIC LARGE output for MCP/API tools.
 * This is critical for fair benchmarking — native MCP tools return verbose JSON
 * (5-20KB), and context-optimization skills prove their value by avoiding that bloat.
 * If we return 200 bytes here, the baseline looks artificially cheap.
 */
function executeSimulatedTool(toolName, args) {
  const lowerName = toolName.toLowerCase();

  // MCP-style tools return large verbose JSON (simulates real schema+data bloat)
  const isMcpTool = lowerName.startsWith("mcp__") || lowerName.startsWith("mcp_");
  const isDataTool = /query|search|fetch|read|list|get|find/.test(lowerName);

  let targetBytes;
  if (isMcpTool) {
    targetBytes = 8000 + Math.floor(Math.random() * 4000); // 8-12KB like real MCP responses
  } else if (isDataTool) {
    targetBytes = 4000 + Math.floor(Math.random() * 3000); // 4-7KB
  } else {
    targetBytes = 1000 + Math.floor(Math.random() * 1000); // 1-2KB
  }

  const items = [];
  const itemCount = Math.max(3, Math.floor(targetBytes / 300));

  for (let i = 0; i < itemCount; i++) {
    items.push({
      id: `result-${i}`,
      type: "document",
      title: `${toolName} result item ${i}`,
      content: `Detailed content from ${toolName} for query "${JSON.stringify(args).slice(0, 100)}". `.repeat(3) +
        `This includes relevant documentation, code examples, and configuration details that a developer would need. ` +
        `Section ${i}: Additional context and implementation notes for this specific result.`,
      metadata: {
        source: toolName,
        relevance_score: (0.95 - i * 0.05).toFixed(2),
        timestamp: new Date().toISOString(),
        schema_version: "v1",
        provider: lowerName.split("__")[1] || toolName,
        token_count: Math.floor(targetBytes / 4),
      },
    });
  }

  return JSON.stringify({ success: true, tool: toolName, results: items }, null, 2);
}

function executeTool(toolName, rawArgs) {
  let args;
  try {
    args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs ?? {};
  } catch {
    args = {};
  }

  if (toolName === "bash") {
    const command = args.command ?? "";
    if (!command) return "Error: no command provided";
    return executeBash(command);
  }

  return executeSimulatedTool(toolName, args);
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

async function run() {
  // ------ Read config ------
  let config;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    config = JSON.parse(raw);
  } catch (err) {
    writeOutput(errorOutput(`Failed to read config: ${err.message}`, null));
    process.exit(1);
  }

  const {
    model,
    systemPrompt,
    userPrompt,
    tools = [],
    skillContent = null,
    withSkill = false,
    maxTurns = 20,
    timeoutMs = 300_000,
    openrouterApiKey,
    successCriteria = null,
  } = config;

  if (!openrouterApiKey) {
    writeOutput(errorOutput("Missing openrouterApiKey in config", null));
    process.exit(1);
  }

  // ------ Build system prompt ------
  let fullSystemPrompt = systemPrompt || "";
  if (withSkill && skillContent) {
    fullSystemPrompt += "\n\n" + skillContent;
  }

  // ------ Prepare messages ------
  const messages = [];
  if (fullSystemPrompt) {
    messages.push({ role: "system", content: fullSystemPrompt });
  }
  messages.push({ role: "user", content: userPrompt || "" });

  // ------ Tracking state ------
  const result = {
    taskCompleted: false,
    totalTurns: 0,
    totalToolCalls: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCostUsd: 0,
    initialContextTokens: estimateMessagesTokens(messages),
    finalContextTokens: 0,
    peakContextTokens: 0,
    avgTurnLatencyMs: 0,
    p95TurnLatencyMs: 0,
    turnMetrics: [],
    finalAssistantMessage: null,
    error: null,
  };

  result.peakContextTokens = result.initialContextTokens;

  // Ensure workspace exists before the loop starts.
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  // ------ Global timeout ------
  let timedOut = false;
  const globalTimer = setTimeout(() => {
    timedOut = true;
  }, timeoutMs);

  // ------ Agent loop ------
  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      if (timedOut) {
        result.error = `Global timeout exceeded (${timeoutMs}ms)`;
        break;
      }

      const turnStart = Date.now();

      // Call the model
      const completion = await callOpenRouter(
        openrouterApiKey,
        model,
        messages,
        tools
      );

      const turnLatencyMs = Date.now() - turnStart;

      // Extract usage from response
      const usage = completion.usage || {};
      const promptTokens = usage.prompt_tokens || estimateMessagesTokens(messages);
      const completionTokens = usage.completion_tokens || 0;

      result.totalPromptTokens += promptTokens;
      result.totalCompletionTokens += completionTokens;
      result.totalTurns += 1;

      // Track context size
      const currentContextTokens = estimateMessagesTokens(messages) + completionTokens;
      if (currentContextTokens > result.peakContextTokens) {
        result.peakContextTokens = currentContextTokens;
      }

      const choice = completion.choices?.[0];
      if (!choice) {
        result.error = "No choices returned from model";
        break;
      }

      const assistantMessage = choice.message;
      if (!assistantMessage) {
        result.error = "No message in choice";
        break;
      }

      // Append the assistant message to conversation history
      messages.push(assistantMessage);

      // Record turn metric (without tool info yet — added below if applicable)
      const turnMetric = {
        turn: turn + 1,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        latency_ms: turnLatencyMs,
        tool_calls: [],
      };

      // Check for tool calls
      const toolCalls = assistantMessage.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          if (timedOut) break;

          const toolName = tc.function?.name ?? "unknown";
          const toolArgs = tc.function?.arguments ?? "{}";

          const toolResult = executeTool(toolName, toolArgs);

          result.totalToolCalls += 1;

          turnMetric.tool_calls.push({
            tool_name: toolName,
            tool_result_size: Buffer.byteLength(toolResult, "utf8"),
          });

          // Append tool result to conversation
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolResult,
          });
        }
      } else {
        // No tool calls — model is done
        result.finalAssistantMessage =
          typeof assistantMessage.content === "string"
            ? assistantMessage.content
            : JSON.stringify(assistantMessage.content);
        // Validate against success criteria if provided
        result.taskCompleted = validateCompletion(
          result.finalAssistantMessage,
          result.totalToolCalls,
          successCriteria
        );
        result.turnMetrics.push(turnMetric);
        break;
      }

      result.turnMetrics.push(turnMetric);
    }

    // If we exhausted maxTurns without a stop
    if (!result.taskCompleted && !result.error) {
      result.error = `Reached max turns (${maxTurns}) without completion`;
      // Capture the last assistant message anyway
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (lastAssistant) {
        result.finalAssistantMessage =
          typeof lastAssistant.content === "string"
            ? lastAssistant.content
            : JSON.stringify(lastAssistant.content);
      }
    }
  } catch (err) {
    result.error = err.message || String(err);
  } finally {
    clearTimeout(globalTimer);
  }

  // ------ Compute final stats ------
  result.finalContextTokens = estimateMessagesTokens(messages);
  if (result.finalContextTokens > result.peakContextTokens) {
    result.peakContextTokens = result.finalContextTokens;
  }

  const latencies = result.turnMetrics.map((t) => t.latency_ms);
  result.avgTurnLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;
  result.p95TurnLatencyMs = p95(latencies);

  // ------ Write output ------
  writeOutput(result);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

run().catch((err) => {
  writeOutput(errorOutput(err.message || String(err), null));
  process.exit(1);
});
