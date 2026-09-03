export class ServerClockEstimator {
  private readonly samples: number[] = [];

  constructor(private readonly windowSize = 32) {}

  addSample(serverTime: number, clientRecvTime: number): void {
    this.samples.push(serverTime - clientRecvTime);
    if (this.samples.length > this.windowSize) this.samples.shift();
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  /** Packet with minimal latency in window = maximum offset sample. */
  get offset(): number {
    if (this.samples.length === 0) return 0;
    let max = this.samples[0];
    for (let i = 1; i < this.samples.length; i++) {
      if (this.samples[i] > max) max = this.samples[i];
    }
    return max;
  }

  serverNow(clientNow: number): number {
    return clientNow + this.offset;
  }
}

export class RenderClock {
  private last = Number.NEGATIVE_INFINITY;

  constructor(public delayMs: number) {}

  /** renderTime = serverNow - delay, but NEVER moves backwards. */
  advance(serverNow: number): number {
    const target = serverNow - this.delayMs;
    if (target > this.last) this.last = target;
    return this.last;
  }

  get current(): number {
    return this.last;
  }
  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}
