import type { SampleKind } from "./buffer";

export class InterpolationStats {
  frames = 0;
  starvedFrames = 0;
  starvedMs = 0;
  longestStarveMs = 0;
  minBufferSize = Number.POSITIVE_INFINITY;
  private runMs = 0;

  frame(kind: SampleKind, dtMs: number, bufferSize: number): void {
    this.frames++;
    if (bufferSize < this.minBufferSize) this.minBufferSize = bufferSize;

    // "after" = renderTime passed the newest snapshot = out of fresh data.
    if (kind === "after" || kind === "empty") {
      this.starvedFrames++;
      this.starvedMs += dtMs;
      this.runMs += dtMs;
      if (this.runMs > this.longestStarveMs) this.longestStarveMs = this.runMs;
    } else {
      this.runMs = 0;
    }
  }

  get starvedRatio(): number {
    return this.frames === 0 ? 0 : this.starvedFrames / this.frames;
  }

  reset(): void {
    this.frames = 0;
    this.starvedFrames = 0;
    this.starvedMs = 0;
    this.longestStarveMs = 0;
    this.minBufferSize = Number.POSITIVE_INFINITY;
    this.runMs = 0;
  }
}
