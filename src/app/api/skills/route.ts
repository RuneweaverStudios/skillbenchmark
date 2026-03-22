import { createServerSupabase } from "@/lib/supabase/server";
import { GITHUB_URL_PATTERN, parseGitHubUrl } from "@/lib/constants";
import { enqueueSkillIntake } from "@/lib/queue/producers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 20)));
  const offset = (page - 1) * limit;
  const status = searchParams.get("status") ?? "completed";

  const supabase = await createServerSupabase();

  let query = supabase
    .from("skills")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;

  if (error) {
    // Table may not exist yet — return empty list instead of error
    console.warn("Skills query error:", error.message);
    return NextResponse.json({
      skills: [],
      total: 0,
      page,
      limit,
    });
  }

  return NextResponse.json({
    skills: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
}

export async function POST(request: Request) {
  const supabase = await createServerSupabase();

  // Verify auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const githubUrl = String(body.github_url ?? "").trim();

  // Validate URL
  if (!GITHUB_URL_PATTERN.test(githubUrl)) {
    return NextResponse.json(
      { error: "Invalid GitHub URL. Must be https://github.com/owner/repo" },
      { status: 400 }
    );
  }

  const parsed = parseGitHubUrl(githubUrl);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not parse GitHub URL" },
      { status: 400 }
    );
  }

  // Check for duplicate — only block if the same user has an active
  // benchmark for this URL that was created within the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("skills")
    .select("id, status")
    .eq("github_url", githubUrl)
    .eq("submitted_by", user.id)
    .in("status", ["pending", "cloning", "parsing", "generating_scenarios", "benchmarking"])
    .gte("created_at", oneHourAgo)
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: "This skill is already being benchmarked", id: existing[0].id },
      { status: 409 }
    );
  }

  // Check daily rate limit
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count: todayCount } = await supabase
    .from("skills")
    .select("id", { count: "exact", head: true })
    .eq("submitted_by", user.id)
    .gte("created_at", today.toISOString());

  if ((todayCount ?? 0) >= 3) {
    return NextResponse.json(
      { error: "Daily submission limit reached (3 per day)" },
      { status: 429 }
    );
  }

  // Create skill record
  const { data: skill, error } = await supabase
    .from("skills")
    .insert({
      submitted_by: user.id,
      github_url: githubUrl,
      repo_owner: parsed.owner,
      repo_name: parsed.repo,
      skill_path: parsed.path ?? null,
      format: "claude_code", // Will be detected during cloning
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create skill submission" },
      { status: 500 }
    );
  }

  // Enqueue job to clone, parse, and benchmark the skill
  try {
    await enqueueSkillIntake({
      skillId: skill.id,
      githubUrl: githubUrl,
      repoOwner: parsed.owner,
      repoName: parsed.repo,
      skillPath: parsed.path,
      userId: user.id,
    });
  } catch (queueError) {
    // Queue may not be running in dev — skill is still created
    console.warn("Failed to enqueue skill intake:", queueError);
  }

  return NextResponse.json({ skill }, { status: 201 });
}
