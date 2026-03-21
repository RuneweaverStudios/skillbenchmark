// Agent loop types supported by the benchmark system
export const AGENT_LOOP_TYPES = ["hermes", "claude_api", "claude_cli"] as const;
export type AgentLoopType = (typeof AGENT_LOOP_TYPES)[number];

// Skill format detection
export const SKILL_FORMATS = ["claude_code", "openclaw"] as const;
export type SkillFormat = (typeof SKILL_FORMATS)[number];

// Skill processing pipeline statuses
export const SKILL_STATUSES = [
  "pending",
  "cloning",
  "parsing",
  "generating_scenarios",
  "benchmarking",
  "scoring",
  "completed",
  "failed",
] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

// Benchmark run statuses
export const RUN_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

// Benchmark scenario categories
export const SCENARIO_CATEGORIES = [
  "token_efficiency",
  "task_completion",
  "quality_preservation",
  "stress_test",
] as const;
export type ScenarioCategory = (typeof SCENARIO_CATEGORIES)[number];

// Models available via OpenRouter (must support tool calling)
export const BENCHMARK_MODELS = [
  {
    id: "anthropic/claude-opus-4-6",
    name: "Claude Opus 4.6",
    tier: "frontier" as const,
    supportsCliLoop: true,
  },
  {
    id: "openai/codex-5.2",
    name: "Codex 5.2",
    tier: "frontier" as const,
    supportsCliLoop: false,
  },
  {
    id: "minimax/minimax-m2.5",
    name: "MiniMax M2.5",
    tier: "budget" as const,
    supportsCliLoop: false,
  },
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    tier: "budget" as const,
    supportsCliLoop: false,
  },
] as const;

export type ModelConfig = (typeof BENCHMARK_MODELS)[number];

// Scoring weights
export const SCORING_WEIGHTS = {
  tokenEfficiency: 0.3,
  taskCompletion: 0.3,
  qualityPreservation: 0.25,
  latencyImpact: 0.15,
} as const;

// Rate limits
export const RATE_LIMITS = {
  submissionsPerDay: 3,
  maxBudgetPerSkill: 15, // USD
} as const;

// Docker sandbox constraints
export const SANDBOX_LIMITS = {
  memoryMb: 2048,
  cpus: 2,
  timeoutMs: 300_000,
  pidsLimit: 256,
  tmpfsSizeMb: 500,
} as const;

// GitHub URL validation pattern
export const GITHUB_URL_PATTERN =
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/.*)?$/;

export function parseGitHubUrl(url: string): {
  owner: string;
  repo: string;
  path?: string;
} | null {
  const match = url.match(
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/[^/]+\/(.+))?$/
  );
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    path: match[3],
  };
}
