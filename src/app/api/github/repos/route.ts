import { createServerSupabase } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { SkillFormat } from "@/lib/constants";

// ─── Types ──────────────────────────────────────────────────────────────

interface GitHubRepo {
  readonly id: number;
  readonly name: string;
  readonly full_name: string;
  readonly description: string | null;
  readonly html_url: string;
  readonly updated_at: string;
  readonly language: string | null;
  readonly private: boolean;
  readonly owner: { readonly login: string };
}

interface GitHubContent {
  readonly name: string;
  readonly type: "file" | "dir";
}

interface RepoResult {
  readonly id: number;
  readonly name: string;
  readonly full_name: string;
  readonly description: string | null;
  readonly html_url: string;
  readonly updated_at: string;
  readonly language: string | null;
  readonly private: boolean;
  readonly has_skill_file: boolean;
  readonly skill_format: SkillFormat | null;
}

// ─── Constants ──────────────────────────────────────────────────────────

const GITHUB_API = "https://api.github.com";
const MAX_PAGES = 3;
const CONCURRENCY_LIMIT = 10;
const CACHE_MAX_AGE = 60;

// ─── Helpers ────────────────────────────────────────────────────────────

function parseLinkHeader(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

async function fetchGitHub(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "SkillBenchmark",
    },
  });
}

async function fetchAllRepos(token: string): Promise<readonly GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let url: string | null =
    `${GITHUB_API}/user/repos?per_page=100&sort=updated&type=owner`;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const response = await fetchGitHub(url, token);
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data: GitHubRepo[] = await response.json();
    repos.push(...data);

    url = parseLinkHeader(response.headers.get("link"));
  }

  return repos;
}

function detectSkillFormat(
  fileNames: readonly string[]
): { hasSkill: boolean; format: SkillFormat | null } {
  const names = new Set(fileNames);

  if (names.has("SKILL.md")) {
    return { hasSkill: true, format: "claude_code" };
  }
  if (names.has("_meta.json")) {
    return { hasSkill: true, format: "openclaw" };
  }
  return { hasSkill: false, format: null };
}

async function checkRepoForSkillFiles(
  repo: GitHubRepo,
  token: string
): Promise<{ hasSkill: boolean; format: SkillFormat | null }> {
  // Check root directory
  const rootResponse = await fetchGitHub(
    `${GITHUB_API}/repos/${repo.full_name}/contents/`,
    token
  );

  if (!rootResponse.ok) {
    // Empty repo or inaccessible — skip
    return { hasSkill: false, format: null };
  }

  const rootContents: GitHubContent[] = await rootResponse.json();

  // Check root-level skill files
  const rootFileNames = rootContents.map((item) => item.name);
  const rootResult = detectSkillFormat(rootFileNames);
  if (rootResult.hasSkill) {
    return rootResult;
  }

  // Check if .claude/ directory exists
  const hasClaudeDir = rootContents.some(
    (item) => item.type === "dir" && item.name === ".claude"
  );

  if (hasClaudeDir) {
    const claudeResponse = await fetchGitHub(
      `${GITHUB_API}/repos/${repo.full_name}/contents/.claude`,
      token
    );

    if (claudeResponse.ok) {
      const claudeContents: GitHubContent[] = await claudeResponse.json();
      const claudeFileNames = claudeContents.map((item) => item.name);
      const claudeResult = detectSkillFormat(claudeFileNames);
      if (claudeResult.hasSkill) {
        return claudeResult;
      }
    }
  }

  return { hasSkill: false, format: null };
}

/**
 * Runs async tasks with a concurrency limit.
 * Returns results in the same order as the input items.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<readonly R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}

// ─── Route Handler ──────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createServerSupabase();

  // Verify authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch GitHub access token from profiles
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("github_access_token")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.github_access_token) {
    return NextResponse.json(
      { error: "GitHub token not found. Please re-login." },
      { status: 401 }
    );
  }

  const token: string = profile.github_access_token;

  // Fetch all repos from GitHub
  let repos: readonly GitHubRepo[];
  try {
    repos = await fetchAllRepos(token);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch GitHub repos";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Check each repo for skill files (parallel with concurrency limit)
  const skillChecks = await mapWithConcurrency(
    repos,
    CONCURRENCY_LIMIT,
    async (repo): Promise<RepoResult> => {
      try {
        const { hasSkill, format } = await checkRepoForSkillFiles(repo, token);
        return {
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description,
          html_url: repo.html_url,
          updated_at: repo.updated_at,
          language: repo.language,
          private: repo.private,
          has_skill_file: hasSkill,
          skill_format: format,
        };
      } catch {
        // If checking fails, include repo without skill info
        return {
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description,
          html_url: repo.html_url,
          updated_at: repo.updated_at,
          language: repo.language,
          private: repo.private,
          has_skill_file: false,
          skill_format: null,
        };
      }
    }
  );

  // Sort: repos with skill files first, then the rest (preserve update order within groups)
  const sorted = [...skillChecks].sort((a, b) => {
    if (a.has_skill_file && !b.has_skill_file) return -1;
    if (!a.has_skill_file && b.has_skill_file) return 1;
    return 0;
  });

  const response = NextResponse.json({ repos: sorted });
  response.headers.set(
    "Cache-Control",
    `private, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=${CACHE_MAX_AGE * 2}`
  );

  return response;
}
