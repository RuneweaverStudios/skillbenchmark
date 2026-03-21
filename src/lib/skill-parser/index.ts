import type { ParsedSkill, ToolDefinition } from "../types";
import type { SkillFormat } from "../constants";

/**
 * Detect skill format from file contents.
 * Returns "claude_code" for SKILL.md files, "openclaw" for _meta.json files.
 */
export function detectFormat(files: ReadonlyMap<string, string>): {
  format: SkillFormat;
  filePath: string;
} | null {
  // Check for _meta.json first (more specific)
  for (const [path, content] of files) {
    if (path.endsWith("_meta.json")) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.schema?.startsWith("openclaw.skill")) {
          return { format: "openclaw", filePath: path };
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  }

  // Check for SKILL.md
  for (const [path] of files) {
    if (path.endsWith("SKILL.md") || path.endsWith("skill.md")) {
      return { format: "claude_code", filePath: path };
    }
  }

  return null;
}

/**
 * Parse a Claude Code SKILL.md file.
 * Extracts YAML frontmatter and markdown body.
 */
export function parseClaudeSkill(content: string): ParsedSkill {
  const { frontmatter, body } = extractFrontmatter(content);

  const name = String(frontmatter.name ?? "unknown-skill");
  const description = String(
    frontmatter.description ?? extractFirstParagraph(body) ?? ""
  );
  const triggers: string[] = Array.isArray(frontmatter.triggers)
    ? frontmatter.triggers.map(String)
    : parseTriggers(body);
  const tags: string[] = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.map(String)
    : [];

  return Object.freeze({
    format: "claude_code" as const,
    name,
    displayName: frontmatter.displayName
      ? String(frontmatter.displayName)
      : frontmatter.display_name
        ? String(frontmatter.display_name)
        : null,
    description,
    version: frontmatter.version ? String(frontmatter.version) : null,
    author: frontmatter.author ? String(frontmatter.author) : null,
    tags,
    rawContent: content,
    tools: [],
    triggers,
    hooks: null,
  });
}

/**
 * Parse an OpenClaw _meta.json skill file.
 */
export function parseOpenClawSkill(content: string): ParsedSkill {
  const meta = JSON.parse(content);

  const tools: ToolDefinition[] = Array.isArray(meta.tools)
    ? meta.tools.map((t: Record<string, unknown>) =>
        Object.freeze({
          name: String(t.name ?? ""),
          description: String(t.description ?? ""),
          parameters: (t.parameters as Record<string, unknown>) ?? {},
        })
      )
    : [];

  return Object.freeze({
    format: "openclaw" as const,
    name: String(meta.name ?? "unknown-skill"),
    displayName: meta.displayName ?? null,
    description: String(meta.description ?? ""),
    version: meta.version ?? null,
    author: meta.author ?? null,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    rawContent: content,
    tools,
    triggers: [],
    hooks: meta.hooks ?? null,
  });
}

/**
 * Parse a skill from detected format + content.
 */
export function parseSkill(format: SkillFormat, content: string): ParsedSkill {
  switch (format) {
    case "claude_code":
      return parseClaudeSkill(content);
    case "openclaw":
      return parseOpenClawSkill(content);
    default:
      throw new Error(`Unknown skill format: ${format}`);
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────

interface Frontmatter {
  [key: string]: unknown;
}

function extractFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: content };
  }

  const rawYaml = fmMatch[1];
  const body = fmMatch[2];

  // Simple YAML parser for flat key-value + arrays
  const frontmatter: Frontmatter = {};
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of rawYaml.split("\n")) {
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      // Flush previous array
      if (currentKey && currentArray) {
        frontmatter[currentKey] = currentArray;
        currentArray = null;
      }

      const [, key, value] = kvMatch;
      const trimmed = value.trim();

      if (trimmed === "" || trimmed === "[]") {
        currentKey = key;
        currentArray = [];
      } else {
        frontmatter[key] = trimmed.replace(/^["']|["']$/g, "");
        currentKey = null;
      }
    } else if (currentArray !== null) {
      const itemMatch = line.match(/^\s*-\s+(.+)$/);
      if (itemMatch) {
        currentArray.push(itemMatch[1].trim().replace(/^["']|["']$/g, ""));
      }
    }
  }

  // Flush final array
  if (currentKey && currentArray) {
    frontmatter[currentKey] = currentArray;
  }

  return { frontmatter, body };
}

function extractFirstParagraph(body: string): string | null {
  const lines = body.split("\n");
  const paragraphLines: string[] = [];
  let started = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!started && trimmed.length > 0 && !trimmed.startsWith("#")) {
      started = true;
    }
    if (started) {
      if (trimmed.length === 0) break;
      paragraphLines.push(trimmed);
    }
  }

  return paragraphLines.length > 0 ? paragraphLines.join(" ") : null;
}

function parseTriggers(body: string): string[] {
  const triggers: string[] = [];
  const triggerSection = body.match(
    /(?:triggers?|activation|when to use)[:\s]*\n([\s\S]*?)(?:\n\n|\n#|$)/i
  );
  if (!triggerSection) return triggers;

  for (const line of triggerSection[1].split("\n")) {
    const item = line.match(/^\s*[-*]\s+(.+)$/);
    if (item) {
      triggers.push(item[1].trim());
    }
  }

  return triggers;
}
