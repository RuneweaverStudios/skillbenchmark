/**
 * Worker runner — polls Supabase for pending skills and processes them
 * through the benchmark pipeline.
 *
 * No Redis/BullMQ required. The `skills` table IS the job queue.
 */

import { createClient } from "@supabase/supabase-js";
import { processBenchmarkJob, type BenchmarkJob, type JobCallbacks } from "./index.js";

// ─── Config ──────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const POLL_INTERVAL_MS = 5_000;

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

// ─── Polling loop ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForJobs(): Promise<void> {
  console.log("Worker started — polling Supabase for pending skills...");

  while (true) {
    try {
      // Atomically claim a pending skill by updating its status to "cloning"
      // This prevents multiple workers from grabbing the same job
      const { data: pending } = await supabase
        .from("skills")
        .select("id, github_url, repo_owner, repo_name, skill_path")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1);

      if (!pending || pending.length === 0) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const skill = pending[0];
      console.log(`[${skill.id}] Picked up job for ${skill.repo_owner}/${skill.repo_name}`);

      try {
        await processBenchmarkJob(
          {
            skillId: skill.id,
            githubUrl: skill.github_url,
            repoOwner: skill.repo_owner,
            repoName: skill.repo_name,
            skillPath: skill.skill_path ?? undefined,
          },
          callbacks,
          { openrouterApiKey: OPENROUTER_API_KEY }
        );
        console.log(`[${skill.id}] Job completed successfully`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[${skill.id}] Job failed:`, message);

        // Mark as failed so it doesn't get retried infinitely
        await supabase
          .from("skills")
          .update({
            status: "failed",
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", skill.id);

        await supabase.from("skill_activity_events").insert({
          skill_id: skill.id,
          event_type: "error",
          stage: "failed",
          message: `Benchmark failed: ${message}`,
          metadata: {},
        });
      }
    } catch (err) {
      // Poll loop error — log and continue
      console.error("Poll error:", err instanceof Error ? err.message : err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

pollForJobs();
