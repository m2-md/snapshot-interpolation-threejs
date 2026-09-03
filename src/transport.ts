import { mulberry32 } from "./rng";

export interface TransportOptions {
  latencyMs: number;
  jitterMs: number;
  lossRate: number;
  seed: number;
}

interface InFlight<T> {
  payload: T;
  seq: number;
  arriveAt: number;
}

export class FakeTransport<T> {
  private readonly queue: InFlight<T>[] = [];
  private readonly rollLoss: () => number;
  private readonly rollJitter: () => number;
  private seq = 0;
  private lastDeliveredSeq = -1;

  sent = 0;
  dropped = 0;
  delivered = 0;
  outOfOrder = 0;

  latencyMs: number;
  jitterMs: number;
  lossRate: number;

  constructor(options: TransportOptions) {
    this.latencyMs = options.latencyMs;
    this.jitterMs = options.jitterMs;
    this.lossRate = options.lossRate;
    // İKİ AYRI akış: kayıp oranını değiştirmek jitter dizisini bozmasın.
    this.rollLoss = mulberry32(options.seed);
    this.rollJitter = mulberry32(options.seed ^ 0x9e37_79b9);
  }

  send(payload: T, now: number): boolean {
    const seq = this.seq++;
    this.sent++;

    const lossRoll = this.rollLoss();
    // Jitter HER pakette çekilir — düşen paketlerde bile. Akışların bağımsızlığı buna bağlı.
    const jitter = (this.rollJitter() * 2 - 1) * this.jitterMs;

    if (lossRoll < this.lossRate) {
      this.dropped++;
      return false;
    }

    this.queue.push({ payload, seq, arriveAt: now + Math.max(0, this.latencyMs + jitter) });
    return true;
  }

  /** now'a kadar varmış paketleri VARIŞ sırasına göre teslim eder. */
  poll(now: number): T[] {
    const ready: InFlight<T>[] = [];
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].arriveAt <= now) {
        ready.push(this.queue[i]);
        this.queue.splice(i, 1);
      }
    }
    ready.sort((a, b) => a.arriveAt - b.arriveAt || a.seq - b.seq);

    const out: T[] = [];
    for (const packet of ready) {
      if (packet.seq < this.lastDeliveredSeq) this.outOfOrder++;
      else this.lastDeliveredSeq = packet.seq;
      this.delivered++;
      out.push(packet.payload);
    }
    return out;
  }

  get inFlight(): number {
    return this.queue.length;
  }
}
