import { Quaternion, Vector3 } from "three";
import type { EntityState } from "./snapshot";

const _to = new Vector3();
const _qto = new Quaternion();

export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
}

export function createPose(): Pose {
  return { position: new Vector3(), quaternion: new Quaternion() };
}

/** Position on straight line, orientation on sphere. Same alpha, different mathematics. */
export function interpolatePose(
  from: EntityState,
  to: EntityState,
  alpha: number,
  out: Pose,
): Pose {
  out.position.set(from.px, from.py, from.pz);
  _to.set(to.px, to.py, to.pz);
  out.position.lerp(_to, alpha);

  out.quaternion.set(from.qx, from.qy, from.qz, from.qw);
  _qto.set(to.qx, to.qy, to.qz, to.qw);
  out.quaternion.slerp(_qto, alpha);

  return out;
}

/**
 * INTENTIONALLY flawed counter-example. Do not copy.
 * Lerps the quaternion component-wise and normalizes: the result stays on the 3-sphere
 * but does not advance at constant angular velocity and picks the LONG arc when dot < 0 (355.5° somersault).
 * The "NAIVE QUAT LERP" toggle in the demo activates this code path.
 */
export function naiveLerpPose(from: EntityState, to: EntityState, alpha: number, out: Pose): Pose {
  out.position.set(from.px, from.py, from.pz);
  _to.set(to.px, to.py, to.pz);
  out.position.lerp(_to, alpha);

  out.quaternion.set(
    from.qx + (to.qx - from.qx) * alpha,
    from.qy + (to.qy - from.qy) * alpha,
    from.qz + (to.qz - from.qz) * alpha,
    from.qw + (to.qw - from.qw) * alpha,
  );
  out.quaternion.normalize();

  return out;
}
