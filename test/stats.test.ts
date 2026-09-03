import { describe, expect, it } from "vitest";
import { InterpolationStats } from "../src/stats";

describe("InterpolationStats", () => {
  it("'before' AÇLIK SAYILMAZ — 'after' ve 'empty' sayılır", () => {
    const stats = new InterpolationStats();
    stats.frame("before", 10, 1); // başlangıç anı: tampon doluyor, donma yok
    stats.frame("between", 10, 3);
    stats.frame("after", 10, 3); // renderTime en yeniyi geçti: DONMA
    stats.frame("empty", 10, 0); // hiç snapshot yok: DONMA

    expect(stats.frames).toBe(4);
    expect(stats.starvedFrames).toBe(2);
    expect(stats.starvedMs).toBe(20);
    expect(stats.starvedRatio).toBe(0.5);
  });

  it("longestStarveMs en uzun ARDIŞIK seriyi tutar, toplamı değil", () => {
    const stats = new InterpolationStats();
    // 3 kare seri (30 ms) · kesinti · 5 kare seri (50 ms) · kesinti · 2 kare (20 ms)
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
    expect(stats.starvedMs).toBe(100); // toplam
    expect(stats.longestStarveMs).toBe(50); // en uzun tek kesinti
  });

  it("minBufferSize hiç kare işlenmemişken sonsuz kalır, sonra en küçüğü tutar", () => {
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
