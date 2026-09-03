export type SampleKind = "empty" | "before" | "between" | "after";

export interface Timed {
  tick: number;
  serverTime: number;
}

export interface Sample<T extends Timed> {
  kind: SampleKind;
  from: T | null;
  to: T | null;
  alpha: number;
}

export class SnapshotBuffer<T extends Timed> {
  private readonly items: T[] = [];

  constructor(private readonly capacity = 32) {}

  get size(): number {
    return this.items.length;
  }
  get oldest(): T | null {
    return this.items[0] ?? null;
  }
  get newest(): T | null {
    return this.items.at(-1) ?? null;
  }
  toArray(): readonly T[] {
    return this.items;
  }

  /** Sıralı ekleme. Yinelenen tick yok sayılır. Dönüş: tampona girdi mi. */
  insert(snapshot: T): boolean {
    const items = this.items;
    // Sondan geriye tara: paketler ÇOĞUNLUKLA sıralı gelir, tarama tipik olarak 0 adım sürer.
    let i = items.length - 1;
    while (i >= 0 && items[i].serverTime > snapshot.serverTime) i--;

    if (i >= 0 && items[i].tick === snapshot.tick) return false; // yinelenen paket

    items.splice(i + 1, 0, snapshot);

    if (items.length > this.capacity) {
      const dropped = items.shift();
      // Çok geç gelen paket tamponun dibine düşer ve aynı karede taşar.
      if (dropped === snapshot) return false;
    }
    return true;
  }

  /** renderTime'ı kapsayan çiftten daha eskisini at. Bir tane geride kalır. */
  prune(renderTime: number): number {
    let removed = 0;
    while (this.items.length >= 2 && this.items[1].serverTime <= renderTime) {
      this.items.shift();
      removed++;
    }
    return removed;
  }

  sampleAt(renderTime: number): Sample<T> {
    const items = this.items;
    if (items.length === 0) return { kind: "empty", from: null, to: null, alpha: 0 };

    const oldest = items[0];
    if (renderTime <= oldest.serverTime) {
      return { kind: "before", from: oldest, to: oldest, alpha: 0 };
    }

    const newest = items[items.length - 1];
    if (renderTime >= newest.serverTime) {
      return { kind: "after", from: newest, to: newest, alpha: 0 };
    }

    for (let i = items.length - 1; i > 0; i--) {
      const a = items[i - 1];
      const b = items[i];
      if (a.serverTime <= renderTime && renderTime <= b.serverTime) {
        const span = b.serverTime - a.serverTime;
        return {
          kind: "between",
          from: a,
          to: b,
          alpha: span > 0 ? (renderTime - a.serverTime) / span : 0,
        };
      }
    }

    return { kind: "after", from: newest, to: newest, alpha: 0 }; // ulaşılmaz
  }
}
