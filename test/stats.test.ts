import { describe, expect, it } from "vitest";
import { InterpolationStats } from "../src/stats";

describe("InterpolationStats", () => {
  it("'before' is NOT COUNTED AS STARVATION — 'after' and 'empty' are", () => {
    const stats = new InterpolationStats();
    stats.frame("before", 10, 1); // initial moment: buffer filling, no freeze
    stats.frame("between", 10, 3);
    stats.frame("after", 10, 3); // renderTime exceeded newest: FREEZE
    stats.frame("empty", 10, 0); // no snapshots at all: FREEZE

    expect(stats.frames).toBe(4);
    expect(stats.starvedFrames).toBe(2);
    expect(stats.starvedMs).toBe(20);
    expect(stats.starvedRatio).toBe(0.5);
  });

  it("longestStarveMs tracks the longest CONSECUTIVE streak, not the sum", () => {
    const stats = new InterpolationStats();
    // 3 frame streak (30 ms) · interrupted · 5 frame streak (50 ms) · interrupted · 2 frames (20 ms)
    const script: [string, number][] = [
      ["after", 3],
      ["between", 1],
      ["after", 5],
      ["between", 1],
      ["after", 2],
    ];
    for (const [kind, count] of script) {
      for (let i = 0; i < count; i++) {
        stats.frame(kind as "after" | "between", 10, 2);
      }
    }

    expect(stats.starvedFrames).toBe(10);
    expect(stats.starvedMs).toBe(100); // total
    expect(stats.longestStarveMs).toBe(50); // longest single interruption
  });

  it("minBufferSize remains infinite when no frames processed, then tracks minimum", () => {
    const stats = new InterpolationStats();
    expect(Number.isFinite(stats.minBufferSize)).toBe(false);

    stats.frame("between", 8, 4);
    stats.frame("between", 8, 2);
    stats.frame("between", 8, 5);
    expect(stats.minBufferSize).toBe(2);

    stats.reset();
    expect(Number.isFinite(stats.minBufferSize)).toBe(false);
    expect(stats.frames).toBe(0);
    expect(stats.longestStarveMs).toBe(0);
  });
});
