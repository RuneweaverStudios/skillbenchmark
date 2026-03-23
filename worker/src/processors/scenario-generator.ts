/**
 * AI-powered benchmark scenario generator.
 * Reads a skill definition and generates tailored benchmark scenarios
 * using Claude API to create relevant test cases.
 */

import { OpenRouterClient } from "../lib/openrouter.js";

export interface GeneratedScenario {
  readonly name: string;
  readonly description: string;
  readonly category: "token_efficiency" | "task_completion" | "quality_preservation" | "stress_test";
  readonly system_prompt: string;
  readonly user_prompt: string;
  readonly tools: readonly ToolDef[];
  readonly success_criteria: {
    readonly required_tool_calls?: number;
    readonly expected_output_contains?: readonly string[];
    readonly max_context_growth_factor?: number;
  };
  readonly expected_tool_calls: number;
  readonly max_turns: number;
}

interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

const SCENARIO_GENERATION_PROMPT = `You are a benchmark designer for AI agent skills. Given a skill definition, generate 4 benchmark scenarios that measure the skill's value proposition.

SKILL DEFINITION:
{skill_content}

SKILL FORMAT: {format}
SKILL NAME: {name}
SKILL DESCRIPTION: {description}

Generate exactly 4 scenarios (one per category). For each, produce a JSON object with:
1. name: Short snake_case identifier (e.g., "multi_turn_log_analysis")
2. description: What this scenario tests (1-2 sentences)
3. category: One of "token_efficiency", "task_completion", "quality_preservation", "stress_test"
4. system_prompt: The system message for the agent (realistic, related to the skill's domain)
5. user_prompt: The task to give the agent (specific, measurable)
6. tools: Array of tool definitions the agent can use. Each tool has:
   - name: tool function name
   - description: what it does
   - parameters: JSON Schema object for parameters
7. success_criteria: JSON with:
   - required_tool_calls: minimum expected tool calls
   - expected_output_contains: key phrases the final answer should include
   - max_context_growth_factor: maximum acceptable context growth (e.g., 3.0)
8. expected_tool_calls: estimated number of tool calls
9. max_turns: maximum turns (token_efficiency: 20, task_completion: 15, quality: 10, stress_test: 40)

IMPORTANT GUIDELINES:
- Scenarios MUST be relevant to what the skill actually does
- For token-efficiency skills: include tools that return large outputs (50KB+), recursive session dumps, large JSON
- For routing/orchestration skills: include tasks requiring model/task routing
- For code generation skills: include code quality and completion scenarios
- Tools should return realistic data sizes, not toy examples
- The stress test should have 20+ expected tool calls
- Each tool's parameters must be valid JSON Schema

Return ONLY a JSON array of 4 scenario objects. No markdown, no explanation.`;

export async function generateScenarios(params: {
  skillContent: string;
  skillName: string;
  skillDescription: string;
  skillFormat: string;
  openrouterApiKey: string;
  generationModel?: string;
}): Promise<readonly GeneratedScenario[]> {
  const client = new OpenRouterClient({ apiKey: params.openrouterApiKey });

  const prompt = SCENARIO_GENERATION_PROMPT
    .replace("{skill_content}", params.skillContent)
    .replace("{format}", params.skillFormat)
    .replace("{name}", params.skillName)
    .replace("{description}", params.skillDescription);

  const model = params.generationModel ?? "nvidia/nemotron-3-super-120b-a12b:free";

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await attemptGeneration(client, model, prompt);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`Scenario generation attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  throw lastError ?? new Error("Scenario generation failed after retries");
}

async function attemptGeneration(
  client: OpenRouterClient,
  model: string,
  prompt: string,
): Promise<readonly GeneratedScenario[]> {
  const response = await client.chatCompletion({
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 8192,
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from scenario generation model");
  }

  // Extract JSON array from response (handle potential markdown wrapping)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Could not find JSON array in scenario generation response");
  }

  const scenarios = JSON.parse(jsonMatch[0]) as GeneratedScenario[];

  // Validate structure
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("Invalid scenarios: expected non-empty array");
  }

  const validCategories = new Set([
    "token_efficiency",
    "task_completion",
    "quality_preservation",
    "stress_test",
  ]);

  for (const s of scenarios) {
    if (!s.name || !s.category || !s.user_prompt || !s.system_prompt) {
      throw new Error(`Invalid scenario: missing required fields in "${s.name}"`);
    }
    if (!validCategories.has(s.category)) {
      throw new Error(`Invalid category "${s.category}" in scenario "${s.name}"`);
    }
  }

  return Object.freeze(scenarios);
}
