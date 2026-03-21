/**
 * Job producers — enqueue benchmark pipeline jobs.
 * Called from API routes when skills are submitted.
 */

import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";
import { QUEUES, JOB_TYPES, JOB_DEFAULTS } from "./constants";

let intakeQueue: Queue | null = null;

function getIntakeQueue(): Queue {
  if (!intakeQueue) {
    intakeQueue = new Queue(QUEUES.SKILL_INTAKE, {
      connection: getRedisConnection(),
    });
  }
  return intakeQueue;
}

/**
 * Enqueue a skill for processing (clone → parse → benchmark → score).
 */
export async function enqueueSkillIntake(params: {
  skillId: string;
  githubUrl: string;
  repoOwner: string;
  repoName: string;
  skillPath?: string | null;
  userId: string;
}): Promise<string> {
  const queue = getIntakeQueue();

  const job = await queue.add(
    JOB_TYPES.CLONE_AND_PARSE,
    {
      skillId: params.skillId,
      githubUrl: params.githubUrl,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      skillPath: params.skillPath ?? undefined,
      userId: params.userId,
    },
    {
      ...JOB_DEFAULTS,
      jobId: `intake-${params.skillId}`,
    }
  );

  return job.id ?? params.skillId;
}
