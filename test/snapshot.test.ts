import { describe, expect, it } from "vitest";
import { createEntityState, normalizeEntity } from "../src/snapshot";

describe("normalizeEntity", () => {
  it("nicelemeden çıkmış birim OLMAYAN quaternion'u birim yapar", () => {
    const e = createEntityState(3);
    // 120°'lik yaw quaternion'unun 1,5 katı — makaledeki 73,17° sapmasının kaynağı.
    e.qy = Math.sin(Math.PI / 3) * 1.5;
    e.qw = Math.cos(Math.PI / 3) * 1.5;

    const before = Math.sqrt(e.qy * e.qy + e.qw * e.qw);
    expect(before).toBeCloseTo(1.5, 12);

    normalizeEntity(e);
    const after = Math.sqrt(e.qx * e.qx + e.qy * e.qy + e.qz * e.qz + e.qw * e.qw);
    expect(after).toBeCloseTo(1, 15);
    expect(e.qy).toBeCloseTo(Math.sin(Math.PI / 3), 15);
  });

  it("sıfır uzunluklu quaternion birim (0,0,0,1)'e düşer", () => {
    const e = createEntityState(4);
    e.qx = 0;
    e.qy = 0;
    e.qz = 0;
    e.qw = 0;

    normalizeEntity(e);
    expect([e.qx, e.qy, e.qz, e.qw]).toEqual([0, 0, 0, 1]);
  });

  it("yerinde mutasyon yapar, yeni nesne döndürmez", () => {
    const e = createEntityState(5);
    e.qw = 2;
    expect(normalizeEntity(e)).toBe(e);
    expect(e.qw).toBe(1);
  });
});
