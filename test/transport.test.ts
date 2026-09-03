import { describe, expect, it } from "vitest";
import { FakeTransport } from "../src/transport";

function run(lossRate: number): number[] {
  const t = new FakeTransport<number>({ latencyMs: 60, jitterMs: 40, lossRate, seed: 1337 });
  const arrivals: number[] = [];
  for (let i = 0; i < 200; i++) {
    t.send(i, i * 66.67);
    for (const payload of t.poll(i * 66.67)) arrivals.push(payload);
  }
  return arrivals;
}

it("aynı tohum aynı diziyi verir", () => {
  expect(run(0)).toEqual(run(0));
});

it("kayıp oranını değiştirmek jitter akışını BOZMAZ", () => {
  const clean = run(0);
  const lossy = run(0.2);
  // Kayıplı koşumda gelenlerin hepsi temiz koşumda da aynı SIRADA var.
  const cleanIndex = new Map(clean.map((v, i) => [v, i]));
  let last = -1;
  for (const v of lossy) {
    const idx = cleanIndex.get(v);
    expect(idx).toBeDefined();
    expect(idx!).toBeGreaterThan(last);
    last = idx!;
  }
  expect(lossy.length).toBeLessThan(clean.length);
});

it("yeterli jitter sıra bozulması üretir", () => {
  const t = new FakeTransport<number>({ latencyMs: 60, jitterMs: 60, lossRate: 0, seed: 7 });
  for (let i = 0; i < 300; i++) {
    t.send(i, i * 33.33);
    t.poll(i * 33.33);
  }
  expect(t.outOfOrder).toBeGreaterThan(0);
});
