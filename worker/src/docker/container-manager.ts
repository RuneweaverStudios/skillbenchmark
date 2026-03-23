/**
 * Benchmark execution manager.
 *
 * Two modes:
 * 1. Docker: Runs agent-runner.js in an isolated container (requires Docker daemon)
 * 2. Subprocess: Runs agent-runner.js as a child process (fallback when Docker unavailable)
 *
 * Both modes write config.json → run agent-runner.js → read output.json.
 */

import { execSync, fork } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { TurnMetric } from "../agent-loops/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContainerConfig {
  readonly image: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly tools: readonly { name: string; description: string; parameters: Record<string, unknown> }[];
  readonly skillContent: string | null;
  readonly withSkill: boolean;
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly openrouterApiKey: string;
}

export interface ContainerResult {
  readonly taskCompleted: boolean;
  readonly totalTurns: number;
  readonly totalToolCalls: number;
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalCostUsd: number;
  readonly initialContextTokens: number;
  readonly finalContextTokens: number;
  readonly peakContextTokens: number;
  readonly avgTurnLatencyMs: number;
  readonly p95TurnLatencyMs: number;
  readonly turnMetrics: readonly TurnMetric[];
  readonly finalAssistantMessage: string;
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const TIMEOUT_BUFFER_MS = 30_000;

const AGENT_RUNNER_PATH = path.resolve(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "agent-runner.js"
);

function createErrorResult(message: string): ContainerResult {
  return Object.freeze({
    taskCompleted: false,
    totalTurns: 0,
    totalToolCalls: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCostUsd: 0,
    initialContextTokens: 0,
    finalContextTokens: 0,
    peakContextTokens: 0,
    avgTurnLatencyMs: 0,
    p95TurnLatencyMs: 0,
    turnMetrics: [],
    finalAssistantMessage: "",
    error: message,
  });
}

function parseOutputJson(raw: string): ContainerResult {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return Object.freeze({
      taskCompleted: Boolean(data.taskCompleted),
      totalTurns: Number(data.totalTurns) || 0,
      totalToolCalls: Number(data.totalToolCalls) || 0,
      totalPromptTokens: Number(data.totalPromptTokens) || 0,
      totalCompletionTokens: Number(data.totalCompletionTokens) || 0,
      totalCostUsd: Number(data.totalCostUsd) || 0,
      initialContextTokens: Number(data.initialContextTokens) || 0,
      finalContextTokens: Number(data.finalContextTokens) || 0,
      peakContextTokens: Number(data.peakContextTokens) || 0,
      avgTurnLatencyMs: Number(data.avgTurnLatencyMs) || 0,
      p95TurnLatencyMs: Number(data.p95TurnLatencyMs) || 0,
      turnMetrics: Array.isArray(data.turnMetrics) ? (data.turnMetrics as readonly TurnMetric[]) : [],
      finalAssistantMessage: String(data.finalAssistantMessage ?? ""),
      error: data.error != null ? String(data.error) : null,
    });
  } catch {
    return createErrorResult(`Failed to parse output.json: ${raw.slice(0, 200)}`);
  }
}

async function tryReadOutput(dir: string): Promise<ContainerResult | null> {
  try {
    const raw = await fs.readFile(path.join(dir, "output.json"), "utf-8");
    return parseOutputJson(raw);
  } catch {
    return null;
  }
}

async function makeTempDir(): Promise<string> {
  const tmpBase = path.join(os.tmpdir(), "skillbench");
  await fs.mkdir(tmpBase, { recursive: true });
  return fs.mkdtemp(path.join(tmpBase, "run-"));
}

async function writeConfig(dir: string, config: ContainerConfig): Promise<void> {
  await fs.writeFile(
    path.join(dir, "config.json"),
    JSON.stringify({
      model: config.model,
      systemPrompt: config.systemPrompt,
      userPrompt: config.userPrompt,
      tools: config.tools,
      skillContent: config.skillContent,
      withSkill: config.withSkill,
      maxTurns: config.maxTurns,
      timeoutMs: config.timeoutMs,
      openrouterApiKey: config.openrouterApiKey,
    }, null, 2),
    "utf-8"
  );
}

async function cleanup(dir: string): Promise<void> {
  try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Docker detection
// ---------------------------------------------------------------------------

let _dockerAvailable: boolean | null = null;

function isDockerAvailable(): boolean {
  if (_dockerAvailable !== null) return _dockerAvailable;
  try {
    // Check if we can actually connect to the Docker daemon
    // DOCKER_HOST must be set for non-default sockets (e.g. Colima)
    const host = process.env.DOCKER_HOST;
    if (host?.startsWith("unix://")) {
      const socketPath = host.replace("unix://", "");
      const stat = require("node:fs").statSync(socketPath);
      if (!stat) throw new Error("Socket not found");
    } else {
      // Default socket
      const stat = require("node:fs").statSync("/var/run/docker.sock");
      if (!stat) throw new Error("Socket not found");
    }
    execSync("docker info", { stdio: "pipe", timeout: 5000 });
    _dockerAvailable = true;
    console.log("[runner] Docker available — using container mode");
  } catch {
    _dockerAvailable = false;
    console.log("[runner] Docker not available — using subprocess mode");
  }
  return _dockerAvailable;
}

// ---------------------------------------------------------------------------
// Docker mode
// ---------------------------------------------------------------------------

async function runWithDocker(config: ContainerConfig, tempDir: string): Promise<ContainerResult> {
  const Docker = (await import("dockerode")).default;

  const host = process.env.DOCKER_HOST;
  const docker = host?.startsWith("unix://")
    ? new Docker({ socketPath: host.replace("unix://", "") })
    : new Docker();

  // Ensure image exists
  try {
    await docker.getImage(config.image).inspect();
  } catch {
    const contextDir = path.dirname(AGENT_RUNNER_PATH);
    const contextFiles = await fs.readdir(contextDir);
    console.log(`[runner] Building Docker image "${config.image}"...`);
    const stream = await docker.buildImage(
      { context: contextDir, src: contextFiles },
      { t: config.image, dockerfile: "Dockerfile" }
    );
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err: Error | null) => err ? reject(err) : resolve(),
        (ev: { stream?: string }) => { if (ev.stream) process.stdout.write(ev.stream); }
      );
    });
  }

  const container = await docker.createContainer({
    Image: config.image,
    HostConfig: {
      Binds: [`${tempDir}:/benchmark:rw`],
      NetworkMode: "bridge",
      Memory: 512 * 1024 * 1024,
      NanoCpus: 1_000_000_000,
    },
  });

  try {
    await container.start();

    const waitTimeout = config.timeoutMs + TIMEOUT_BUFFER_MS;
    const exit = await Promise.race([
      container.wait() as Promise<{ StatusCode: number }>,
      new Promise<"timeout">(r => setTimeout(() => r("timeout"), waitTimeout)),
    ]);

    if (exit === "timeout") {
      try { await container.kill(); } catch { /* already exited */ }
      const partial = await tryReadOutput(tempDir);
      return partial
        ? Object.freeze({ ...partial, error: partial.error ?? "Container timed out" })
        : createErrorResult(`Container timed out after ${waitTimeout}ms`);
    }

    const result = await tryReadOutput(tempDir);
    if (result) {
      if (exit.StatusCode !== 0 && result.error == null) {
        return Object.freeze({ ...result, error: `Container exited with code ${exit.StatusCode}` });
      }
      return result;
    }
    return createErrorResult(`Container exited with code ${exit.StatusCode}, no output.json`);
  } finally {
    try { await container.remove({ force: true }); } catch { /* ok */ }
  }
}

// ---------------------------------------------------------------------------
// Subprocess mode (no Docker required)
// ---------------------------------------------------------------------------

async function runWithSubprocess(config: ContainerConfig, tempDir: string): Promise<ContainerResult> {
  // The agent-runner.js reads from /benchmark/config.json and writes /benchmark/output.json.
  // In subprocess mode, we override these paths via env vars or symlink.
  // Simplest: copy agent-runner.js to temp dir and patch the paths.
  const runnerSrc = await fs.readFile(AGENT_RUNNER_PATH, "utf-8");
  const patched = runnerSrc
    .replace(/\/benchmark\/config\.json/g, path.join(tempDir, "config.json"))
    .replace(/\/benchmark\/output\.json/g, path.join(tempDir, "output.json"));
  const patchedPath = path.join(tempDir, "agent-runner.js");
  await fs.writeFile(patchedPath, patched, "utf-8");

  return new Promise<ContainerResult>((resolve) => {
    const child = fork(patchedPath, [], {
      stdio: "pipe",
      timeout: config.timeoutMs + TIMEOUT_BUFFER_MS,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, config.timeoutMs + TIMEOUT_BUFFER_MS);

    child.on("exit", async () => {
      clearTimeout(timer);
      const result = await tryReadOutput(tempDir);
      if (result) {
        resolve(killed ? Object.freeze({ ...result, error: result.error ?? "Process timed out" }) : result);
      } else {
        resolve(createErrorResult(killed ? "Process timed out, no output" : "Process exited with no output.json"));
      }
    });

    child.on("error", async (err) => {
      clearTimeout(timer);
      const result = await tryReadOutput(tempDir);
      resolve(result ?? createErrorResult(err.message));
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function ensureImageBuilt(_dockerfilePath: string, _tag: string): Promise<void> {
  // Image is built on-demand in runWithDocker. No-op here.
}

export async function runBenchmarkContainer(config: ContainerConfig): Promise<ContainerResult> {
  const tempDir = await makeTempDir();
  try {
    await writeConfig(tempDir, config);
    if (isDockerAvailable()) {
      return await runWithDocker(config, tempDir);
    }
    return await runWithSubprocess(config, tempDir);
  } catch (err) {
    const partial = await tryReadOutput(tempDir);
    if (partial) {
      return Object.freeze({ ...partial, error: partial.error ?? (err instanceof Error ? err.message : String(err)) });
    }
    return createErrorResult(err instanceof Error ? err.message : String(err));
  } finally {
    await cleanup(tempDir);
  }
}
