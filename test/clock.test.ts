import { describe, expect, it } from "vitest";
import { RenderClock, ServerClockEstimator } from "../src/clock";

it("takes the MAX sample in window as offset (least delayed packet)", () => {
  const c = new ServerClockEstimator(4);
  c.addSample(1000, 900); // offset - d = 100
  c.addSample(1100, 1030); //            = 70
  c.addSample(1200, 1085); //            = 115
  expect(c.offset).toBe(115);
  expect(c.serverNow(2000)).toBe(2115);
});

it("renderTime never moves backwards", () => {
  const clock = new RenderClock(100);
  expect(clock.advance(1000)).toBe(900);
  expect(clock.advance(1050)).toBe(950);
  expect(clock.advance(900)).toBe(950); // offset drifted down: freeze, do not rewind
  expect(clock.advance(1200)).toBe(1100);
});
