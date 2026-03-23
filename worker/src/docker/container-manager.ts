/**
 * Docker container manager for benchmark execution.
 * Spins up isolated containers with config.json, waits for results,
 * and parses output.json into typed ContainerResult.
 */

import Docker from "dockerode";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ToolDef, TurnMetric } from "../agent-loops/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContainerConfig {
  readonly image: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly tools: readonly ToolDef[];
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

// Respect DOCKER_HOST env (e.g., Colima uses unix:///Users/.../.colima/default/docker.sock)
function createDockerClient(): Docker {
  const host = process.env.DOCKER_HOST;
  if (host?.startsWith("unix://")) {
    return new Docker({ socketPath: host.replace("unix://", "") });
  }
  return new Docker();
}

const docker = createDockerClient();

/** 30-second grace period added on top of config.timeoutMs for container wait. */
const TIMEOUT_BUFFER_MS = 30_000;

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

/**
 * Parse raw JSON from output.json into a validated ContainerResult.
 * Returns an error result if the data is malformed.
 */
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
      turnMetrics: Array.isArray(data.turnMetrics)
        ? (data.turnMetrics as readonly TurnMetric[])
        : [],
      finalAssistantMessage: String(data.finalAssistantMessage ?? ""),
      error: data.error != null ? String(data.error) : null,
    });
  } catch {
    return createErrorResult(`Failed to parse output.json: ${raw.slice(0, 200)}`);
  }
}

/**
 * Attempt to read and parse output.json from the temp directory.
 * Returns null if the file does not exist or cannot be read.
 */
async function tryReadOutput(tempDir: string): Promise<ContainerResult | null> {
  const outputPath = path.join(tempDir, "output.json");
  try {
    const raw = await fs.readFile(outputPath, "utf-8");
    return parseOutputJson(raw);
  } catch {
    return null;
  }
}

/**
 * Remove a Docker container, swallowing errors if it no longer exists.
 */
async function removeContainer(container: Docker.Container): Promise<void> {
  try {
    await container.remove({ force: true });
  } catch {
    // Container may already be removed; safe to ignore.
  }
}

/**
 * Recursively remove a temp directory, swallowing errors.
 */
async function removeTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a Docker image from a Dockerfile if it does not already exist locally.
 * Streams build output to stdout.
 */
export async function ensureImageBuilt(
  dockerfilePath: string,
  tag: string
): Promise<void> {
  // Check if the image already exists
  try {
    await docker.getImage(tag).inspect();
    console.log(`[container-manager] Image "${tag}" already exists, skipping build.`);
    return;
  } catch {
    // Image not found — proceed to build.
  }

  const contextDir = path.dirname(dockerfilePath);
  const dockerfile = path.basename(dockerfilePath);

  console.log(`[container-manager] Building image "${tag}" from ${dockerfilePath}...`);

  // Include all files in the docker context directory
  const contextFiles = await fs.readdir(contextDir);
  const stream = await docker.buildImage(
    {
      context: contextDir,
      src: contextFiles,
    },
    { t: tag, dockerfile }
  );

  // Stream build output to console
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null) => {
        if (err) {
          reject(new Error(`Docker build failed for "${tag}": ${err.message}`));
        } else {
          console.log(`[container-manager] Image "${tag}" built successfully.`);
          resolve();
        }
      },
      (event: { stream?: string; error?: string }) => {
        if (event.stream) {
          process.stdout.write(event.stream);
        }
        if (event.error) {
          console.error(`[container-manager] Build error: ${event.error}`);
        }
      }
    );
  });
}

/**
 * Run a benchmark inside a Docker container.
 *
 * 1. Creates a temp directory and writes config.json into it.
 * 2. Starts a container with the temp dir bind-mounted at /benchmark.
 * 3. Waits for the container to exit (with timeout).
 * 4. Reads output.json from the temp dir and returns parsed results.
 * 5. Cleans up the container and temp dir.
 */
export async function runBenchmarkContainer(
  config: ContainerConfig
): Promise<ContainerResult> {
  // Use home dir for temp — os.tmpdir() returns /var/folders on macOS
  // which Docker (Colima/Docker Desktop) often can't mount.
  // On Linux /tmp works fine but $HOME/.cache is universally safe.
  const tmpBase = path.join(os.homedir(), ".cache", "skillbench");
  await fs.mkdir(tmpBase, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(tmpBase, "run-"));
  let container: Docker.Container | null = null;

  try {
    // ---- Write config.json ------------------------------------------------
    const configPayload = {
      model: config.model,
      systemPrompt: config.systemPrompt,
      userPrompt: config.userPrompt,
      tools: config.tools,
      skillContent: config.skillContent,
      withSkill: config.withSkill,
      maxTurns: config.maxTurns,
      timeoutMs: config.timeoutMs,
      openrouterApiKey: config.openrouterApiKey,
    };

    await fs.writeFile(
      path.join(tempDir, "config.json"),
      JSON.stringify(configPayload, null, 2),
      "utf-8"
    );

    // ---- Create container -------------------------------------------------
    container = await docker.createContainer({
      Image: config.image,
      HostConfig: {
        Binds: [`${tempDir}:/benchmark:rw`],
        NetworkMode: "bridge",
        Memory: 512 * 1024 * 1024, // 512 MB
        NanoCpus: 1_000_000_000,   // 1 CPU core
      },
    });

    // ---- Start container --------------------------------------------------
    await container.start();

    // ---- Wait for exit (with timeout) -------------------------------------
    const waitTimeoutMs = config.timeoutMs + TIMEOUT_BUFFER_MS;
    const exitResult = await Promise.race([
      container.wait() as Promise<{ StatusCode: number }>,
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), waitTimeoutMs)
      ),
    ]);

    if (exitResult === "timeout") {
      console.error(
        `[container-manager] Container timed out after ${waitTimeoutMs}ms, killing.`
      );
      try {
        await container.kill();
      } catch {
        // Container may have already exited.
      }

      // Still try to read partial output
      const partial = await tryReadOutput(tempDir);
      if (partial) {
        return Object.freeze({
          ...partial,
          error: partial.error ?? "Container timed out",
        });
      }
      return createErrorResult(
        `Container timed out after ${waitTimeoutMs}ms`
      );
    }

    // ---- Read output.json -------------------------------------------------
    const result = await tryReadOutput(tempDir);

    if (result) {
      // If the container exited non-zero but we still got output, annotate the error
      if (exitResult.StatusCode !== 0 && result.error == null) {
        return Object.freeze({
          ...result,
          error: `Container exited with code ${exitResult.StatusCode}`,
        });
      }
      return result;
    }

    // No output.json found
    return createErrorResult(
      exitResult.StatusCode === 0
        ? "Container exited successfully but output.json is missing"
        : `Container exited with code ${exitResult.StatusCode} and no output.json`
    );
  } catch (err) {
    // Attempt to read any partial output before returning the error
    const partial = await tryReadOutput(tempDir);
    if (partial) {
      return Object.freeze({
        ...partial,
        error:
          partial.error ??
          (err instanceof Error ? err.message : String(err)),
      });
    }

    return createErrorResult(
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    // ---- Cleanup ----------------------------------------------------------
    if (container) {
      await removeContainer(container);
    }
    await removeTempDir(tempDir);
  }
}
