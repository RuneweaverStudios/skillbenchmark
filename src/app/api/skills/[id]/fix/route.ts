/**
 * Fix & Re-benchmark API
 *
 * Flow:
 * 1. Read skill content + benchmark scores
 * 2. Use LLM to generate improved skill content
 * 3. Create GitHub branch + push improved file
 * 4. Insert new skill record pointing to improvement branch
 * 5. Enqueue benchmark for the new version
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { generateReport } from "@/lib/report/generate-findings";
import { NextResponse } from "next/server";
import type { Execution } from "@/lib/types";

const GITHUB_API = "https://api.github.com";
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

// ─── GitHub helpers ─────────────────────────────────────────────────────

async function fetchGitHub(
  url: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "SkillBenchmark",
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });
}

async function getDefaultBranchSha(
  owner: string,
  repo: string,
  token: string
): Promise<{ sha: string; branch: string }> {
  // Get repo default branch
  const repoRes = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}`,
    token
  );
  if (!repoRes.ok) throw new Error(`Failed to fetch repo: ${repoRes.status}`);
  const repoData = await repoRes.json();
  const defaultBranch: string = repoData.default_branch;

  // Get HEAD sha of default branch
  const refRes = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`,
    token
  );
  if (!refRes.ok) throw new Error(`Failed to get branch ref: ${refRes.status}`);
  const refData = await refRes.json();

  return { sha: refData.object.sha, branch: defaultBranch };
}

async function createBranch(
  owner: string,
  repo: string,
  branchName: string,
  baseSha: string,
  token: string
): Promise<void> {
  const res = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/git/refs`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    // Branch might already exist — try to update it
    if (res.status === 422) {
      const updateRes = await fetchGitHub(
        `${GITHUB_API}/repos/${owner}/${repo}/git/refs/heads/${branchName}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: baseSha, force: true }),
        }
      );
      if (!updateRes.ok) throw new Error(`Failed to update branch: ${body}`);
      return;
    }
    throw new Error(`Failed to create branch: ${body}`);
  }
}

async function pushFile(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  content: string,
  message: string,
  token: string
): Promise<string> {
  // Check if file exists to get its SHA
  const existingRes = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
    token
  );

  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch,
  };

  if (existingRes.ok) {
    const existing = await existingRes.json();
    body.sha = existing.sha;
  }

  const res = await fetchGitHub(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`,
    token,
    { method: "PUT", body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to push file: ${errBody}`);
  }

  const data = await res.json();
  return data.commit.sha;
}

// ─── LLM helper ─────────────────────────────────────────────────────────

async function generateImprovedSkill(
  originalContent: string,
  reportSummary: string,
  findingsText: string,
  format: string
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const isClaudeCode = format === "claude_code";

  const prompt = `You are an expert at optimizing AI agent skills/prompts. Analyze the benchmark results below and improve the skill file.

## Current Skill Content
\`\`\`
${originalContent}
\`\`\`

## Benchmark Results
${reportSummary}

## Detailed Findings
${findingsText}

## Instructions
Improve the skill to address the issues identified in the benchmark. Focus on:
1. Token efficiency: Make instructions more concise, remove redundancy
2. Task completion: Remove overly restrictive constraints that block execution
3. Quality: Preserve intent while reducing verbosity
4. Latency: Reduce prompt size where possible

${isClaudeCode ? "This is a Claude Code SKILL.md file. Preserve the markdown format, frontmatter, and structure." : "This is an OpenClaw _meta.json file. Preserve the JSON structure."}

Return ONLY the improved file content — no explanations, no code fences, no commentary.`;

  const res = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8000,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`LLM API error: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty response");

  // Strip any accidental code fences the LLM might add
  return content
    .replace(/^```(?:markdown|json|md)?\n/g, "")
    .replace(/\n```$/g, "")
    .trim();
}

// ─── Route Handler ──────────────────────────────────────────────────────

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  // 1. Auth
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Fetch skill
  const { data: skill } = await supabase
    .from("skills")
    .select("*")
    .eq("id", id)
    .single();

  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  if (skill.submitted_by !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (skill.status !== "completed") {
    return NextResponse.json(
      { error: "Can only fix completed benchmarks" },
      { status: 400 }
    );
  }
  if (!skill.raw_skill_content) {
    return NextResponse.json(
      { error: "No skill content found — cannot generate improvements" },
      { status: 400 }
    );
  }

  // 3. Get GitHub token
  const { data: profile } = await supabase
    .from("profiles")
    .select("github_access_token")
    .eq("id", user.id)
    .single();

  if (!profile?.github_access_token) {
    return NextResponse.json(
      { error: "GitHub token not found. Please re-login." },
      { status: 401 }
    );
  }

  const ghToken: string = profile.github_access_token;

  // 4. Fetch execution data for report generation
  const { data: runs } = await supabase
    .from("benchmark_runs")
    .select("*")
    .eq("skill_id", id)
    .order("run_number", { ascending: false })
    .limit(1);

  let executions: Execution[] = [];
  if (runs?.[0]) {
    const { data: execs } = await supabase
      .from("executions")
      .select("*")
      .eq("benchmark_run_id", runs[0].id);
    executions = (execs ?? []) as Execution[];
  }

  // 5. Generate data-driven report
  const report = generateReport(
    {
      overall: skill.overall_score,
      tokenEfficiency: skill.token_efficiency_score,
      taskCompletion: skill.task_completion_score,
      quality: skill.quality_preservation_score,
      latency: skill.latency_impact_score,
    },
    executions
  );

  const findingsText = report.findings
    .map(
      (f) =>
        `### ${f.dimension} (${f.severity})\n${f.summary}\nData: ${f.dataPoints.join("; ")}\nSuggestions: ${f.suggestions.join("; ")}`
    )
    .join("\n\n");

  // 6. Generate improved skill via LLM
  let improvedContent: string;
  try {
    improvedContent = await generateImprovedSkill(
      skill.raw_skill_content,
      report.overallSummary,
      findingsText,
      skill.format
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate improvements";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // 7. Create GitHub branch + push
  const branchName = `skillbenchmark/improve-${Date.now()}`;
  const skillFileName =
    skill.format === "claude_code" ? "SKILL.md" : "_meta.json";
  const filePath = skill.skill_path
    ? `${skill.skill_path}/${skillFileName}`
    : skillFileName;

  let commitSha: string;
  try {
    const { sha: baseSha } = await getDefaultBranchSha(
      skill.repo_owner,
      skill.repo_name,
      ghToken
    );

    await createBranch(
      skill.repo_owner,
      skill.repo_name,
      branchName,
      baseSha,
      ghToken
    );

    commitSha = await pushFile(
      skill.repo_owner,
      skill.repo_name,
      branchName,
      filePath,
      improvedContent,
      `skillbenchmark: auto-improve based on benchmark scores (${skill.overall_score}/100)`,
      ghToken
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "GitHub operation failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // 8. Insert new skill record for the improvement branch
  const { data: newSkill, error: insertError } = await supabase
    .from("skills")
    .insert({
      submitted_by: user.id,
      github_url: skill.github_url,
      repo_owner: skill.repo_owner,
      repo_name: skill.repo_name,
      branch: branchName,
      skill_path: skill.skill_path,
      format: skill.format,
      status: "pending",
      benchmark_level: skill.benchmark_level,
      name: skill.name,
      display_name: skill.display_name
        ? `${skill.display_name} (improved)`
        : null,
      description: `Auto-improved from benchmark score ${skill.overall_score}/100`,
      version: skill.version,
      author: skill.author,
      tags: skill.tags,
      raw_skill_content: improvedContent,
      commit_sha: commitSha,
    })
    .select("id")
    .single();

  if (insertError || !newSkill) {
    return NextResponse.json(
      { error: "Failed to create improvement record" },
      { status: 500 }
    );
  }

  // 9. Worker picks up status="pending" automatically — no enqueue needed

  // 10. Add activity event
  await supabase.from("skill_activity_events").insert({
    skill_id: id,
    event_type: "info",
    stage: "completed",
    message: `Auto-improvement branch created: ${branchName}`,
    metadata: {
      newSkillId: newSkill.id,
      branchName,
      commitSha,
      originalScore: skill.overall_score,
    },
  });

  return NextResponse.json({
    success: true,
    newSkillId: newSkill.id,
    branchName,
    commitSha,
  });
}
