import { describe, expect, it } from "vitest";
import { simulate } from "../scripts/starvation-bench";

it("same seed produces same starvation count", () => {
  const a = simulate({ delayMs: 100, jitterMs: 40, lossRate: 0.05, seed: 1337, seconds: 10 });
  const b = simulate({ delayMs: 100, jitterMs: 40, lossRate: 0.05, seed: 1337, seconds: 10 });
  expect(a.starvedFrames).toBe(b.starvedFrames);
  expect(a.longestStarveMs).toBe(b.longestStarveMs);
});

it("starvation decreases as delay increases (monotonic)", () => {
  const opts = { jitterMs: 40, lossRate: 0, seed: 1337, seconds: 10 };
  const short = simulate({ ...opts, delayMs: 33 });
  const long = simulate({ ...opts, delayMs: 200 });
  expect(long.starvedFrames).toBeLessThanOrEqual(short.starvedFrames);
});

/**
 * The monotonicity test above is weak on its own: if `delayMs` is not used at all
 * (RenderClock(0)), both runs exit equal and `toBeLessThanOrEqual` still passes.
 * Caught by mutation testing, this test pins the actual counts.
 */
it("delayMs has real effect: 33 ms vs 200 ms with ±40 ms jitter", () => {
  const opts = { jitterMs: 40, lossRate: 0, seed: 1337, seconds: 10 };
  const short = simulate({ ...opts, delayMs: 33 });
  const long = simulate({ ...opts, delayMs: 200 });

  expect(short.frames).toBe(1200);
  expect(short.starvedFrames).toBe(1051);
  expect(long.starvedFrames).toBe(10);
  expect(short.longestStarveMs).toBeCloseTo(641.67, 1);
  expect(long.longestStarveMs).toBeCloseTo(83.33, 1);
});
