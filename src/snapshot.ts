export interface EntityState {
  id: number;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface Snapshot {
  tick: number;
  serverTime: number; // ms, server clock
  entities: EntityState[];
}

/** Empty entity state (with identity quaternion). */
export function createEntityState(id = 0): EntityState {
  return { id, px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
}

export function normalizeEntity(e: EntityState): EntityState {
  const len = Math.sqrt(e.qx * e.qx + e.qy * e.qy + e.qz * e.qz + e.qw * e.qw);
  if (len === 0) {
    e.qx = 0;
    e.qy = 0;
    e.qz = 0;
    e.qw = 1; // identity quaternion
    return e;
  }
  const inv = 1 / len;
  e.qx *= inv;
  e.qy *= inv;
  e.qz *= inv;
  e.qw *= inv;
  return e;
}
