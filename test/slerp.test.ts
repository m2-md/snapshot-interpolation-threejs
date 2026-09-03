import { MathUtils, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

const Y = new Vector3(0, 1, 0);
const yawQuat = (deg: number) => new Quaternion().setFromAxisAngle(Y, MathUtils.degToRad(deg));

/** Total angular length of an interpolation path (degrees). */
function pathDegrees(step: (t: number) => Quaternion, samples = 2000): number {
  let total = 0;
  let prev = step(0);
  for (let i = 1; i <= samples; i++) {
    const q = step(i / samples);
    total += prev.angleTo(q);
    prev = q;
  }
  return MathUtils.radToDeg(total);
}

describe("slerp chooses the shortest path", () => {
  const a = yawQuat(-178.8);
  const b = yawQuat(176.7);

  it("dot is NEGATIVE on this pair — long arc trap is set", () => {
    expect(a.dot(b)).toBeLessThan(0);
    expect(a.dot(b)).toBeCloseTo(-0.99923, 5);
  });

  it("slerp traverses 4.5 degrees, component-wise lerp traverses 355.5", () => {
    const slerped = pathDegrees((t) => a.clone().slerp(b, t));
    const naive = pathDegrees((t) =>
      new Quaternion(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
        a.w + (b.w - a.w) * t,
      ).normalize(),
    );

    expect(slerped).toBeCloseTo(4.5, 2);
    expect(naive).toBeCloseTo(355.5, 2);
  });

  it("preserves midpoint additivity (angleTo alone is insufficient)", () => {
    const mid = a.clone().slerp(b, 0.5);
    const sum = MathUtils.radToDeg(a.angleTo(mid) + mid.angleTo(b));
    expect(sum).toBeCloseTo(MathUtils.radToDeg(a.angleTo(b)), 6);
    expect(MathUtils.radToDeg(a.angleTo(b))).toBeLessThanOrEqual(180);
  });

  it("exact equality at t=0; if dot<0 at t=1 result becomes -qb", () => {
    const at0 = a.clone().slerp(b, 0);
    expect(at0.x).toBe(a.x);
    expect(at0.y).toBe(a.y);
    expect(at0.z).toBe(a.z);
    expect(at0.w).toBe(a.w);

    const at1 = a.clone().slerp(b, 1);
    expect(at1.equals(b)).toBe(false); // components are NOT equal
    expect(at1.angleTo(b)).toBeCloseTo(0, 6); // rotation is the SAME (floating point margin of acos)
    expect(at1.y).toBe(-b.y);
    expect(at1.w).toBe(-b.w);
  });

  it("non-unit input silently distorts the angle", () => {
    const from = yawQuat(0);
    const to = yawQuat(120);
    const scaled = new Quaternion(to.x * 1.5, to.y * 1.5, to.z * 1.5, to.w * 1.5);

    const good = from.clone().slerp(to, 0.5);
    const bad = from.clone().slerp(scaled, 0.5);

    expect(MathUtils.radToDeg(from.angleTo(good))).toBeCloseTo(60, 6);
    expect(bad.length()).toBeGreaterThan(1.1); // result is not even unit length
  });
});
