import { describe, expect, it } from "vitest";
import { simulate } from "../scripts/starvation-bench";

it("aynı tohum aynı açlık sayısını verir", () => {
  const a = simulate({ delayMs: 100, jitterMs: 40, lossRate: 0.05, seed: 1337, seconds: 10 });
  const b = simulate({ delayMs: 100, jitterMs: 40, lossRate: 0.05, seed: 1337, seconds: 10 });
  expect(a.starvedFrames).toBe(b.starvedFrames);
  expect(a.longestStarveMs).toBe(b.longestStarveMs);
});

it("gecikme büyüdükçe açlık azalır (monoton)", () => {
  const opts = { jitterMs: 40, lossRate: 0, seed: 1337, seconds: 10 };
  const short = simulate({ ...opts, delayMs: 33 });
  const long = simulate({ ...opts, delayMs: 200 });
  expect(long.starvedFrames).toBeLessThanOrEqual(short.starvedFrames);
});

/**
 * Yukarıdaki monotonluk testi tek başına ZAYIF bir koruma: `delayMs` hiç
 * kullanılmasa (RenderClock(0)) iki koşum da eşit çıkar ve `toBeLessThanOrEqual`
 * yine geçer. Mutasyonla yakalandı, bu test onun için var — sayılar çivileniyor.
 */
it("delayMs gerçekten etki ediyor: ±40 ms jitterde 33 ms vs 200 ms", () => {
  const opts = { jitterMs: 40, lossRate: 0, seed: 1337, seconds: 10 };
  const short = simulate({ ...opts, delayMs: 33 });
  const long = simulate({ ...opts, delayMs: 200 });

  expect(short.frames).toBe(1200);
  expect(short.starvedFrames).toBe(1051);
  expect(long.starvedFrames).toBe(10);
  expect(short.longestStarveMs).toBeCloseTo(641.67, 1);
  expect(long.longestStarveMs).toBeCloseTo(83.33, 1);
});
