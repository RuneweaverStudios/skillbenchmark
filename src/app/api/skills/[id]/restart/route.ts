import { createServerSupabase } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // Verify auth
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch skill
  const { data: skill } = await supabase
    .from("skills")
    .select("id, submitted_by, status")
    .eq("id", id)
    .single();

  if (!skill) return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  if (skill.submitted_by !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Can only restart completed or failed skills
  if (skill.status !== "completed" && skill.status !== "failed") {
    return NextResponse.json({ error: "Can only restart completed or failed benchmarks" }, { status: 400 });
  }

  // Reset skill status and clear old scores — worker picks up status="pending"
  const { error } = await supabase
    .from("skills")
    .update({
      status: "pending",
      error_message: null,
      overall_score: null,
      token_efficiency_score: null,
      task_completion_score: null,
      quality_preservation_score: null,
      latency_impact_score: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Failed to restart" }, { status: 500 });

  // Clear old activity events
  await supabase
    .from("skill_activity_events")
    .delete()
    .eq("skill_id", id);

  // Add restart event
  await supabase.from("skill_activity_events").insert({
    skill_id: id,
    event_type: "info",
    stage: "pending",
    message: "Benchmark restarted by user",
    metadata: {},
  });

  return NextResponse.json({ success: true });
}
