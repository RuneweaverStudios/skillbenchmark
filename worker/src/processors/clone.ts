/**
 * Skill intake processor: clones the GitHub repo, detects skill format,
 * parses metadata, and stores the parsed skill definition.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from "fs";
import { join, relative } from "path";
import { tmpdir } from "os";

export interface CloneResult {
  readonly format: "claude_code" | "openclaw";
  readonly name: string;
  readonly description: string;
  readonly displayName: string | null;
  readonly version: string | null;
  readonly author: string | null;
  readonly tags: readonly string[];
  readonly rawContent: string;
  readonly skillPath: string;
  readonly commitSha: string;
}

export async function cloneAndParse(params: {
  githubUrl: string;
  repoOwner: string;
  repoName: string;
  skillPath?: string | null;
}): Promise<CloneResult> {
  const cloneDir = join(tmpdir(), `skillbench-${Date.now()}-${params.repoName}`);

  try {
    // Shallow clone for speed
    execSync(
      `git clone --depth 1 "${params.githubUrl}" "${cloneDir}"`,
      { timeout: 60_000, stdio: "pipe" }
    );

    // Get commit SHA
    const commitSha = execSync("git rev-parse HEAD", {
      cwd: cloneDir,
      encoding: "utf8",
    }).trim();

    // Always search from clone root — the recursive search handles
    // any nesting depth (root, .claude/, .claude/skills/, etc.)
    const skillFile = findSkillFile(cloneDir);
    if (!skillFile) {
      throw new Error(
        "No SKILL.md or _meta.json found in repository. " +
          "Ensure your repo contains a valid Claude Code skill (SKILL.md) " +
          "or OpenClaw skill (_meta.json)."
      );
    }

    const content = readFileSync(skillFile.path, "utf8");
    const skillPath = relative(cloneDir, skillFile.path);

    if (skillFile.format === "openclaw") {
      const meta = JSON.parse(content);
      return Object.freeze({
        format: "openclaw",
        name: String(meta.name ?? params.repoName),
        description: String(meta.description ?? ""),
        displayName: meta.displayName ?? null,
        version: meta.version ?? null,
        author: meta.author ?? null,
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        rawContent: content,
        skillPath,
        commitSha,
      });
    }

    // Parse SKILL.md frontmatter
    const parsed = parseSkillMd(content);
    return Object.freeze({
      format: "claude_code",
      name: parsed.name ?? params.repoName,
      description: parsed.description ?? "",
      displayName: parsed.displayName ?? null,
      version: parsed.version ?? null,
      author: parsed.author ?? null,
      tags: parsed.tags ?? [],
      rawContent: content,
      skillPath,
      commitSha,
    });
  } finally {
    // Cleanup
    if (existsSync(cloneDir)) {
      rmSync(cloneDir, { recursive: true, force: true });
    }
  }
}

interface SkillFileMatch {
  path: string;
  format: "claude_code" | "openclaw";
}

function findSkillFile(dir: string, depth = 0): SkillFileMatch | null {
  if (depth > 4 || !existsSync(dir)) return null;

  try {
    const entries = readdirSync(dir);

    // Check current directory first
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (!statSync(fullPath).isFile()) continue;

      if (entry === "_meta.json") {
        try {
          const content = readFileSync(fullPath, "utf8");
          const parsed = JSON.parse(content);
          if (parsed.schema?.startsWith("openclaw.skill")) {
            return { path: fullPath, format: "openclaw" };
          }
        } catch { /* not valid openclaw */ }
      }

      if (entry.toLowerCase() === "skill.md") {
        return { path: fullPath, format: "claude_code" };
      }
    }

    // Recurse into subdirectories (include .claude/ but skip .git/)
    for (const entry of entries) {
      if (entry === ".git" || entry === "node_modules") continue;
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        const found = findSkillFile(fullPath, depth + 1);
        if (found) return found;
      }
    }
  } catch { /* permission error, skip */ }

  return null;
}

interface ParsedSkillMd {
  name: string | null;
  description: string | null;
  displayName: string | null;
  version: string | null;
  author: string | null;
  tags: string[];
}

function parseSkillMd(content: string): ParsedSkillMd {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const result: ParsedSkillMd = {
    name: null,
    description: null,
    displayName: null,
    version: null,
    author: null,
    tags: [],
  };

  if (!fmMatch) {
    // Try to extract name from first heading
    const heading = content.match(/^#\s+(.+)$/m);
    result.name = heading?.[1]?.trim() ?? null;
    // First non-heading paragraph as description
    const para = content.match(/^(?!#)(.+)$/m);
    result.description = para?.[1]?.trim() ?? null;
    return result;
  }

  const yaml = fmMatch[1];
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    const clean = value.trim().replace(/^["']|["']$/g, "");
    switch (key) {
      case "name": result.name = clean; break;
      case "description": result.description = clean; break;
      case "displayName":
      case "display_name": result.displayName = clean; break;
      case "version": result.version = clean; break;
      case "author": result.author = clean; break;
    }
  }

  return result;
}
