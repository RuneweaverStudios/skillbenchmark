/**
 * OpenRouter API client for multi-model agent loops.
 * All benchmark models are accessed through OpenRouter's unified API.
 */

interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | readonly ContentBlock[] | null;
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly ToolCall[];
}

interface ContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  readonly tool_use_id?: string;
  readonly content?: string;
}

interface ToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

interface OpenRouterTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface CompletionResponse {
  readonly id: string;
  readonly choices: readonly {
    readonly message: {
      readonly role: string;
      readonly content: string | null;
      readonly tool_calls?: readonly ToolCall[];
    };
    readonly finish_reason: string;
  }[];
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

export interface OpenRouterConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: OpenRouterConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://openrouter.ai/api/v1";
  }

  async chatCompletion(params: {
    model: string;
    messages: readonly ChatMessage[];
    tools?: readonly OpenRouterTool[];
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<CompletionResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      params.timeoutMs ?? 60_000
    );

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://skillbenchmark.dev",
          "X-Title": "SkillBenchmark",
        },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          tools: params.tools,
          max_tokens: params.maxTokens ?? 4096,
          temperature: params.temperature ?? 0,
          tool_choice: params.tools ? "auto" : undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenRouter API error ${response.status}: ${errorText}`
        );
      }

      return response.json() as Promise<CompletionResponse>;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("OpenRouter API request timed out after 60s");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
