import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // Auth check with user's session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify ownership
  const { data: skill } = await supabase
    .from("skills")
    .select("id, submitted_by")
    .eq("id", id)
    .single();

  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  if (skill.submitted_by !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Use service role to bypass RLS for deletion
  const admin = createServiceSupabase();

  await admin.from("skill_activity_events").delete().eq("skill_id", id);

  const { data: runs } = await admin
    .from("benchmark_runs")
    .select("id")
    .eq("skill_id", id);

  if (runs && runs.length > 0) {
    const runIds = runs.map((r) => r.id);
    await admin.from("executions").delete().in("benchmark_run_id", runIds);
    await admin.from("scenarios").delete().in("benchmark_run_id", runIds);
    await admin.from("benchmark_runs").delete().eq("skill_id", id);
  }

  const { error } = await admin.from("skills").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
