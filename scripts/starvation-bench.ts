/**
 * Tampon açlığı ölçüm düzeneği — tarayıcısız, tohumlu, tekrarlanabilir.
 *
 * Hattın TAMAMI koşar: FakeServer -> FakeTransport -> normalizeEntity ->
 * SnapshotBuffer.insert -> ServerClockEstimator.addSample -> RenderClock.advance ->
 * buffer.prune -> buffer.sampleAt -> stats.frame. Kısayol yok.
 *
 * Zaman `performance.now()`'dan değil, sabit adımlı sanal saatten gelir; bu yüzden
 * aynı SimOptions her koşumda bit birebir aynı SimResult'ı verir.
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
  rateHz?: number; // varsayılan 15
  renderHz?: number; // varsayılan 120
  latencyMs?: number; // varsayılan 60
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

/** Sunucu saati istemci saatinden bu kadar ileride. Kestirimci bunu bulmak zorunda. */
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

    // Sunucu: biriken tick'leri üret ve tele ver. Paket, damgalandığı ANIN
    // istemci saati karşılığında yola çıkar.
    server.update(serverTime, (snapshot, emittedAt) => {
      transport.send(snapshot, emittedAt - TRUE_OFFSET_MS);
    });

    // İstemci: varmış paketleri al.
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
  { label: "±40 ms + %5 kayıp", jitterMs: 40, lossRate: 0.05 },
];

const ROW_LABEL: Record<number, string> = {
  33: "33 ms (0,5 aralık)",
  67: "67 ms (1,0 aralık)",
  100: "100 ms (1,5 aralık)",
  133: "133 ms (2,0 aralık)",
  200: "200 ms (3,0 aralık)",
};

function main(): void {
  const seconds = 30;
  const seed = 1337;
  const rateHz = 15;
  const renderHz = 120;
  const latencyMs = 60;

  console.log(
    `# Tampon açlığı — ${rateHz} Hz snapshot, ${renderHz} Hz render, ` +
      `${seconds} s, tohum ${seed}, taban gecikme ${latencyMs} ms`,
  );
  console.log(`# Hücre: starvedFrames (longestStarveMs). Toplam kare: ${seconds * renderHz}`);
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
  console.log("## Aynı koşumun ham sayıları");
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

// `npm run bench` tabloyu basar; `npm test` bu dosyayı sadece import ettiği için sessiz
// kalmalı. vite-node script yolunu process.argv'den siliyor, o yüzden ayrım VITEST
// değişkeniyle yapılıyor (vitest onu "true" olarak set eder).
if (!process.env.VITEST) {
  main();
}
