/**
 * Buffer starvation benchmark harness — headless, seeded, deterministic.
 *
 * Runs the ENTIRE pipeline: FakeServer -> FakeTransport -> normalizeEntity ->
 * SnapshotBuffer.insert -> ServerClockEstimator.addSample -> RenderClock.advance ->
 * buffer.prune -> buffer.sampleAt -> stats.frame. No shortcuts.
 *
 * Time comes from a fixed-step virtual clock, not `performance.now()`;
 * therefore identical SimOptions produce bit-for-bit identical SimResult on every run.
 */
import { SnapshotBuffer } from "../src/buffer";
import { RenderClock, ServerClockEstimator } from "../src/clock";
import { normalizeEntity } from "../src/snapshot";
import type { Snapshot } from "../src/snapshot";
import { InterpolationStats } from "../src/stats";
import { FakeTransport } from "../src/transport";
import { FakeServer, REMOTES } from "../src/world";

export interface SimOptions {
  delayMs: number;
  jitterMs: number;
  lossRate: number;
  seed: number;
  seconds: number;
  rateHz?: number; // default 15
  renderHz?: number; // default 120
  latencyMs?: number; // default 60
}

export interface SimResult {
  frames: number;
  starvedFrames: number;
  starvedRatio: number;
  starvedMs: number;
  longestStarveMs: number;
  minBufferSize: number;
  delivered: number;
  dropped: number;
  outOfOrder: number;
}

/** Server clock is ahead of client clock by this amount. Estimator must discover this. */
const TRUE_OFFSET_MS = 1000;

export function simulate(options: SimOptions): SimResult {
  const rateHz = options.rateHz ?? 15;
  const renderHz = options.renderHz ?? 120;
  const latencyMs = options.latencyMs ?? 60;

  const stepMs = 1000 / renderHz;
  const intervalMs = 1000 / rateHz;
  const frames = Math.round(options.seconds * renderHz);

  const server = new FakeServer(REMOTES, intervalMs, TRUE_OFFSET_MS);
  const transport = new FakeTransport<Snapshot>({
    latencyMs,
    jitterMs: options.jitterMs,
    lossRate: options.lossRate,
    seed: options.seed,
  });
  const buffer = new SnapshotBuffer<Snapshot>();
  const estimator = new ServerClockEstimator();
  const renderClock = new RenderClock(options.delayMs);
  const stats = new InterpolationStats();

  for (let f = 0; f < frames; f++) {
    const clientNow = f * stepMs;
    const serverTime = clientNow + TRUE_OFFSET_MS;

    // Server: produce accumulated ticks and send to wire. Packet departs
    // mapped to the client clock moment when stamped.
    server.update(serverTime, (snapshot, emittedAt) => {
      transport.send(snapshot, emittedAt - TRUE_OFFSET_MS);
    });

    // Client: receive arrived packets.
    for (const snapshot of transport.poll(clientNow)) {
      for (const entity of snapshot.entities) normalizeEntity(entity);
      estimator.addSample(snapshot.serverTime, clientNow);
      buffer.insert(snapshot);
    }

    const renderTime = renderClock.advance(estimator.serverNow(clientNow));
    buffer.prune(renderTime);
    const sample = buffer.sampleAt(renderTime);
    stats.frame(sample.kind, stepMs, buffer.size);
  }

  return {
    frames: stats.frames,
    starvedFrames: stats.starvedFrames,
    starvedRatio: stats.starvedRatio,
    starvedMs: stats.starvedMs,
    longestStarveMs: stats.longestStarveMs,
    minBufferSize: stats.minBufferSize,
    delivered: transport.delivered,
    dropped: transport.dropped,
    outOfOrder: transport.outOfOrder,
  };
}

const DELAYS = [33, 67, 100, 133, 200];
const COLUMNS: { label: string; jitterMs: number; lossRate: number }[] = [
  { label: "Jitter ±0 ms", jitterMs: 0, lossRate: 0 },
  { label: "Jitter ±20 ms", jitterMs: 20, lossRate: 0 },
  { label: "Jitter ±40 ms", jitterMs: 40, lossRate: 0 },
  { label: "±40 ms + 5% loss", jitterMs: 40, lossRate: 0.05 },
];

const ROW_LABEL: Record<number, string> = {
  33: "33 ms (0.5 intervals)",
  67: "67 ms (1.0 interval)",
  100: "100 ms (1.5 intervals)",
  133: "133 ms (2.0 intervals)",
  200: "200 ms (3.0 intervals)",
};

function main(): void {
  const seconds = 30;
  const seed = 1337;
  const rateHz = 15;
  const renderHz = 120;
  const latencyMs = 60;

  console.log(
    `# Buffer starvation — ${rateHz} Hz snapshot, ${renderHz} Hz render, ` +
      `${seconds} s, seed ${seed}, baseline latency ${latencyMs} ms`,
  );
  console.log(`# Cell: starvedFrames (longestStarveMs). Total frames: ${seconds * renderHz}`);
  console.log("");
  console.log(`| \`interpolationDelay\` | ${COLUMNS.map((c) => c.label).join(" | ")} |`);
  console.log(`|---|${COLUMNS.map(() => "---").join("|")}|`);

  for (const delayMs of DELAYS) {
    const cells = COLUMNS.map((col) => {
      const r = simulate({
        delayMs,
        jitterMs: col.jitterMs,
        lossRate: col.lossRate,
        seed,
        seconds,
        rateHz,
        renderHz,
        latencyMs,
      });
      return `${r.starvedFrames} (${Math.round(r.longestStarveMs)} ms)`;
    });
    console.log(`| ${ROW_LABEL[delayMs]} | ${cells.join(" | ")} |`);
  }

  console.log("");
  console.log("## Raw numbers for same run");
  console.log("");
  console.log(
    "| delay | jitter | loss | frames | starved | ratio | starvedMs | longest | minBuf | delivered | dropped | outOfOrder |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const delayMs of DELAYS) {
    for (const col of COLUMNS) {
      const r = simulate({
        delayMs,
        jitterMs: col.jitterMs,
        lossRate: col.lossRate,
        seed,
        seconds,
        rateHz,
        renderHz,
        latencyMs,
      });
      console.log(
        `| ${delayMs} | ±${col.jitterMs} | ${(col.lossRate * 100).toFixed(0)}% | ${r.frames} | ` +
          `${r.starvedFrames} | ${(r.starvedRatio * 100).toFixed(2)}% | ` +
          `${r.starvedMs.toFixed(1)} | ${r.longestStarveMs.toFixed(1)} | ${r.minBufferSize} | ` +
          `${r.delivered} | ${r.dropped} | ${r.outOfOrder} |`,
      );
    }
  }
}

// `npm run bench` prints the table; `npm test` imports this file and must stay silent.
// vite-node strips the script path from process.argv, so differentiation is done via
// the VITEST environment variable (vitest sets it to "true").
if (!process.env.VITEST) {
  main();
}
