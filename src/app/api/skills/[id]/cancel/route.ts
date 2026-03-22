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

  // Verify ownership
  const { data: skill } = await supabase
    .from("skills")
    .select("id, status, submitted_by")
    .eq("id", id)
    .single();

  if (!skill) return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  if (skill.submitted_by !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Can only cancel in-progress skills
  const cancelable = ["pending", "cloning", "parsing", "generating_scenarios", "benchmarking", "scoring"];
  if (!cancelable.includes(skill.status)) {
    return NextResponse.json({ error: "Skill is not in progress" }, { status: 400 });
  }

  // Update status to failed with cancellation message
  const { error } = await supabase
    .from("skills")
    .update({ status: "failed", error_message: "Cancelled by user", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });

  // Add activity event
  await supabase.from("skill_activity_events").insert({
    skill_id: id,
    event_type: "error",
    stage: "failed",
    message: "Benchmark cancelled by user",
    metadata: {},
  });

  return NextResponse.json({ success: true });
}
