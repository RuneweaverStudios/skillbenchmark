/**
 * Token counting utilities for benchmark metrics.
 * Uses a simple heuristic (chars/4) as a fast approximation.
 * tiktoken can be used for exact counts but adds startup latency.
 */

const AVG_CHARS_PER_TOKEN = 4;

/** Fast approximate token count from character count */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

/** Calculate total context size from message history */
export function contextSize(
  messages: readonly { content: string | unknown }[]
): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else {
      totalChars += JSON.stringify(msg.content).length;
    }
  }
  return totalChars;
}

/** Calculate p95 from a list of values */
export function p95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/** Calculate mean of values */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
