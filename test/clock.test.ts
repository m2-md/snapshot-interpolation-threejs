import { describe, expect, it } from "vitest";
import { RenderClock, ServerClockEstimator } from "../src/clock";

it("offset penceredeki EN BÜYÜK örneği alır (en az geciken paket)", () => {
  const c = new ServerClockEstimator(4);
  c.addSample(1000, 900); // offset - d = 100
  c.addSample(1100, 1030); //            = 70
  c.addSample(1200, 1085); //            = 115
  expect(c.offset).toBe(115);
  expect(c.serverNow(2000)).toBe(2115);
});

it("renderTime asla geri gitmez", () => {
  const clock = new RenderClock(100);
  expect(clock.advance(1000)).toBe(900);
  expect(clock.advance(1050)).toBe(950);
  expect(clock.advance(900)).toBe(950); // offset aşağı kaydı: DON, geri sarma
  expect(clock.advance(1200)).toBe(1100);
});
