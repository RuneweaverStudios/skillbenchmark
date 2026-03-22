import { createServerSupabase } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify skill exists and belongs to user
  const { data: skill } = await supabase
    .from("skills")
    .select("id, submitted_by, status")
    .eq("id", id)
    .single();

  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  if (skill.submitted_by !== user.id) {
    return NextResponse.json({ error: "Not your skill" }, { status: 403 });
  }

  if (
    ["pending", "cloning", "parsing", "generating_scenarios", "benchmarking"].includes(
      skill.status
    )
  ) {
    return NextResponse.json(
      { error: "Benchmark already in progress" },
      { status: 409 }
    );
  }

  // Reset skill status — worker polls for status="pending" automatically
  await supabase
    .from("skills")
    .update({ status: "pending", error_message: null })
    .eq("id", id);

  return NextResponse.json({ message: "Benchmark re-triggered" });
}
