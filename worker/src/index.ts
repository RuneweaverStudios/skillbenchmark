/**
 * Worker entry point — processes benchmark jobs from the queue.
 *
 * Pipeline: clone → generate scenarios → execute benchmarks → score
 *
 * Each stage updates the skill status in the database and progresses
 * to the next stage upon completion.
 */

import { cloneAndParse } from "./processors/clone.js";
import { generateScenarios } from "./processors/scenario-generator.js";
import { runBenchmarks, type BenchmarkScenario } from "./processors/benchmark-runner.js";
import { computeScores } from "./processors/scorer.js";

export interface BenchmarkJob {
  readonly skillId: string;
  readonly githubUrl: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly skillPath?: string;
}

export interface JobCallbacks {
  updateSkillStatus: (
    skillId: string,
    status: string,
    data?: Record<string, unknown>
  ) => Promise<void>;
  createBenchmarkRun: (
    skillId: string,
    triggeredBy?: string
  ) => Promise<string>;
  createScenarios: (
    skillId: string,
    runId: string,
    scenarios: readonly {
      name: string;
      description: string;
      category: string;
      system_prompt: string;
      user_prompt: string;
      tools_json: unknown;
      success_criteria: unknown;
      expected_tool_calls: number;
      max_turns: number;
      generation_model: string;
    }[]
  ) => Promise<readonly { id: string; name: string }[]>;
  saveExecutionResults: (
    runId: string,
    results: readonly {
      scenarioId: string;
      model: string;
      agentLoop: string;
      withSkill: boolean;
      result: Record<string, unknown>;
    }[]
  ) => Promise<void>;
  updateSkillScores: (
    skillId: string,
    scores: Record<string, number>
  ) => Promise<void>;
  emitActivityEvent: (
    skillId: string,
    event: {
      event_type: 'status_change' | 'progress' | 'info' | 'error';
      stage: string;
      message: string;
      metadata?: Record<string, unknown>;
    }
  ) => Promise<void>;
}

/**
 * Process a complete benchmark job end-to-end.
 */
export async function processBenchmarkJob(
  job: BenchmarkJob,
  callbacks: JobCallbacks,
  env: { openrouterApiKey: string }
): Promise<void> {
  const { skillId } = job;

  try {
    // Stage 1: Clone and parse
    await callbacks.updateSkillStatus(skillId, "cloning");
    await callbacks.emitActivityEvent(skillId, { event_type: 'status_change', stage: 'cloning', message: 'Cloning repository from GitHub...' });
    const cloneResult = await cloneAndParse({
      githubUrl: job.githubUrl,
      repoOwner: job.repoOwner,
      repoName: job.repoName,
      skillPath: job.skillPath,
    });
    await callbacks.emitActivityEvent(skillId, { event_type: 'info', stage: 'cloning', message: 'Repository cloned successfully' });

    await callbacks.updateSkillStatus(skillId, "parsing", {
      format: cloneResult.format,
      name: cloneResult.name,
      description: cloneResult.description,
      display_name: cloneResult.displayName,
      version: cloneResult.version,
      author: cloneResult.author,
      tags: cloneResult.tags,
      raw_skill_content: cloneResult.rawContent,
      skill_path: cloneResult.skillPath,
      commit_sha: cloneResult.commitSha,
    });
    await callbacks.emitActivityEvent(skillId, { event_type: 'status_change', stage: 'parsing', message: 'Parsing skill definition...' });
    await callbacks.emitActivityEvent(skillId, { event_type: 'info', stage: 'parsing', message: `Detected ${cloneResult.format === 'claude_code' ? 'SKILL.md' : '_meta.json'} format — ${cloneResult.name ?? 'unnamed skill'}` });

    // Stage 2: Generate scenarios
    await callbacks.updateSkillStatus(skillId, "generating_scenarios");
    await callbacks.emitActivityEvent(skillId, { event_type: 'status_change', stage: 'generating_scenarios', message: 'Generating benchmark scenarios with AI...' });
    const scenarios = await generateScenarios({
      skillContent: cloneResult.rawContent,
      skillName: cloneResult.name,
      skillDescription: cloneResult.description,
      skillFormat: cloneResult.format,
      openrouterApiKey: env.openrouterApiKey,
    });
    await callbacks.emitActivityEvent(skillId, { event_type: 'info', stage: 'generating_scenarios', message: `Generated ${scenarios.length} test scenarios`, metadata: { scenario_count: scenarios.length, categories: scenarios.map(s => s.category) } });

    // Create benchmark run and scenarios in DB
    const runId = await callbacks.createBenchmarkRun(skillId);
    const savedScenarios = await callbacks.createScenarios(
      skillId,
      runId,
      scenarios.map((s) => ({
        name: s.name,
        description: s.description,
        category: s.category,
        system_prompt: s.system_prompt,
        user_prompt: s.user_prompt,
        tools_json: s.tools,
        success_criteria: s.success_criteria,
        expected_tool_calls: s.expected_tool_calls,
        max_turns: s.max_turns,
        generation_model: "anthropic/claude-sonnet-4-6",
      }))
    );
    await callbacks.emitActivityEvent(skillId, { event_type: 'info', stage: 'generating_scenarios', message: 'Scenarios saved, preparing benchmark matrix...' });

    // Stage 3: Execute benchmarks
    await callbacks.updateSkillStatus(skillId, "benchmarking");
    await callbacks.emitActivityEvent(skillId, { event_type: 'status_change', stage: 'benchmarking', message: 'Starting benchmark execution matrix...' });

    const benchmarkScenarios: BenchmarkScenario[] = scenarios.map((s, i) => ({
      id: savedScenarios[i].id,
      name: s.name,
      category: s.category,
      systemPrompt: s.system_prompt,
      userPrompt: s.user_prompt,
      tools: s.tools,
      maxTurns: s.max_turns,
    }));

    const results = await runBenchmarks({
      scenarios: benchmarkScenarios,
      skillContent: cloneResult.rawContent,
      openrouterApiKey: env.openrouterApiKey,
      concurrency: 4,
      onProgress: async (completed, total) => {
        console.log(`[${skillId}] Benchmark progress: ${completed}/${total}`);
        if (completed === 1 || completed === total || completed % 5 === 0) {
          await callbacks.emitActivityEvent(skillId, {
            event_type: 'progress',
            stage: 'benchmarking',
            message: `Benchmark execution ${completed}/${total} complete`,
            metadata: { completed, total },
          });
        }
      },
    });

    // Save execution results
    await callbacks.saveExecutionResults(
      runId,
      results.map((r) => ({
        scenarioId: r.scenarioId,
        model: r.model,
        agentLoop: r.agentLoop,
        withSkill: r.withSkill,
        result: r.result as unknown as Record<string, unknown>,
      }))
    );
    await callbacks.emitActivityEvent(skillId, { event_type: 'info', stage: 'benchmarking', message: 'All benchmark executions complete, results saved' });

    // Stage 4: Score
    await callbacks.updateSkillStatus(skillId, "scoring");
    await callbacks.emitActivityEvent(skillId, { event_type: 'status_change', stage: 'scoring', message: 'Computing final scores...' });
    const scores = await computeScores(results, env.openrouterApiKey);
    await callbacks.emitActivityEvent(skillId, { event_type: 'info', stage: 'scoring', message: `Scoring complete — overall: ${scores.overall.toFixed(1)}`, metadata: { overall: scores.overall, tokenEfficiency: scores.tokenEfficiency, taskCompletion: scores.taskCompletion } });

    await callbacks.updateSkillScores(skillId, {
      overall_score: scores.overall,
      token_efficiency_score: scores.tokenEfficiency,
      task_completion_score: scores.taskCompletion,
      quality_preservation_score: scores.qualityPreservation,
      latency_impact_score: scores.latencyImpact,
    });

    await callbacks.updateSkillStatus(skillId, "completed");
    await callbacks.emitActivityEvent(skillId, { event_type: 'status_change', stage: 'completed', message: 'Benchmark pipeline complete!' });
    console.log(`[${skillId}] Benchmark complete. Overall score: ${scores.overall}`);
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error(`[${skillId}] Benchmark failed: ${errorMsg}`);
    await callbacks.emitActivityEvent(skillId, { event_type: 'error', stage: 'failed', message: `Pipeline failed: ${errorMsg}` });
    await callbacks.updateSkillStatus(skillId, "failed", {
      error_message: errorMsg,
    });
  }
}
