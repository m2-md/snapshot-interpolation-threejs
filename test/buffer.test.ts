import { describe, expect, it } from "vitest";
import { SnapshotBuffer } from "../src/buffer";

const snap = (tick: number, serverTime: number) => ({ tick, serverTime });

describe("SnapshotBuffer.sampleAt", () => {
  it("finds the enclosing pair and correctly calculates alpha", () => {
    const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
    buffer.insert(snap(0, 0));
    buffer.insert(snap(1, 100));
    buffer.insert(snap(2, 200));

    const s = buffer.sampleAt(150);
    expect(s.kind).toBe("between");
    expect(s.from?.tick).toBe(1);
    expect(s.to?.tick).toBe(2);
    expect(s.alpha).toBe(0.5);
  });

  it("yields alpha 0 exactly on a snapshot", () => {
    const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
    buffer.insert(snap(0, 0));
    buffer.insert(snap(1, 100));
    buffer.insert(snap(2, 200));

    const s = buffer.sampleAt(100);
    expect(s.kind).toBe("between");
    expect(s.from?.tick).toBe(1);
    expect(s.alpha).toBe(0);
  });

  it("returns 'before' behind the buffer and 'after' ahead of it", () => {
    const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
    buffer.insert(snap(5, 500));
    buffer.insert(snap(6, 600));

    expect(buffer.sampleAt(400).kind).toBe("before");
    expect(buffer.sampleAt(700).kind).toBe("after");
    expect(buffer.sampleAt(700).from?.tick).toBe(6); // clamps to newest
    expect(new SnapshotBuffer().sampleAt(0).kind).toBe("empty");
  });
});

it("places out-of-order packets in correct position", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
  buffer.insert(snap(0, 0));
  buffer.insert(snap(2, 200)); // 1 was delayed
  expect(buffer.insert(snap(1, 100))).toBe(true);

  expect(buffer.toArray().map((s) => s.tick)).toEqual([0, 1, 2]);
});

it("ignores duplicate ticks", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
  buffer.insert(snap(0, 0));
  buffer.insert(snap(1, 100));

  expect(buffer.insert(snap(1, 100))).toBe(false);
  expect(buffer.size).toBe(2);
});

it("prune NEVER deletes the left end of enclosing pair", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
  for (let i = 0; i < 6; i++) buffer.insert(snap(i, i * 100));

  buffer.prune(430);
  expect(buffer.toArray().map((s) => s.tick)).toEqual([4, 5]);
  expect(buffer.sampleAt(430).kind).toBe("between"); // still interpolatable
});

it("drops oldest when capacity exceeded; very late packet cannot enter buffer", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>(3);
  buffer.insert(snap(10, 1000));
  buffer.insert(snap(11, 1100));
  buffer.insert(snap(12, 1200));

  expect(buffer.insert(snap(1, 100))).toBe(false); // stale packet
  expect(buffer.toArray().map((s) => s.tick)).toEqual([10, 11, 12]);
});
