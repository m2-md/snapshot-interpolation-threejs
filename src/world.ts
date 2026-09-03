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

  // Teğet yön. atan2 açıyı (-π, π] aralığına SARAR; bu yüzden quaternion'un
  // işareti tur başına bir kez atlar ve dot çarpımı negatife düşer.
  // Slerp tuzağını demoda görebilmemizin sebebi bu satır.
  const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
  const half = yaw * 0.5;

  out.qx = 0;
  out.qy = Math.sin(half);
  out.qz = 0;
  out.qw = Math.cos(half);
  return out;
}

/** Dört uzak "oyuncu". Demo iki küme çizdiği için sahnede toplam 8 küp olur. */
export const REMOTES: readonly RemoteConfig[] = [
  { id: 1, radius: 3.2, speed: 0.9, phase: 0, y: 0.5 },
  { id: 2, radius: 2.1, speed: -1.35, phase: 1.9, y: 0.5 },
  { id: 3, radius: 4.0, speed: 0.55, phase: 3.4, y: 0.5 },
  { id: 4, radius: 1.4, speed: 2.1, phase: 5.1, y: 0.5 },
];

/**
 * Sabit adımlı sahte sunucu. Akümülatör yerine `nextAt` tutar: dt şişse bile
 * snapshot zaman damgaları kayma biriktirmez. `guard` ikinci savunma hattı —
 * sekme arka plandan dönünce tek karede snapshot seli üretilmesini engeller.
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

  /** serverTime'a kadar biriken snapshot'ları üretir ve emit'e verir. */
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
