/**
 * Claim-driven benchmark scenario generator.
 *
 * Two-phase approach:
 * 1. Extract the skill's specific claims from its content
 * 2. Generate scenarios that directly test each claim
 *
 * This ensures benchmarks are relevant to what the skill actually does,
 * not generic proxy metrics.
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

// ─── Phase 1: Extract claims ────────────────────────────────────────────

const CLAIM_EXTRACTION_PROMPT = `Analyze this skill definition and extract its specific, testable claims.

SKILL NAME: {name}
SKILL DESCRIPTION: {description}
SKILL CONTENT:
{skill_content}

Extract:
1. **Primary claims**: What does this skill say it does? Look for quantitative claims ("reduces by 90%", "faster", "more accurate") and qualitative claims ("routes through CLI", "compresses output", "improves code quality").
2. **Mechanism**: HOW does it achieve this? What tools/commands/patterns does it instruct the agent to use?
3. **Skill category**: One of:
   - "context_optimization" — reduces context window, compresses output, routes tools through CLI
   - "code_generation" — writes, reviews, or refactors code
   - "workflow" — orchestrates multi-step processes, routing, delegation
   - "knowledge" — provides domain expertise, documentation, rules
4. **Baseline behavior**: What would the agent do WITHOUT this skill? (e.g., "use native mcp__* tools directly" or "write code without style rules")
5. **Tools needed**: What tools must be available to test this skill? Include both the tools the skill redirects TO (e.g., bash) and the tools it redirects FROM (e.g., mcp__context7__query_docs).

Return ONLY a JSON object:
{
  "claims": ["claim 1", "claim 2", ...],
  "mechanism": "how it works",
  "category": "context_optimization|code_generation|workflow|knowledge",
  "baseline_behavior": "what happens without the skill",
  "required_tools": [{"name": "tool_name", "description": "what it does", "parameters": {...}}]
}`;

// ─── Phase 2: Generate scenarios from claims ────────────────────────────

const SCENARIO_GENERATION_PROMPT = `You are a benchmark designer. Generate exactly 4 test scenarios that PROVE OR DISPROVE the specific claims of this skill.

SKILL: {name}
SKILL DESCRIPTION: {description}
SKILL FORMAT: {format}

EXTRACTED CLAIMS:
{claims_json}

RULES FOR SCENARIO DESIGN:

1. **Each scenario tests a specific claim.** Map each scenario to one or more claims from the list above. The scenario should be designed so that if the claim is true, the skill-enhanced run will measurably outperform baseline.

2. **Tools must create a fair comparison:**
   - ALWAYS include a "bash" tool (name: "bash", params: {command: string}) — skills that route through CLI need this
   - Include the native/verbose alternatives that the skill claims to replace (e.g., mcp__context7__query_docs, mcp__web_reader__webReader)
   - The baseline (without skill) will use native tools and get verbose 8-12KB responses
   - The skill-enhanced run should route through bash/CLI for compact responses

3. **Tasks must require multiple tool calls** — single-call tasks don't show compounding effects:
   - token_efficiency: 5-8 tool calls minimum, task requires gathering info from multiple sources
   - task_completion: 3-5 tool calls, task has a concrete deliverable (code, config, plan)
   - quality_preservation: 3-5 tool calls, task requires synthesizing information into a coherent answer
   - stress_test: 10-15 tool calls, complex multi-step research task

4. **Success criteria must be specific:**
   - required_tool_calls: minimum tool calls needed to complete the task properly
   - expected_output_contains: 3-5 key phrases that a correct answer MUST include
   - These should be achievable by both baseline and skill-enhanced runs

5. **System prompts should be neutral** — don't coach the agent toward the skill's behavior. Both runs get the same system prompt. The ONLY difference is whether the skill content is appended.

6. **User prompts should be realistic tasks** that a developer would actually ask, not artificial benchmarks.

For each scenario, produce a JSON object with:
- name: snake_case identifier
- description: what claim this tests and how
- category: one of "token_efficiency", "task_completion", "quality_preservation", "stress_test"
- system_prompt: neutral system message (NO skill-specific instructions)
- user_prompt: realistic task requiring multiple tool calls
- tools: array of tool definitions (MUST include bash + native alternatives)
- success_criteria: {required_tool_calls, expected_output_contains, max_context_growth_factor}
- expected_tool_calls: estimated count
- max_turns: 15 for most, 25 for stress_test

Return ONLY a JSON array of 4 scenario objects. No markdown, no explanation.`;

// ─── Main ───────────────────────────────────────────────────────────────

export async function generateScenarios(params: {
  skillContent: string;
  skillName: string;
  skillDescription: string;
  skillFormat: string;
  openrouterApiKey: string;
  generationModel?: string;
}): Promise<readonly GeneratedScenario[]> {
  const client = new OpenRouterClient({ apiKey: params.openrouterApiKey });
  const model = params.generationModel ?? "z-ai/glm-4.7-flash";

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Phase 1: Extract claims
      console.log(`[scenario-gen] Phase 1: Extracting claims (attempt ${attempt + 1})...`);
      const claims = await extractClaims(client, model, params);
      console.log(`[scenario-gen] Found ${claims.claims.length} claims, category: ${claims.category}`);

      // Phase 2: Generate scenarios from claims
      console.log("[scenario-gen] Phase 2: Generating claim-driven scenarios...");
      const scenarios = await generateFromClaims(client, model, params, claims);
      console.log(`[scenario-gen] Generated ${scenarios.length} scenarios`);

      return scenarios;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[scenario-gen] Attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  throw lastError ?? new Error("Scenario generation failed after retries");
}

// ─── Phase 1 ────────────────────────────────────────────────────────────

interface ExtractedClaims {
  readonly claims: readonly string[];
  readonly mechanism: string;
  readonly category: string;
  readonly baseline_behavior: string;
  readonly required_tools: readonly ToolDef[];
}

async function extractClaims(
  client: OpenRouterClient,
  model: string,
  params: { skillContent: string; skillName: string; skillDescription: string }
): Promise<ExtractedClaims> {
  const prompt = CLAIM_EXTRACTION_PROMPT
    .replace("{skill_content}", params.skillContent)
    .replace("{name}", params.skillName)
    .replace("{description}", params.skillDescription);

  const response = await client.chatCompletion({
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 2000,
    temperature: 0,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from claim extraction");

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in claim extraction response");

  let parsed: ExtractedClaims;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("[scenario-gen] Failed to parse claim extraction JSON:");
    console.error(jsonMatch[0]);
    throw new Error(`Invalid claims JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed.claims) || parsed.claims.length === 0) {
    throw new Error("No claims extracted");
  }

  return parsed as ExtractedClaims;
}

// ─── Phase 2 ────────────────────────────────────────────────────────────

async function generateFromClaims(
  client: OpenRouterClient,
  model: string,
  params: { skillContent: string; skillName: string; skillDescription: string; skillFormat: string },
  claims: ExtractedClaims
): Promise<readonly GeneratedScenario[]> {
  const prompt = SCENARIO_GENERATION_PROMPT
    .replace("{name}", params.skillName)
    .replace("{description}", params.skillDescription)
    .replace("{format}", params.skillFormat)
    .replace("{claims_json}", JSON.stringify(claims, null, 2));

  const response = await client.chatCompletion({
    model,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 8192,
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from scenario generation");

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array in scenario generation response");

  let scenarios: GeneratedScenario[];
  try {
    scenarios = JSON.parse(jsonMatch[0]) as GeneratedScenario[];
  } catch (e) {
    console.error("[scenario-gen] Failed to parse LLM JSON:");
    console.error(jsonMatch[0]);
    throw new Error(`Invalid JSON from LLM: ${(e as Error).message}`);
  }

  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error("Invalid scenarios: expected non-empty array");
  }

  const validCategories = new Set([
    "token_efficiency", "task_completion", "quality_preservation", "stress_test",
  ]);

  for (const s of scenarios) {
    if (!s.name || !s.category || !s.user_prompt || !s.system_prompt) {
      throw new Error(`Invalid scenario: missing required fields in "${s.name}"`);
    }
    if (!validCategories.has(s.category)) {
      throw new Error(`Invalid category "${s.category}" in scenario "${s.name}"`);
    }
    // Ensure tools array exists and has bash
    if (!Array.isArray(s.tools) || s.tools.length === 0) {
      throw new Error(`Scenario "${s.name}" has no tools defined`);
    }
    if (!s.tools.some((t) => t.name === "bash")) {
      throw new Error(`Scenario "${s.name}" is missing the bash tool`);
    }
  }

  return Object.freeze(scenarios);
}
