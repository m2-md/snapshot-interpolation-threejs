import { createEntityState } from "./snapshot";
import type { EntityState, Snapshot } from "./snapshot";

export interface RemoteConfig {
  id: number;
  radius: number;
  speed: number; // rad/s
  phase: number;
  y: number;
}

export function poseAt(cfg: RemoteConfig, serverTimeMs: number, out: EntityState): EntityState {
  const a = cfg.phase + (serverTimeMs / 1000) * cfg.speed;

  out.id = cfg.id;
  out.px = Math.cos(a) * cfg.radius;
  out.py = cfg.y;
  out.pz = Math.sin(a) * cfg.radius;

  // Tangent heading. atan2 wraps angle to (-π, π]; hence quaternion
  // sign flips once per revolution and dot product drops below zero.
  // This line is why we can demonstrate the slerp trap in the demo.
  const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
  const half = yaw * 0.5;

  out.qx = 0;
  out.qy = Math.sin(half);
  out.qz = 0;
  out.qw = Math.cos(half);
  return out;
}

/** Four remote "players". Because the demo renders two clusters, there are 8 cubes in total on stage. */
export const REMOTES: readonly RemoteConfig[] = [
  { id: 1, radius: 3.2, speed: 0.9, phase: 0, y: 0.5 },
  { id: 2, radius: 2.1, speed: -1.35, phase: 1.9, y: 0.5 },
  { id: 3, radius: 4.0, speed: 0.55, phase: 3.4, y: 0.5 },
  { id: 4, radius: 1.4, speed: 2.1, phase: 5.1, y: 0.5 },
];

/**
 * Fixed-step mock server. Tracks `nextAt` instead of an accumulator: even if dt spikes,
 * snapshot timestamps will not drift. `guard` is the second line of defense —
 * prevents a flood of snapshots in a single frame when returning from a background tab.
 */
export class FakeServer {
  tick = 0;
  private nextAt: number;

  constructor(
    private readonly configs: readonly RemoteConfig[],
    public intervalMs: number,
    startTime = 0,
  ) {
    this.nextAt = startTime;
  }

  get pendingAt(): number {
    return this.nextAt;
  }

  /** Generates snapshots accumulated up to serverTime and emits them. */
  update(serverTime: number, emit: (snapshot: Snapshot, emittedAt: number) => void): number {
    let emitted = 0;
    let guard = 0;
    while (serverTime >= this.nextAt && guard++ < 64) {
      const at = this.nextAt;
      emit(this.snapshotAt(at), at);
      this.nextAt += this.intervalMs;
      emitted++;
    }
    return emitted;
  }

  private snapshotAt(serverTime: number): Snapshot {
    const entities: EntityState[] = [];
    for (const cfg of this.configs) {
      entities.push(poseAt(cfg, serverTime, createEntityState(cfg.id)));
    }
    return { tick: this.tick++, serverTime, entities };
  }
}
