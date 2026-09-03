import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/rng";

/** Implementation inside Vector3.lerp: this.x += (v.x - this.x) * alpha */
const lerp1 = (a: number, b: number, t: number) => a + (b - a) * t;

describe("floating point behavior at alpha = 1", () => {
  it("a + (b - a) is not exactly b when magnitudes diverge", () => {
    const a = 948276.8422458321;
    const b = 9.533007256686686e-8;

    expect(lerp1(a, b, 1)).toBe(9.534414857625961e-8);
    expect(lerp1(a, b, 1)).not.toBe(b);

    // same deviation appears on Vector3.lerp — not our arithmetic, three.js's.
    const v = new Vector3(a, 0, 0).lerp(new Vector3(b, 0, 0), 1);
    expect(v.x).toBe(9.534414857625961e-8);
  });

  it("zero deviation at game scale ([-100, 100], seed 1337, 200,000 samples)", () => {
    const rand = mulberry32(1337);
    let deviations = 0;
    for (let i = 0; i < 200_000; i++) {
      const a = rand() * 200 - 100;
      const b = rand() * 200 - 100;
      if (lerp1(a, b, 1) !== b) deviations++;
    }
    expect(deviations).toBe(0);
  });
});
