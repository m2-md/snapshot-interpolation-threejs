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
  it("alpha = 0'da sonuç TAM olarak 'from' (pozisyon ve dönüş)", () => {
    const from = state(-3, 7, -178.8);
    const to = state(9, -2, 176.7);
    const out = interpolatePose(from, to, 0, createPose());

    expect(out.position.x).toBe(from.px);
    expect(out.position.y).toBe(from.py);
    expect(out.position.z).toBe(from.pz);
    expect(out.quaternion.y).toBe(from.qy);
    expect(out.quaternion.w).toBe(from.qw);
  });

  it("alpha = 1'de sonuç 'to' — ama toBeCloseTo ile (a + (b - a) tam b değil)", () => {
    const from = state(-3, 7, 10);
    const to = state(9, -2, 40);
    const out = interpolatePose(from, to, 1, createPose());

    expect(out.position.x).toBeCloseTo(to.px, 12);
    expect(out.position.z).toBeCloseTo(to.pz, 12);
    // Dönüş aynı: bileşen eşitliği ARAMIYORUZ, açı farkına bakıyoruz.
    const target = new Quaternion(to.qx, to.qy, to.qz, to.qw);
    expect(out.quaternion.angleTo(target)).toBeCloseTo(0, 6);
  });

  it("kare başına tahsis yok: aynı 'out' nesnesi ve alanları geri dönüyor", () => {
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

  it("naiveLerpPose dot<0 çiftinde slerp'ten SAPAR, interpolatePose sapmaz", () => {
    // -178.8° -> 176.7°: gerçek dönüş 4,5°, dot negatif.
    const from = state(0, 0, -178.8);
    const to = state(0, 0, 176.7);

    const good = interpolatePose(from, to, 0.5, createPose());
    const bad = naiveLerpPose(from, to, 0.5, createPose());

    // Kısa yolun ortası -180,05° (yani +179,95°) civarı; uzun yolunki tam ters taraf.
    expect(good.quaternion.angleTo(bad.quaternion)).toBeGreaterThan(3);
    expect(bad.quaternion.length()).toBeCloseTo(1, 12); // normalize edilmiş ama yanlış yayda
  });
});
