import { createServerSupabase } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: skill } = await supabase
    .from("skills")
    .select("id, name, display_name, description, overall_score, format, repo_owner, repo_name, status")
    .eq("id", id)
    .single();

  if (!skill) return NextResponse.json({ error: "Skill not found" }, { status: 404 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const shareUrl = `${appUrl}/skills/${skill.id}`;
  const title = skill.display_name ?? skill.name ?? `${skill.repo_owner}/${skill.repo_name}`;
  const scoreText = skill.overall_score != null ? ` — Score: ${skill.overall_score.toFixed(1)}/100` : "";
  const shareText = `Check out "${title}" on SkillBenchmark${scoreText}`;

  return NextResponse.json({
    url: shareUrl,
    title,
    text: shareText,
    score: skill.overall_score,
  });
}
