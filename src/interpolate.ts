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

/** Pozisyon düz çizgide, dönüş küre üstünde. Aynı alpha, farklı matematik. */
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
 * BİLEREK YANLIŞ karşı-örnek. Kopyalamayın.
 * Quaternion'u bileşen bileşen lerp edip normalize eder: sonuç yayın üstüne düşer
 * ama sabit hızda ilerlemez ve dot < 0 olduğunda UZUN yayı seçer (355,5°'lik takla).
 * Demodaki "NAIVE QUAT LERP" anahtarı bu yolu açar.
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
