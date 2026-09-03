# Snapshot Interpolation — Drawing the Remote Player in the Past

Working code for the article "Drawing the Remote Player in the Past: Snapshot Buffer,
Slerp and the Latency Bargain in Three.js". When the server speaks 15 times a second
while the screen draws 120 times a second, this is the whole pipeline that draws
remote entities **in the past**:

1. **The buffer** — `SnapshotBuffer`: ordered insertion (scanning backwards from the
   end), duplicate tick elimination, pruning, and finding the pair that encloses
   `renderTime`.
2. **The clock** — `ServerClockEstimator` (one-way offset estimation) + `RenderClock`
   (`renderTime = serverNow - delay`, **never goes backwards**).
3. **Interpolation** — position via `Vector3.lerp`, rotation via `Quaternion.slerp`.
   Same alpha, different math.
4. **Measurement** — `InterpolationStats`: starved frames, the longest single freeze,
   the minimum buffer size.

The network is **faked**: `FakeTransport` produces latency, jitter, packet loss and
(naturally falling out of the jitter) reordering with a seeded RNG. There is no real
WebSocket, no `ws` package, no server process.

**`Math.random()` is banned in this repo.** The only source of randomness is
`mulberry32` in `src/rng.ts`. A test verifies this by scanning the source.

## Versions

- `three@0.185.1` (r185) + `@types/three@0.185.1` — classic `WebGLRenderer`, no WebGPU.
- Vite 6 + TypeScript (strict) + Vitest, package manager npm.
- The only runtime dependency is `three`.

## Install

```bash
npm install
```

## Test (the core proof — no browser needed)

```bash
npm test
```

33 tests must be green. All of snapshot interpolation is pure logic: no WebGL, no
canvas, no `requestAnimationFrame`. `THREE.Quaternion` and `THREE.Vector3` run fine
under Node.

| File | Tests | What it proves |
|---|---|---|
| `test/buffer.test.ts` | 7 | the enclosing pair + `alpha = 0.5` · exactly on top of a snapshot, `between`/`alpha = 0` · `before`/`after`/`empty` · an out-of-order packet lands in the right place · duplicate ticks are eliminated · `prune` does not delete the left end of the enclosing pair · once capacity is exceeded, a fossil packet cannot enter the buffer |
| `test/slerp.test.ts` | 5 | `dot = -0.99923` (negative) · `slerp` traverses **4.50°**, component-wise lerp **355.50°** · `angleTo` additivity · exact equality at `t=0`, at `t=1` with `dot<0` the result is `-qb` (`equals` false, `angleTo ≈ 3e-8`) · non-unit input shifts 60° to **73.17°** |
| `test/transport.test.ts` | 3 | same seed, same sequence · the loss rate does not disrupt the jitter stream · ±60 ms jitter produces reordering |
| `test/clock.test.ts` | 2 | `offset` is the **largest** sample in the window · `renderTime` does not go backwards (`900 → 950 → 950 → 1100`) |
| `test/starvation.test.ts` | 3 | seed determinism · delay ↑ ⇒ starvation ↓ · `delayMs` really has an effect (`1051` vs `10` starved frames) |
| `test/interpolate.test.ts` | 4 | `alpha=0` exact equality · `alpha=1` `toBeCloseTo` · zero per-frame allocation · `naiveLerpPose` diverges from `slerp` on a `dot<0` pair |
| `test/stats.test.ts` | 3 | `before` is not counted as starvation · `longestStarveMs` tracks the longest **consecutive** streak (50 ms, not the 100 ms total) · `minBufferSize` starts out infinite |
| `test/snapshot.test.ts` | 3 | `normalizeEntity` makes it unit · zero length falls back to `(0,0,0,1)` · mutates in place |
| `test/float-lerp.test.ts` | 2 | on a pathological pair `a + (b - a) !== b` · zero deviation over 200,000 samples at game scale |
| `test/no-random.test.ts` | 1 | no `Math.random(` under `src/` + `scripts/` (comments excluded) |

### Do the tests actually protect anything? (mutation log)

I verified with mutation that each test is protection, not a tautology: break the
claim → it must go red → revert. The mutations tried and their results:

| Mutation | Result |
|---|---|
| turn `slerp`'s `if ( dot < 0 )` negation into `if ( false )` inside `three` | **4 tests went red** (`slerp.test.ts` ×3, `interpolate.test.ts` ×1) |
| `prune` condition `items[1]` → `items[0]` | red: "prune NEVER deletes the left end of enclosing pair" |
| remove the duplicate tick check from `insert` | red: "ignores duplicate ticks" |
| remove the backwards-from-the-end scan from `insert` | 2 tests red (out-of-order insertion + fossil packet) |
| remove the monotonic clamp from `RenderClock.advance` | red: "renderTime never moves backwards" |
| `ServerClockEstimator.offset` max → min | red: "takes the MAX sample in window as offset" |
| move the jitter draw behind the loss check | red: "changing loss rate DOES NOT disrupt jitter sequence" |
| disable the `outOfOrder` counter | red: "sufficient jitter produces out-of-order packets" |
| remove `normalizeEntity`'s zero-length guard | red: "zero-length quaternion falls back to identity" |
| replace the `slerp` in `interpolatePose` with a component-wise lerp | red: "naiveLerpPose DIVERGES from slerp" |
| make the starvation definition in `stats` `kind !== "between"` | red: "'before' is NOT COUNTED AS STARVATION" |
| remove the `runMs` reset in `stats` | red: "longestStarveMs tracks the longest CONSECUTIVE streak" |
| `RenderClock(options.delayMs)` → `RenderClock(0)` inside `simulate` | red: "delayMs has real effect" |

Two mutations **survived** the first round and forced two new tests:
`RenderClock(0)` (the monotonicity test used `toBeLessThanOrEqual`, so it did not
notice) and the starvation definition in `stats` (it had no direct test at all). Both
are closed now.

One mutation was deliberately left alive: making `rollJitter` share the same stream as
`rollLoss` does not turn the tests red. This is not a gap but a measured fact — even
on a single stream every packet consumes exactly two draws, so the jitter sequence is
unaffected by the loss rate. The article tells this finding in its corrected form.

## Measurement (the starvation table from the article)

```bash
npm run bench
```

Constants: 15 Hz snapshots, 120 Hz render, 30 seconds (3600 frames), seed 1337, base
latency 60 ms. Cell: `starvedFrames (longestStarveMs)`.

```
| `interpolationDelay` | Jitter ±0 ms | Jitter ±20 ms | Jitter ±40 ms | ±40 ms + 5% loss |
|---|---|---|---|---|
| 33 ms (0.5 intervals) | 1804 (67 ms) | 2844 (392 ms) | 3156 (658 ms) | 3178 (658 ms) |
| 67 ms (1.0 interval) | 8 (67 ms) | 688 (75 ms) | 1596 (167 ms) | 1708 (242 ms) |
| 100 ms (1.5 intervals) | 8 (67 ms) | 19 (75 ms) | 504 (83 ms) | 652 (100 ms) |
| 133 ms (2.0 intervals) | 8 (67 ms) | 9 (75 ms) | 33 (83 ms) | 157 (83 ms) |
| 200 ms (3.0 intervals) | 8 (67 ms) | 9 (75 ms) | 10 (83 ms) | 10 (83 ms) |
```

The script also prints the raw numbers of every cell (ratio, `starvedMs`,
`minBufferSize`, `delivered` / `dropped` / `outOfOrder`) in a second table.

**These numbers do not come from a wall clock.** `simulate()` runs on a fixed-step
virtual clock; machine load, CPU speed and whatever is running in the background do
not change the result. The output of two consecutive runs is bit-for-bit identical
under `diff` — run-to-run spread is zero.

The `8 (67 ms)` floor under every cell is the opening cost: the first snapshot is 60 ms
in flight and for that whole time the buffer is `empty`, which is 8 frames at 120 Hz.
It could have been hidden with a warmup window; it was not.

Measurement environment: Node v22.22.2, macOS (Darwin 25.5), Apple Silicon.

## Running it (visual demo)

```bash
npm run dev -- --port 5218
```

It opens at `http://localhost:5218/` in the browser. **DO NOT open it with `file://`** —
Vite resolves bare module specifiers; without the dev server you get a blank screen.

The demo is deliberately **light**: 8 cubes total (4 remote entities × 2 views), a
single `GridHelper`, no bloom/post-processing, no shadows, no auto sweep.

- **Left cluster (cyan)** — the naive path: it teleports the moment a snapshot arrives.
  It jumps in fits and starts; raise the jitter and it occasionally snaps backwards.
- **Right cluster (violet)** — the buffered path: the enclosing pair + `lerp`/`slerp`.
  It flows. When the buffer runs dry it **freezes** (it does not jitter).

### Controls (all manual)

| Slider / button | Range | Action |
|---|---|---|
| `SNAPSHOT RATE` | 5–30 Hz | the fake server's broadcast rate |
| `INTERPOLATION DELAY` | 0–300 ms | `renderTime = serverNow - delay` |
| `LATENCY` | 0–200 ms | base one-way latency |
| `JITTER` | 0–80 ms | latency variability (±) — the source of reordering |
| `LOSS RATE` | 0–30% | packet loss |
| `NAIVE QUAT LERP` | checkbox | deliberately switches the right cluster to the wrong `naiveLerpPose` |
| `Measure (10 s)` | button | resets the counters, counts for 10 seconds, freezes the result |

No measurement runs on its own — the counters are not reset until the button is
pressed.

### HUD: MEASURED is kept separate from MODEL

The panel has two blocks and this is not cosmetic:

- **MEASURED** — values actually counted in this run: `SNAPSHOTS RECEIVED`,
  `DROPPED`, `OUT OF ORDER`, `BUFFER SIZE`, `MIN BUFFER SIZE`, `STARVED FRAMES`,
  `STARVED RATIO`, `LONGEST STARVE`, `CURRENT ALPHA`. None of them are hardcoded; all
  are read from the `transport` / `buffer` / `stats` objects.
- **MODEL** — the structural settings coming from the sliders: `SNAPSHOT RATE`,
  `INTERPOLATION DELAY`, `RECOMMENDED DELAY`, `LATENCY`, `JITTER`, `LOSS RATE`. These
  are **not** measurements.

⚠️ The HUD labels are written **already uppercase** in the source and `text-transform`
is not used in the CSS. `text-transform: uppercase` + `lang="tr"` turns the English
letter `i` into `İ`: `INTERPOLATION` → `İNTERPOLATİON`.

## Build

```bash
npm run build
```

`tsc && vite build`. `vite.config.ts` pulls the target to `esnext`.

## File structure

```
src/
  snapshot.ts      # CORE: EntityState, Snapshot, createEntityState, normalizeEntity
  buffer.ts        # CORE: SnapshotBuffer — insert / prune / sampleAt, 4 SampleKinds
  clock.ts         # CORE: ServerClockEstimator (max sample) + RenderClock (monotonic)
  interpolate.ts   # CORE: interpolatePose (lerp + slerp) + naiveLerpPose (COUNTEREXAMPLE)
  stats.ts         # CORE: InterpolationStats — starvation counter, longest outage
  delay.ts         # recommendedDelay(interval, jitter, lossTolerance)
  rng.ts           # mulberry32 — the ONLY source of randomness in this repo
  transport.ts     # FakeTransport — seeded latency/jitter/loss, two RNG streams
  world.ts         # poseAt (yaw WRAPPED with atan2), REMOTES, FakeServer
  remote-view.ts   # browser: Object3D + pose binding (applyLatest / applySample)
  hud.ts           # browser: two-block MEASURED / MODEL panel
  main.ts          # demo: scene, sliders, "Measure" button, frame loop
  style.css
scripts/
  starvation-bench.ts   # simulate() + the `npm run bench` table
test/
  buffer.test.ts  clock.test.ts  float-lerp.test.ts  interpolate.test.ts
  no-random.test.ts  slerp.test.ts  snapshot.test.ts  starvation.test.ts
  stats.test.ts  transport.test.ts
```

Everything except `main.ts`, `hud.ts`, `remote-view.ts` and `style.css` is DOM-free:
the tests and the bench run under Node.

## Lessons learned (also told in the article)

- `prune`'s condition must be `items[1].serverTime <= renderTime`. Look at `items[0]`
  and you delete the left end of the interpolation with your own hand every frame, and
  `sampleAt` keeps returning `"before"`.
- `sampleAt` scans backwards from the end; the observable consequence is that when
  `renderTime` sits exactly on top of a snapshot, `from` is **that** snapshot and
  `alpha = 0` (not the previous one with `alpha = 1`).
- In `three@0.185.1`, `Quaternion.slerp` negates the target **unconditionally** when
  `dot < 0` (`src/math/Quaternion.js` lines 725–734). `slerpFlat` has the same guard
  (line 76). The short path is guaranteed — unless you write your own `slerp`.
- In r185 there is **no early exit** for `t === 0` / `t === 1`. With `t = 1` and
  `dot < 0` the result is `-qb`: `equals(b)` is **false**, `angleTo(b) ≈ 2.98e-8`. That
  is why the test uses `toBeCloseTo(0, 6)`, not `toEqual`.
- Because `angleTo` uses `Math.abs(dot)`, it always reports below 180°; it cannot
  answer "did it take the short path" on its own. Test its additivity.
- `slerp` assumes the inputs are unit. With a target scaled by 1.5×, a 60°
  interpolation shifts to **73.17°** and the result's length comes out at 1.165. Do the
  normalization **at deserialize time**, not per frame.
- The inside of `Vector3.lerp` is `a + (b - a) * t`. At `alpha = 1` the result is not
  required by IEEE 754 to be exactly equal to `b`; use `toBeCloseTo` instead of `toBe`
  at the ends.
- In a fake transport, draw the jitter on **every** packet, even the dropped ones. That
  is the decision carrying the load; two separate RNG streams alone are not enough
  (measured by mutation).
- You do not need a separate knob for reordering — enough jitter produces it on its own
  (5 times in 30 seconds at `±40 ms`).
- The first line of the frame loop is `const dt = Math.min(rawDt, 100)`. When the tab
  comes back from the background `rawDt` becomes seconds and the fake server produces a
  flood of snapshots in a single frame. The `guard` in `FakeServer` is the second line
  of defense.

## License

MIT — see `LICENSE`.
