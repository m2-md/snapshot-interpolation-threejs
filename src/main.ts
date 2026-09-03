import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { SnapshotBuffer } from "./buffer";
import { RenderClock, ServerClockEstimator } from "./clock";
import { recommendedDelay } from "./delay";
import { Hud } from "./hud";
import { RemoteView } from "./remote-view";
import { normalizeEntity } from "./snapshot";
import type { Snapshot } from "./snapshot";
import { InterpolationStats } from "./stats";
import { FakeTransport } from "./transport";
import { FakeServer, REMOTES } from "./world";

// ---------------------------------------------------------------- sahne (hafif)
const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.setClearAlpha(0);

const scene = new Scene();
const camera = new PerspectiveCamera(46, 1, 0.1, 200);
// Kamera hedefi küplerin ÜSTÜNDE: bakılan nokta yükseldikçe sahne ekranda
// aşağı kayıyor ve iki küme, sağ/sol cam panellerin altındaki boş şeride
// düşüyor. Panelleri küçültmek yerine sahneyi indirmek daha sağlam — panel
// yüksekliği içeriğe göre değişir, kamera değişmez.
// Konum ve hedef `resize()` içinde en-boy oranından hesaplanıyor (aşağıda).

scene.add(new AmbientLight(0x5566aa, 0.9));
const key = new DirectionalLight(0xffffff, 1.5);
key.position.set(6, 12, 8);
scene.add(key);

const grid = new GridHelper(28, 28, 0x2a3550, 0x161d2e);
grid.position.y = 0;
scene.add(grid);

const NAIVE_X = -5.4;
const INTERP_X = 5.4;

const naiveGroup = new Group();
naiveGroup.position.x = NAIVE_X;
const interpGroup = new Group();
interpGroup.position.x = INTERP_X;
scene.add(naiveGroup, interpGroup);

const cube = new BoxGeometry(0.7, 0.7, 1.1); // uzun ekseni +Z: dönüş gözle görünür

function makeViews(group: Group, color: number, emissive: number): RemoteView[] {
  return REMOTES.map((cfg) => {
    const mesh = new Mesh(
      cube,
      new MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: 0.9,
        roughness: 0.35,
        metalness: 0.1,
      }),
    );
    group.add(mesh);
    return new RemoteView(cfg.id, mesh);
  });
}

const naiveViews = makeViews(naiveGroup, 0x0d3b47, 0x22d3ee);
const interpViews = makeViews(interpGroup, 0x2b2350, 0xa78bfa);

// ---------------------------------------------------------- ağ hattı (sahte, tohumlu)
const SEED = 1337;
let rateHz = 15;

const server = new FakeServer(REMOTES, 1000 / rateHz, 0);
const transport = new FakeTransport<Snapshot>({
  latencyMs: 60,
  jitterMs: 20,
  lossRate: 0,
  seed: SEED,
});
const buffer = new SnapshotBuffer<Snapshot>();
const estimator = new ServerClockEstimator();
const renderClock = new RenderClock(100);
const stats = new InterpolationStats();

let latest: Snapshot | null = null; // naif yolun tek hafızası
let lastAlpha = 0;
let lastKind = "empty";

// ------------------------------------------------------------------------- HUD
const hud = new Hud(document.getElementById("hud") as HTMLElement);

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const out = (id: string) => document.getElementById(id) as HTMLOutputElement;

const rateInput = $("rate");
const delayInput = $("delay");
const latencyInput = $("latency");
const jitterInput = $("jitter");
const lossInput = $("loss");
const naiveQuatInput = $("naive-quat");
const measureButton = document.getElementById("measure") as HTMLButtonElement;
const measureState = document.getElementById("measure-state") as HTMLElement;

function syncModel(): void {
  rateHz = Number(rateInput.value);
  server.intervalMs = 1000 / rateHz;
  renderClock.delayMs = Number(delayInput.value);
  transport.latencyMs = Number(latencyInput.value);
  transport.jitterMs = Number(jitterInput.value);
  transport.lossRate = Number(lossInput.value) / 100;

  out("rate-out").textContent = `${rateHz} Hz`;
  out("delay-out").textContent = `${renderClock.delayMs} ms`;
  out("latency-out").textContent = `${transport.latencyMs} ms`;
  out("jitter-out").textContent = `±${transport.jitterMs} ms`;
  out("loss-out").textContent = `%${Math.round(transport.lossRate * 100)}`;

  hud.set("SNAPSHOT RATE", `${rateHz} Hz · ${(1000 / rateHz).toFixed(1)} ms`);
  hud.set("INTERPOLATION DELAY", `${renderClock.delayMs} ms`);
  hud.set(
    "RECOMMENDED DELAY",
    `${Math.round(recommendedDelay(1000 / rateHz, transport.jitterMs))} ms`,
  );
  hud.set("LATENCY", `${transport.latencyMs} ms`);
  hud.set("JITTER", `±${transport.jitterMs} ms`);
  hud.set("LOSS RATE", `%${Math.round(transport.lossRate * 100)}`);
}

for (const input of [rateInput, delayInput, latencyInput, jitterInput, lossInput]) {
  input.addEventListener("input", syncModel);
}
syncModel();

// Ölçüm ELLE tetiklenir: sıfırla, 10 saniye say, sonucu dondur.
let measuringUntil = -1;
let frozen: string | null = null;

measureButton.addEventListener("click", () => {
  stats.reset();
  frozen = null;
  measuringUntil = clientNow + 10_000;
  measureButton.disabled = true;
  measureState.textContent = "Ölçülüyor…";
});

// ------------------------------------------------------------------- kare döngüsü
let clientNow = 0;
let lastFrameAt = performance.now();

function frame(now: number): void {
  const rawDt = now - lastFrameAt;
  lastFrameAt = now;
  // Sekme arka plandan dönünce rawDt saniyeler olur; kelepçelemezsek FakeServer
  // tek karede yüzlerce snapshot üretir. (guard ikinci savunma hattı.)
  const dt = Math.min(rawDt, 100);
  clientNow += dt;

  // Bu demoda sunucu saati = istemci saati + 0. Kestirimci yine de gerçek işini
  // yapıyor: örnekleri toplayıp offset'i tek yönlü gecikmeden türetiyor.
  server.update(clientNow, (snapshot, emittedAt) => {
    transport.send(snapshot, emittedAt);
  });

  for (const snapshot of transport.poll(clientNow)) {
    for (const entity of snapshot.entities) normalizeEntity(entity);
    estimator.addSample(snapshot.serverTime, clientNow);
    buffer.insert(snapshot);
    latest = snapshot;
  }

  const renderTime = renderClock.advance(estimator.serverNow(clientNow));
  buffer.prune(renderTime);
  const sample = buffer.sampleAt(renderTime);
  stats.frame(sample.kind, dt, buffer.size);

  lastAlpha = sample.alpha;
  lastKind = sample.kind;

  for (const view of naiveViews) view.applyLatest(latest);
  for (const view of interpViews) view.applySample(sample, naiveQuatInput.checked);

  if (measuringUntil > 0 && clientNow >= measuringUntil) {
    measuringUntil = -1;
    frozen =
      `${stats.starvedFrames}/${stats.frames} kare aç · ` +
      `en uzun ${stats.longestStarveMs.toFixed(0)} ms`;
    measureButton.disabled = false;
    measureState.textContent = `Sonuç: ${frozen}`;
  }

  writeHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function writeHud(): void {
  hud.set("SNAPSHOTS RECEIVED", String(transport.delivered));
  hud.set("DROPPED", String(transport.dropped));
  hud.set("OUT OF ORDER", String(transport.outOfOrder));
  hud.set("BUFFER SIZE", String(buffer.size));
  hud.set(
    "MIN BUFFER SIZE",
    Number.isFinite(stats.minBufferSize) ? String(stats.minBufferSize) : "—",
  );
  hud.set("STARVED FRAMES", `${stats.starvedFrames} / ${stats.frames}`);
  hud.set("STARVED RATIO", `%${(stats.starvedRatio * 100).toFixed(2)}`);
  hud.set("LONGEST STARVE", `${stats.longestStarveMs.toFixed(0)} ms`);
  hud.set("CURRENT ALPHA", `${lastAlpha.toFixed(3)} · ${lastKind}`);
}

/** Kadrajda tutulması gereken en uzak nokta: küme merkezi + en geniş yörünge. */
const HALF_SPREAD = INTERP_X + Math.max(...REMOTES.map((r) => r.radius));

/** Kamera hedefi küplerin ÜSTÜNDE: bakılan nokta yükseldikçe sahne ekranda
 *  aşağı kayıyor ve iki küme, sağ/sol cam panellerin altındaki boş şeride
 *  düşüyor. Panelleri küçültmek yerine sahneyi indirmek daha sağlam — panel
 *  yüksekliği içeriğe göre değişir, kamera değişmez. */
const TARGET_Y = 6;

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

  // Mesafeyi sabit yazmak dar-uzun bir pencerede dış küpleri kadrajdan taşırıyor:
  // yatay FOV, dikey FOV'dan aspect ile türüyor ve aspect < 1 olduğunda daralıyor.
  // Bu yüzden uzaklığı HALF_SPREAD'i sığdıracak şekilde HER YENİDEN BOYUTLANDIRMADA
  // hesaplıyoruz. %12 pay, küpün kendi yarım genişliği ve perspektif payı için.
  const halfV = (camera.fov * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  const distance = Math.max(18, (HALF_SPREAD * 1.12) / Math.tan(halfH));

  camera.position.set(0, TARGET_Y + distance * 0.14, distance);
  camera.lookAt(0, TARGET_Y, 0);
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);
resize();
requestAnimationFrame(frame);
