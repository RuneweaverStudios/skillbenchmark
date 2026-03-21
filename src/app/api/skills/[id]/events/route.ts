import { createServerSupabase } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // Verify skill exists
  const { data: skill, error: skillError } = await supabase
    .from("skills")
    .select("id")
    .eq("id", id)
    .single();

  if (skillError || !skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  // Fetch activity events ordered oldest-first
  const { data: events, error: eventsError } = await supabase
    .from("skill_activity_events")
    .select("*")
    .eq("skill_id", id)
    .order("created_at", { ascending: true });

  if (eventsError) {
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }

  return NextResponse.json({ events: events ?? [] });
}
