/** Queue names for the benchmark pipeline */
export const QUEUES = {
  SKILL_INTAKE: "skill-intake",
  SCENARIO_GENERATION: "scenario-generation",
  BENCHMARK_EXECUTION: "benchmark-execution",
  SCORING: "scoring",
  MAINTENANCE: "maintenance",
} as const;

/** Job types within each queue */
export const JOB_TYPES = {
  CLONE_AND_PARSE: "clone-and-parse",
  GENERATE_SCENARIOS: "generate-scenarios",
  EXECUTE_BENCHMARK: "execute-benchmark",
  COMPUTE_SCORES: "compute-scores",
  REFRESH_LEADERBOARD: "refresh-leaderboard",
} as const;

/** Default job options */
export const JOB_DEFAULTS = {
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 5000,
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
} as const;
