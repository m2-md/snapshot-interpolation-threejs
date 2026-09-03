/**
 * Başlangıç noktası, garanti değil.
 * intervalMs: snapshot aralığı · jitterMs: tek yönlü jitter genliği (±)
 * lossTolerance: arka arkaya kaç kayıp pakete dayanılacağı
 */
export function recommendedDelay(intervalMs: number, jitterMs: number, lossTolerance = 1): number {
  return intervalMs * (1 + lossTolerance) + 2 * jitterMs;
}
