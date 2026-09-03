import { describe, expect, it } from "vitest";
import { SnapshotBuffer } from "../src/buffer";

const snap = (tick: number, serverTime: number) => ({ tick, serverTime });

describe("SnapshotBuffer.sampleAt", () => {
  it("kapsayan çifti bulur ve alpha'yı doğru hesaplar", () => {
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

  it("tam bir snapshot'ın üstünde alpha 0 verir", () => {
    const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
    buffer.insert(snap(0, 0));
    buffer.insert(snap(1, 100));
    buffer.insert(snap(2, 200));

    const s = buffer.sampleAt(100);
    expect(s.kind).toBe("between");
    expect(s.from?.tick).toBe(1);
    expect(s.alpha).toBe(0);
  });

  it("tamponun gerisinde 'before', önünde 'after' döner", () => {
    const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
    buffer.insert(snap(5, 500));
    buffer.insert(snap(6, 600));

    expect(buffer.sampleAt(400).kind).toBe("before");
    expect(buffer.sampleAt(700).kind).toBe("after");
    expect(buffer.sampleAt(700).from?.tick).toBe(6); // en yeniye tutunur
    expect(new SnapshotBuffer().sampleAt(0).kind).toBe("empty");
  });
});

it("sırasız gelen paket doğru yere yerleşir", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
  buffer.insert(snap(0, 0));
  buffer.insert(snap(2, 200)); // 1 geç kaldı
  expect(buffer.insert(snap(1, 100))).toBe(true);

  expect(buffer.toArray().map((s) => s.tick)).toEqual([0, 1, 2]);
});

it("yinelenen tick yok sayılır", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
  buffer.insert(snap(0, 0));
  buffer.insert(snap(1, 100));

  expect(buffer.insert(snap(1, 100))).toBe(false);
  expect(buffer.size).toBe(2);
});

it("prune kapsayan çiftin sol ucunu ASLA silmez", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
  for (let i = 0; i < 6; i++) buffer.insert(snap(i, i * 100));

  buffer.prune(430);
  expect(buffer.toArray().map((s) => s.tick)).toEqual([4, 5]);
  expect(buffer.sampleAt(430).kind).toBe("between"); // hâlâ interpole edilebiliyor
});

it("kapasite aşılınca en eski düşer; çok geç gelen paket tampona giremez", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>(3);
  buffer.insert(snap(10, 1000));
  buffer.insert(snap(11, 1100));
  buffer.insert(snap(12, 1200));

  expect(buffer.insert(snap(1, 100))).toBe(false); // fosil
  expect(buffer.toArray().map((s) => s.tick)).toEqual([10, 11, 12]);
});
