/**
 * Claude API Agent Loop — Uses OpenRouter with Claude's native
 * tool_use/tool_result format. Structurally similar to Hermes loop
 * but uses Anthropic's tool calling conventions.
 */

import { OpenRouterClient } from "../lib/openrouter.js";
import { contextSize, estimateTokens, mean, p95 } from "../lib/token-counter.js";
import type {
  AgentLoop,
  AgentLoopConfig,
  AgentLoopResult,
  TurnMetric,
  ToolHandler,
} from "./types.js";

export class ClaudeApiLoop implements AgentLoop {
  private readonly toolHandler: ToolHandler;

  constructor(toolHandler: ToolHandler) {
    this.toolHandler = toolHandler;
  }

  async run(config: AgentLoopConfig): Promise<AgentLoopResult> {
    const client = new OpenRouterClient({ apiKey: config.openrouterApiKey });
    const turnMetrics: TurnMetric[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalToolCalls = 0;
    let peakContextTokens = 0;
    let finalMessage = "";
    let error: string | null = null;

    const systemPrompt = config.withSkill && config.skillContent
      ? `${config.systemPrompt}\n\n---\n\n# Skill Instructions\n\n${config.skillContent}`
      : config.systemPrompt;

    // Claude API uses the same OpenAI-compatible format via OpenRouter
    const messages: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
      tool_call_id?: string;
    }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: config.userPrompt },
    ];

    const tools = config.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const initialContextTokens = estimateTokens(
      JSON.stringify(messages) + JSON.stringify(tools)
    );

    const deadline = Date.now() + config.timeoutMs;

    for (let turn = 0; turn < config.maxTurns; turn++) {
      if (Date.now() > deadline) {
        error = "Timeout exceeded";
        break;
      }

      const turnStart = Date.now();

      try {
        const response = await client.chatCompletion({
          model: config.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
        });

        const choice = response.choices[0];
        if (!choice) {
          error = "No response from model";
          break;
        }

        totalPromptTokens += response.usage.prompt_tokens;
        totalCompletionTokens += response.usage.completion_tokens;

        const currentContext = estimateTokens(JSON.stringify(messages));
        peakContextTokens = Math.max(peakContextTokens, currentContext);

        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
          messages.push({
            role: "assistant",
            content: choice.message.content,
            tool_calls: [...choice.message.tool_calls],
          });

          for (const toolCall of choice.message.tool_calls) {
            totalToolCalls++;
            const args = JSON.parse(toolCall.function.arguments);
            const rawResult = await this.toolHandler(
              toolCall.function.name,
              args
            );

            messages.push({
              role: "tool",
              content: rawResult,
              tool_call_id: toolCall.id,
            });

            turnMetrics.push({
              turnNumber: turn,
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              contextChars: contextSize(messages),
              latencyMs: Date.now() - turnStart,
              costUsd: 0,
              toolName: toolCall.function.name,
              toolResultRawSize: rawResult.length,
              toolResultFilteredSize: rawResult.length,
            });
          }
        } else {
          finalMessage = choice.message.content ?? "";
          messages.push({ role: "assistant", content: finalMessage });

          turnMetrics.push({
            turnNumber: turn,
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            contextChars: contextSize(messages),
            latencyMs: Date.now() - turnStart,
            costUsd: 0,
            toolName: null,
            toolResultRawSize: 0,
            toolResultFilteredSize: 0,
          });

          if (choice.finish_reason === "stop") break;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        break;
      }
    }

    const latencies = turnMetrics.map((t) => t.latencyMs);
    const finalContextTokens = estimateTokens(JSON.stringify(messages));

    return Object.freeze({
      taskCompleted: error === null && finalMessage.length > 0,
      totalTurns: turnMetrics.length,
      totalToolCalls,
      totalPromptTokens,
      totalCompletionTokens,
      totalCostUsd: 0,
      initialContextTokens,
      finalContextTokens,
      peakContextTokens: Math.max(peakContextTokens, finalContextTokens),
      avgTurnLatencyMs: Math.round(mean(latencies)),
      p95TurnLatencyMs: Math.round(p95(latencies)),
      turnMetrics,
      finalAssistantMessage: finalMessage,
      error,
    });
  }
}
