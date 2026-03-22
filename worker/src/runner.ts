/**
 * Worker runner — consumes jobs from the BullMQ queue and processes them
 * through the benchmark pipeline.
 */

import { Worker, type Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { processBenchmarkJob, type BenchmarkJob, type JobCallbacks } from "./index.js";

// ─── Config ──────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const QUEUE_NAME = "skill-intake";

function parseRedisConnection() {
  try {
    const parsed = new URL(REDIS_URL);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      username: parsed.username || undefined,
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

// ─── Supabase service client ────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Callbacks ──────────────────────────────────────────────────────────

const callbacks: JobCallbacks = {
  async updateSkillStatus(skillId, status, data) {
    const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (data) Object.assign(update, data);

    const { error } = await supabase
      .from("skills")
      .update(update)
      .eq("id", skillId);

    if (error) console.error(`[${skillId}] Failed to update status:`, error.message);
  },

  async createBenchmarkRun(skillId, triggeredBy) {
    // Get next run number
    const { data: existing } = await supabase
      .from("benchmark_runs")
      .select("run_number")
      .eq("skill_id", skillId)
      .order("run_number", { ascending: false })
      .limit(1);

    const runNumber = (existing?.[0]?.run_number ?? 0) + 1;

    const { data, error } = await supabase
      .from("benchmark_runs")
      .insert({
        skill_id: skillId,
        run_number: runNumber,
        status: "running",
        triggered_by: triggeredBy ?? null,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create benchmark run: ${error.message}`);
    return data.id;
  },

  async createScenarios(skillId, runId, scenarios) {
    const rows = scenarios.map((s) => ({
      skill_id: skillId,
      benchmark_run_id: runId,
      name: s.name,
      description: s.description,
      category: s.category,
      system_prompt: s.system_prompt,
      user_prompt: s.user_prompt,
      tools_json: s.tools_json,
      success_criteria: s.success_criteria,
      expected_tool_calls: s.expected_tool_calls,
      max_turns: s.max_turns,
      generation_model: s.generation_model,
    }));

    const { data, error } = await supabase
      .from("scenarios")
      .insert(rows)
      .select("id, name");

    if (error) throw new Error(`Failed to create scenarios: ${error.message}`);
    return data;
  },

  async saveExecutionResults(runId, results) {
    const rows = results.map((r) => {
      const res = r.result as Record<string, unknown>;
      return {
        benchmark_run_id: runId,
        scenario_id: r.scenarioId,
        model: r.model,
        agent_loop: r.agentLoop,
        with_skill: r.withSkill,
        status: res.error ? "failed" : "completed",
        task_completed: res.taskCompleted ?? false,
        total_turns: res.totalTurns ?? 0,
        total_tool_calls: res.totalToolCalls ?? 0,
        total_prompt_tokens: res.totalPromptTokens ?? 0,
        total_completion_tokens: res.totalCompletionTokens ?? 0,
        total_tokens: (res.totalPromptTokens as number ?? 0) + (res.totalCompletionTokens as number ?? 0),
        total_cost_usd: res.totalCostUsd ?? 0,
        initial_context_tokens: res.initialContextTokens ?? 0,
        final_context_tokens: res.finalContextTokens ?? 0,
        peak_context_tokens: res.peakContextTokens ?? 0,
        avg_turn_latency_ms: res.avgTurnLatencyMs ?? 0,
        p95_turn_latency_ms: res.p95TurnLatencyMs ?? 0,
        error_message: res.error ?? null,
      };
    });

    const { error } = await supabase.from("executions").insert(rows);
    if (error) console.error(`Failed to save executions:`, error.message);
  },

  async updateSkillScores(skillId, scores) {
    const { error } = await supabase
      .from("skills")
      .update({ ...scores, updated_at: new Date().toISOString() })
      .eq("id", skillId);

    if (error) console.error(`[${skillId}] Failed to update scores:`, error.message);
  },

  async emitActivityEvent(skillId, event) {
    const { error } = await supabase.from("skill_activity_events").insert({
      skill_id: skillId,
      event_type: event.event_type,
      stage: event.stage,
      message: event.message,
      metadata: event.metadata ?? {},
    });

    if (error) console.error(`[${skillId}] Failed to emit event:`, error.message);
  },
};

// ─── Worker ─────────────────────────────────────────────────────────────

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    const data = job.data as BenchmarkJob & { userId?: string };
    console.log(`[${data.skillId}] Processing job ${job.id}...`);

    await processBenchmarkJob(
      {
        skillId: data.skillId,
        githubUrl: data.githubUrl,
        repoOwner: data.repoOwner,
        repoName: data.repoName,
        skillPath: data.skillPath,
      },
      callbacks,
      { openrouterApiKey: OPENROUTER_API_KEY }
    );
  },
  {
    connection: parseRedisConnection(),
    concurrency: 1,
  }
);

worker.on("completed", (job) => {
  console.log(`[${job.data.skillId}] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[${job?.data?.skillId}] Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("Worker error:", err.message);
});

console.log(`Worker listening on queue "${QUEUE_NAME}"...`);
