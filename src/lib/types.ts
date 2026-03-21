import type {
  AgentLoopType,
  RunStatus,
  ScenarioCategory,
  SkillFormat,
  SkillStatus,
} from "./constants";

// ─── Skill ──────────────────────────────────────────────────────────────

export interface Skill {
  readonly id: string;
  readonly submitted_by: string;
  readonly github_url: string;
  readonly repo_owner: string;
  readonly repo_name: string;
  readonly branch: string;
  readonly skill_path: string | null;
  readonly format: SkillFormat;
  readonly status: SkillStatus;
  readonly error_message: string | null;

  // Parsed metadata
  readonly name: string | null;
  readonly display_name: string | null;
  readonly description: string | null;
  readonly version: string | null;
  readonly author: string | null;
  readonly tags: readonly string[];
  readonly raw_skill_content: string | null;

  // Scores
  readonly overall_score: number | null;
  readonly token_efficiency_score: number | null;
  readonly task_completion_score: number | null;
  readonly quality_preservation_score: number | null;
  readonly latency_impact_score: number | null;

  readonly commit_sha: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// ─── Benchmark Run ──────────────────────────────────────────────────────

export interface BenchmarkRun {
  readonly id: string;
  readonly skill_id: string;
  readonly run_number: number;
  readonly status: RunStatus;
  readonly triggered_by: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly error_message: string | null;
  readonly total_scenarios: number;
  readonly completed_scenarios: number;
  readonly total_executions: number;
  readonly completed_executions: number;
  readonly created_at: string;
}

// ─── Scenario ───────────────────────────────────────────────────────────

export interface Scenario {
  readonly id: string;
  readonly skill_id: string;
  readonly benchmark_run_id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ScenarioCategory;
  readonly system_prompt: string;
  readonly user_prompt: string;
  readonly tools_json: readonly ToolDefinition[];
  readonly success_criteria: SuccessCriteria;
  readonly expected_tool_calls: number | null;
  readonly max_turns: number;
  readonly generation_model: string;
  readonly generation_prompt: string | null;
  readonly created_at: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface SuccessCriteria {
  readonly required_tool_calls?: number;
  readonly expected_output_contains?: readonly string[];
  readonly max_context_growth_factor?: number;
}

// ─── Execution ──────────────────────────────────────────────────────────

export interface Execution {
  readonly id: string;
  readonly scenario_id: string;
  readonly benchmark_run_id: string;
  readonly model: string;
  readonly agent_loop: AgentLoopType;
  readonly with_skill: boolean;
  readonly status: RunStatus;
  readonly container_id: string | null;
  readonly docker_image: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly wall_time_ms: number | null;
  readonly total_prompt_tokens: number | null;
  readonly total_completion_tokens: number | null;
  readonly total_tokens: number | null;
  readonly total_cost_usd: number | null;
  readonly task_completed: boolean | null;
  readonly completion_quality: number | null;
  readonly total_tool_calls: number | null;
  readonly total_turns: number | null;
  readonly initial_context_tokens: number | null;
  readonly final_context_tokens: number | null;
  readonly peak_context_tokens: number | null;
  readonly avg_turn_latency_ms: number | null;
  readonly p95_turn_latency_ms: number | null;
  readonly error_message: string | null;
  readonly created_at: string;
}

// ─── Turn Metrics ───────────────────────────────────────────────────────

export interface TurnMetric {
  readonly id: string;
  readonly execution_id: string;
  readonly turn_number: number;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly context_chars: number;
  readonly latency_ms: number;
  readonly cost_usd: number | null;
  readonly tool_name: string | null;
  readonly tool_result_raw_size: number | null;
  readonly tool_result_filtered_size: number | null;
  readonly created_at: string;
}

// ─── Activity Events ────────────────────────────────────────────────────

export interface ActivityEvent {
  readonly id: string;
  readonly skill_id: string;
  readonly event_type: 'status_change' | 'progress' | 'info' | 'error';
  readonly stage: string;
  readonly message: string;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
}

// ─── Leaderboard Entry ─────────────────────────────────────────────────

export interface LeaderboardEntry {
  readonly skill_id: string;
  readonly name: string;
  readonly display_name: string | null;
  readonly format: SkillFormat;
  readonly github_url: string;
  readonly description: string | null;
  readonly author: string | null;
  readonly tags: readonly string[];
  readonly overall_score: number;
  readonly token_efficiency_score: number | null;
  readonly task_completion_score: number | null;
  readonly quality_preservation_score: number | null;
  readonly latency_impact_score: number | null;
  readonly submitted_by: string;
  readonly avatar_url: string | null;
  readonly total_runs: number;
  readonly last_benchmarked_at: string;
  readonly rank: number;
}

// ─── Profile ────────────────────────────────────────────────────────────

export interface Profile {
  readonly id: string;
  readonly github_username: string;
  readonly avatar_url: string | null;
  readonly display_name: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// ─── Skill Parser ───────────────────────────────────────────────────────

export interface ParsedSkill {
  readonly format: SkillFormat;
  readonly name: string;
  readonly displayName: string | null;
  readonly description: string;
  readonly version: string | null;
  readonly author: string | null;
  readonly tags: readonly string[];
  readonly rawContent: string;
  readonly tools: readonly ToolDefinition[];
  readonly triggers: readonly string[];
  readonly hooks: Record<string, unknown> | null;
}

// ─── API Request/Response ───────────────────────────────────────────────

export interface SubmitSkillRequest {
  readonly github_url: string;
}

export interface SkillListResponse {
  readonly skills: readonly Skill[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface SkillDetailResponse {
  readonly skill: Skill;
  readonly runs: readonly BenchmarkRun[];
  readonly latestScenarios: readonly Scenario[];
  readonly latestExecutions: readonly Execution[];
  readonly events: readonly ActivityEvent[];
}
