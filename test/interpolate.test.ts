import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createPose, interpolatePose, naiveLerpPose } from "../src/interpolate";
import { createEntityState } from "../src/snapshot";
import type { EntityState } from "../src/snapshot";

function state(px: number, pz: number, yawDeg: number): EntityState {
  const half = (yawDeg * Math.PI) / 360;
  const e = createEntityState(1);
  e.px = px;
  e.pz = pz;
  e.qy = Math.sin(half);
  e.qw = Math.cos(half);
  return e;
}

describe("interpolatePose", () => {
  it("at alpha = 0 result is exactly 'from' (position and rotation)", () => {
    const from = state(-3, 7, -178.8);
    const to = state(9, -2, 176.7);
    const out = interpolatePose(from, to, 0, createPose());

    expect(out.position.x).toBe(from.px);
    expect(out.position.y).toBe(from.py);
    expect(out.position.z).toBe(from.pz);
    expect(out.quaternion.y).toBe(from.qy);
    expect(out.quaternion.w).toBe(from.qw);
  });

  it("at alpha = 1 result is 'to' — tested with toBeCloseTo (a + (b - a) is not exactly b)", () => {
    const from = state(-3, 7, 10);
    const to = state(9, -2, 40);
    const out = interpolatePose(from, to, 1, createPose());

    expect(out.position.x).toBeCloseTo(to.px, 12);
    expect(out.position.z).toBeCloseTo(to.pz, 12);
    // Rotation identical: not checking component equality, checking angle difference.
    const target = new Quaternion(to.qx, to.qy, to.qz, to.qw);
    expect(out.quaternion.angleTo(target)).toBeCloseTo(0, 6);
  });

  it("zero per-frame allocation: same 'out' object and fields returned", () => {
    const from = state(0, 0, 0);
    const to = state(4, 4, 90);
    const pose = createPose();
    const position: Vector3 = pose.position;
    const quaternion: Quaternion = pose.quaternion;

    for (let i = 0; i <= 10; i++) {
      const out = interpolatePose(from, to, i / 10, pose);
      expect(out).toBe(pose);
      expect(out.position).toBe(position);
      expect(out.quaternion).toBe(quaternion);
    }
  });

  it("naiveLerpPose DIVERGES from slerp on dot < 0 pairs, interpolatePose does not", () => {
    // -178.8° -> 176.7°: true rotation is 4.5°, dot is negative.
    const from = state(0, 0, -178.8);
    const to = state(0, 0, 176.7);

    const good = interpolatePose(from, to, 0.5, createPose());
    const bad = naiveLerpPose(from, to, 0.5, createPose());

    // Midpoint of short arc is around -180.05° (i.e. +179.95°); long arc is exactly opposite.
    expect(good.quaternion.angleTo(bad.quaternion)).toBeGreaterThan(3);
    expect(bad.quaternion.length()).toBeCloseTo(1, 12); // normalized but on wrong arc
  });
});
