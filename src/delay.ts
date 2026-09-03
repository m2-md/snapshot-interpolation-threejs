/**
 * Starting heuristic, not an absolute guarantee.
 * intervalMs: snapshot interval · jitterMs: one-way jitter amplitude (±)
 * lossTolerance: consecutive packet loss tolerance count
 */
export function recommendedDelay(intervalMs: number, jitterMs: number, lossTolerance = 1): number {
  return intervalMs * (1 + lossTolerance) + 2 * jitterMs;
}
