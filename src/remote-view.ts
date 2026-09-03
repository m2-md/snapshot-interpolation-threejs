import type { Object3D } from "three";
import type { Sample } from "./buffer";
import { createPose, interpolatePose, naiveLerpPose } from "./interpolate";
import type { Pose } from "./interpolate";
import type { EntityState, Snapshot } from "./snapshot";

/** Visual representation of a remote entity: an Object3D + a per-frame reused pose. */
export class RemoteView {
  readonly pose: Pose = createPose();

  constructor(
    readonly id: number,
    readonly object: Object3D,
  ) {}

  private commit(): void {
    this.object.position.copy(this.pose.position);
    this.object.quaternion.copy(this.pose.quaternion);
  }

  /** NAIVE path: teleport to wherever snapshot specifies. Jittery stutter. */
  applyLatest(snapshot: Snapshot | null): boolean {
    const state = snapshot ? findEntity(snapshot, this.id) : null;
    if (!state) return false;
    this.pose.position.set(state.px, state.py, state.pz);
    this.pose.quaternion.set(state.qx, state.qy, state.qz, state.qw);
    this.commit();
    return true;
  }

  /**
   * BUFFERED path: enclosing pair + alpha.
   * In `before`/`after` cases where from === to, naturally clamps to the endpoint.
   */
  applySample(sample: Sample<Snapshot>, naiveQuat = false): boolean {
    if (!sample.from || !sample.to) return false;
    const from = findEntity(sample.from, this.id);
    const to = findEntity(sample.to, this.id);
    if (!from || !to) return false;

    if (naiveQuat) naiveLerpPose(from, to, sample.alpha, this.pose);
    else interpolatePose(from, to, sample.alpha, this.pose);

    this.commit();
    return true;
  }
}

export function findEntity(snapshot: Snapshot, id: number): EntityState | null {
  for (const entity of snapshot.entities) {
    if (entity.id === id) return entity;
  }
  return null;
}
