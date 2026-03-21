import { createServerSupabase } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // Fetch skill
  const { data: skill, error: skillError } = await supabase
    .from("skills")
    .select("*")
    .eq("id", id)
    .single();

  if (skillError || !skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  // Fetch benchmark runs
  const { data: runs } = await supabase
    .from("benchmark_runs")
    .select("*")
    .eq("skill_id", id)
    .order("run_number", { ascending: false });

  // Fetch activity events in parallel with latest scenarios/executions
  const latestRun = runs?.[0];
  let scenarios: unknown[] = [];
  let executions: unknown[] = [];

  const eventsPromise = supabase
    .from("skill_activity_events")
    .select("*")
    .eq("skill_id", id)
    .order("created_at", { ascending: true });

  if (latestRun) {
    const [scenarioResult, executionResult, eventsResult] = await Promise.all([
      supabase
        .from("scenarios")
        .select("*")
        .eq("benchmark_run_id", latestRun.id),
      supabase
        .from("executions")
        .select("*")
        .eq("benchmark_run_id", latestRun.id)
        .order("model", { ascending: true }),
      eventsPromise,
    ]);

    scenarios = scenarioResult.data ?? [];
    executions = executionResult.data ?? [];

    return NextResponse.json({
      skill,
      runs: runs ?? [],
      latestScenarios: scenarios,
      latestExecutions: executions,
      events: eventsResult.data ?? [],
    });
  }

  const { data: events } = await eventsPromise;

  return NextResponse.json({
    skill,
    runs: runs ?? [],
    latestScenarios: scenarios,
    latestExecutions: executions,
    events: events ?? [],
  });
}
