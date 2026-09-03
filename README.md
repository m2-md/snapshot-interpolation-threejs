# Snapshot Interpolation — Uzak Oyuncuyu Geçmişte Çizmek

"Uzak Oyuncuyu Geçmişte Çizmek: Three.js'te Snapshot Tamponu, Slerp ve Gecikme
Pazarlığı" makalesinin çalışan kodu. Sunucu saniyede 15 kez konuşurken ekranın
saniyede 120 kez çizdiği durumda uzak varlıkları **geçmişte** çizen hattın tamamı:

1. **Tampon** — `SnapshotBuffer`: sıralı ekleme (sondan geriye tarama), yinelenen
   tick eleme, budama ve `renderTime`'ı kapsayan çifti bulma.
2. **Saat** — `ServerClockEstimator` (tek yönlü offset kestirimi) + `RenderClock`
   (`renderTime = serverNow - delay`, **asla geri gitmez**).
3. **İnterpolasyon** — pozisyon `Vector3.lerp`, dönüş `Quaternion.slerp`.
   Aynı alpha, farklı matematik.
4. **Ölçüm** — `InterpolationStats`: aç geçen kare, en uzun tek donma, en küçük
   tampon boyu.

Ağ **taklit**: `FakeTransport` tohumlu RNG ile gecikme, jitter, paket kaybı ve
(jitterden doğal olarak çıkan) sıra bozulması üretir. Gerçek WebSocket yok, `ws`
paketi yok, sunucu süreci yok.

**Bu depoda `Math.random()` yasak.** Tek rastgelelik kaynağı `src/rng.ts` içindeki
`mulberry32`. Bir test bunu kaynak taramasıyla doğruluyor.

## Sürümler

- `three@0.185.1` (r185) + `@types/three@0.185.1` — klasik `WebGLRenderer`, WebGPU yok.
- Vite 6 + TypeScript (strict) + Vitest, paket yöneticisi npm.
- Runtime bağımlılığı yalnızca `three`.

## Kurulum

```bash
npm install
```

## Test (çekirdek kanıt — tarayıcı gerekmez)

```bash
npm test
```

33 test yeşil olmalı. Snapshot interpolation'ın tamamı saf mantık: WebGL yok,
canvas yok, `requestAnimationFrame` yok. `THREE.Quaternion` ve `THREE.Vector3`
Node altında sorunsuz çalışıyor.

| Dosya | Test | Ne kanıtlıyor |
|---|---|---|
| `test/buffer.test.ts` | 7 | kapsayan çift + `alpha = 0.5` · snapshot'ın tam üstünde `between`/`alpha = 0` · `before`/`after`/`empty` · sırasız paket doğru yere giriyor · yinelenen tick eleniyor · `prune` kapsayan çiftin sol ucunu silmiyor · kapasite taşınca fosil paket tampona giremiyor |
| `test/slerp.test.ts` | 5 | `dot = -0.99923` (negatif) · `slerp` **4,50°**, bileşen lerp'i **355,50°** kat ediyor · `angleTo` toplamsallığı · `t=0` tam eşitlik, `t=1`'de `dot<0` iken sonuç `-qb` (`equals` false, `angleTo ≈ 3e-8`) · birim olmayan girdi 60°'yi **73,17°**'ye kaydırıyor |
| `test/transport.test.ts` | 3 | aynı tohum aynı dizi · kayıp oranı jitter akışını bozmuyor · ±60 ms jitter sıra bozulması üretiyor |
| `test/clock.test.ts` | 2 | `offset` penceredeki **en büyük** örnek · `renderTime` geri gitmiyor (`900 → 950 → 950 → 1100`) |
| `test/starvation.test.ts` | 3 | tohum determinizmi · gecikme ↑ ⇒ açlık ↓ · `delayMs`'in gerçekten etkisi var (`1051` vs `10` aç kare) |
| `test/interpolate.test.ts` | 4 | `alpha=0` tam eşitlik · `alpha=1` `toBeCloseTo` · kare başına sıfır tahsis · `naiveLerpPose` `dot<0` çiftinde `slerp`'ten sapıyor |
| `test/stats.test.ts` | 3 | `before` açlık sayılmıyor · `longestStarveMs` en uzun **ardışık** seriyi tutuyor (50 ms, toplam 100 ms değil) · `minBufferSize` başlangıçta sonsuz |
| `test/snapshot.test.ts` | 3 | `normalizeEntity` birim yapıyor · sıfır uzunluk `(0,0,0,1)`'e düşüyor · yerinde mutasyon |
| `test/float-lerp.test.ts` | 2 | patolojik çiftte `a + (b - a) !== b` · oyun ölçeğinde 200.000 örnekte sıfır sapma |
| `test/no-random.test.ts` | 1 | `src/` + `scripts/` altında (yorumlar hariç) `Math.random(` yok |

### Testler gerçekten koruyor mu? (mutasyon kaydı)

Her testin totoloji değil koruma olduğunu mutasyonla doğruladım: iddiayı boz →
kızarmalı → geri al. Denenen mutasyonlar ve sonuçları:

| Mutasyon | Sonuç |
|---|---|
| `three` içinde `slerp`'in `if ( dot < 0 )` negatiflemesini `if ( false )` yap | **4 test kızardı** (`slerp.test.ts` ×3, `interpolate.test.ts` ×1) |
| `prune` koşulu `items[1]` → `items[0]` | kızardı: "prune kapsayan çiftin sol ucunu ASLA silmez" |
| `insert`'ten yinelenen tick kontrolünü kaldır | kızardı: "yinelenen tick yok sayılır" |
| `insert`'ten sondan geriye taramayı kaldır | 2 test kızardı (sırasız ekleme + fosil paket) |
| `RenderClock.advance`'ten monoton kelepçeyi kaldır | kızardı: "renderTime asla geri gitmez" |
| `ServerClockEstimator.offset` max → min | kızardı: "offset ... EN BÜYÜK örneği alır" |
| jitter çekimini kayıp kontrolünün arkasına al | kızardı: "kayıp oranını değiştirmek jitter akışını BOZMAZ" |
| `outOfOrder` sayacını devre dışı bırak | kızardı: "yeterli jitter sıra bozulması üretir" |
| `normalizeEntity`'nin sıfır uzunluk korumasını kaldır | kızardı: "sıfır uzunluklu quaternion ... düşer" |
| `interpolatePose`'daki `slerp`'i bileşen lerp'iyle değiştir | kızardı: "naiveLerpPose ... slerp'ten SAPAR" |
| `stats`'ta açlık tanımını `kind !== "between"` yap | kızardı: "'before' AÇLIK SAYILMAZ" |
| `stats`'ta `runMs` sıfırlamasını kaldır | kızardı: "longestStarveMs en uzun ARDIŞIK seriyi tutar" |
| `simulate` içinde `RenderClock(options.delayMs)` → `RenderClock(0)` | kızardı: "delayMs gerçekten etki ediyor" |

İki mutasyon ilk turda **hayatta kaldı** ve iki yeni test yazdırdı:
`RenderClock(0)` (monotonluk testi `toBeLessThanOrEqual` olduğu için fark etmiyordu)
ve `stats`'ın açlık tanımı (hiç doğrudan testi yoktu). İkisi de artık kapalı.

Bir mutasyon kasıtlı olarak hayatta bırakıldı: `rollJitter`'ı `rollLoss` ile aynı
akış yapmak testleri kızartmıyor. Bu bir boşluk değil, ölçülmüş bir gerçek — tek
akışta bile her paket tam iki çekim tükettiği için jitter dizisi kayıp oranından
etkilenmiyor. Makale bu bulguyu düzeltilmiş hâliyle anlatıyor.

## Ölçüm (makaledeki açlık tablosu)

```bash
npm run bench
```

Sabitler: 15 Hz snapshot, 120 Hz render, 30 saniye (3600 kare), tohum 1337,
taban gecikme 60 ms. Hücre: `starvedFrames (longestStarveMs)`.

```
| `interpolationDelay` | Jitter ±0 ms | Jitter ±20 ms | Jitter ±40 ms | ±40 ms + %5 kayıp |
|---|---|---|---|---|
| 33 ms (0,5 aralık) | 1804 (67 ms) | 2844 (392 ms) | 3156 (658 ms) | 3178 (658 ms) |
| 67 ms (1,0 aralık) | 8 (67 ms) | 688 (75 ms) | 1596 (167 ms) | 1708 (242 ms) |
| 100 ms (1,5 aralık) | 8 (67 ms) | 19 (75 ms) | 504 (83 ms) | 652 (100 ms) |
| 133 ms (2,0 aralık) | 8 (67 ms) | 9 (75 ms) | 33 (83 ms) | 157 (83 ms) |
| 200 ms (3,0 aralık) | 8 (67 ms) | 9 (75 ms) | 10 (83 ms) | 10 (83 ms) |
```

Betik ayrıca her hücrenin ham sayılarını (oran, `starvedMs`, `minBufferSize`,
`delivered` / `dropped` / `outOfOrder`) ikinci bir tabloda basar.

**Bu sayılar duvar saatinden gelmiyor.** `simulate()` sabit adımlı sanal saatle
koşuyor; makine yükü, CPU hızı ve arka planda ne olduğu sonucu değiştirmiyor. İki
ardışık koşumun çıktısı `diff` ile bit birebir aynı — koşum yayılımı sıfır.

Her hücrenin altındaki `8 (67 ms)` tabanı açılış maliyeti: ilk snapshot 60 ms yolda
ve o süre boyunca tampon `empty`, yani 120 Hz'de 8 kare. Isınma penceresiyle
gizlenebilirdi; gizlenmedi.

Ölçüm ortamı: Node v22.22.2, macOS (Darwin 25.5), Apple Silicon.

## Çalıştırma (görsel demo)

```bash
npm run dev -- --port 5218
```

Tarayıcıda `http://localhost:5218/` açılır. **`file://` ile AÇMA** — Vite bare
module specifier'ları çözer; dev sunucusu olmadan boş ekran görürsün.

Demo bilerek **hafif**: toplam 8 küp (4 uzak varlık × 2 görünüm), tek `GridHelper`,
bloom/post-process yok, gölge yok, otomatik süpürme yok.

- **Sol küme (cyan)** — naif yol: snapshot geldiği anda ışınlanır. Kesik kesik atlar;
  jitter yükseltilince ara sıra geri sıçrar.
- **Sağ küme (violet)** — tamponlu yol: kapsayan çift + `lerp`/`slerp`. Akar.
  Tampon boşalınca **donar** (titremez).

### Kontroller (hepsi elle)

| Kaydırıcı / düğme | Aralık | İş |
|---|---|---|
| `SNAPSHOT RATE` | 5–30 Hz | sahte sunucunun yayın hızı |
| `INTERPOLATION DELAY` | 0–300 ms | `renderTime = serverNow - delay` |
| `LATENCY` | 0–200 ms | taban tek yönlü gecikme |
| `JITTER` | 0–80 ms | gecikme oynaklığı (±) — sıra bozulmasının kaynağı |
| `LOSS RATE` | %0–30 | paket kaybı |
| `NAIVE QUAT LERP` | onay kutusu | sağ kümeyi bilerek yanlış `naiveLerpPose`'a çevirir |
| `Ölç (10 s)` | düğme | sayaçları sıfırlar, 10 saniye sayar, sonucu dondurur |

Kendiliğinden koşan hiçbir ölçüm yok — düğmeye basılmadan sayaç sıfırlanmaz.

### HUD: ÖLÇÜLEN ile MODEL ayrı

Panel iki bloklu ve bu kozmetik değil:

- **MEASURED** — bu koşumda gerçekten sayılmış değerler: `SNAPSHOTS RECEIVED`,
  `DROPPED`, `OUT OF ORDER`, `BUFFER SIZE`, `MIN BUFFER SIZE`, `STARVED FRAMES`,
  `STARVED RATIO`, `LONGEST STARVE`, `CURRENT ALPHA`. Hiçbiri sabit yazılı değil;
  hepsi `transport` / `buffer` / `stats` nesnelerinden okunuyor.
- **MODEL** — kaydırıcılardan gelen yapısal ayarlar: `SNAPSHOT RATE`,
  `INTERPOLATION DELAY`, `RECOMMENDED DELAY`, `LATENCY`, `JITTER`, `LOSS RATE`.
  Bunlar ölçüm **değil**.

⚠️ HUD etiketleri kaynakta **zaten büyük** yazılmıştır ve CSS'te `text-transform`
kullanılmaz. `text-transform: uppercase` + `lang="tr"` İngilizce `i` harfini `İ`
yapar: `INTERPOLATION` → `İNTERPOLATİON`.

## Build

```bash
npm run build
```

`tsc && vite build`. `vite.config.ts` hedefi `esnext`'e çeker.

## Dosya yapısı

```
src/
  snapshot.ts      # ÇEKİRDEK: EntityState, Snapshot, createEntityState, normalizeEntity
  buffer.ts        # ÇEKİRDEK: SnapshotBuffer — insert / prune / sampleAt, 4 SampleKind
  clock.ts         # ÇEKİRDEK: ServerClockEstimator (max örnek) + RenderClock (monoton)
  interpolate.ts   # ÇEKİRDEK: interpolatePose (lerp + slerp) + naiveLerpPose (KARŞI ÖRNEK)
  stats.ts         # ÇEKİRDEK: InterpolationStats — açlık sayacı, en uzun kesinti
  delay.ts         # recommendedDelay(interval, jitter, lossTolerance)
  rng.ts           # mulberry32 — bu depodaki TEK rastgelelik kaynağı
  transport.ts     # FakeTransport — tohumlu gecikme/jitter/kayıp, iki RNG akışı
  world.ts         # poseAt (atan2 ile SARILMIŞ yaw), REMOTES, FakeServer
  remote-view.ts   # tarayıcı: Object3D + pose bağlama (applyLatest / applySample)
  hud.ts           # tarayıcı: MEASURED / MODEL iki bloklu panel
  main.ts          # demo: sahne, kaydırıcılar, "Ölç" düğmesi, kare döngüsü
  style.css
scripts/
  starvation-bench.ts   # simulate() + `npm run bench` tablosu
test/
  buffer.test.ts  clock.test.ts  float-lerp.test.ts  interpolate.test.ts
  no-random.test.ts  slerp.test.ts  snapshot.test.ts  starvation.test.ts
  stats.test.ts  transport.test.ts
```

`main.ts`, `hud.ts`, `remote-view.ts`, `style.css` dışındaki her şey DOM'suz:
testler ve bench Node altında koşar.

## Alınan dersler (makalede de anlatılır)

- `prune`'un koşulu `items[1].serverTime <= renderTime` olmalı. `items[0]`'a
  bakarsanız interpolasyonun sol ucunu her karede kendi elinizle silersiniz ve
  `sampleAt` sürekli `"before"` döner.
- `sampleAt` sondan geriye tarar; bunun gözlemlenebilir sonucu, `renderTime` bir
  snapshot'ın tam üstündeyken `from` = **o** snapshot ve `alpha = 0` olmasıdır
  (bir öncekiyle `alpha = 1` değil).
- `three@0.185.1`'de `Quaternion.slerp`, `dot < 0` durumunda hedefi **koşulsuz**
  negatifler (`src/math/Quaternion.js` satır 725–734). `slerpFlat` de aynı korumaya
  sahip (satır 76). Kısa yol garantidir — kendi `slerp`'inizi yazmadıkça.
- r185'te `t === 0` / `t === 1` için **erken çıkış yok**. `t = 1` + `dot < 0`
  durumunda sonuç `-qb`: `equals(b)` **false**, `angleTo(b) ≈ 2.98e-8`. Test bu
  yüzden `toBeCloseTo(0, 6)` kullanıyor, `toEqual` değil.
- `angleTo` `Math.abs(dot)` kullandığı için hep 180°'nin altını raporlar; "kısa
  yoldan gitti mi" sorusunu tek başına cevaplayamaz. Toplamsallığı test edin.
- `slerp` girdilerin birim olduğunu varsayar. 1,5 katına ölçeklenmiş bir hedefle
  60°'lik interpolasyon **73,17°**'ye kayıyor ve sonucun uzunluğu 1,165 çıkıyor.
  Normalizasyonu **deserialize anında** yapın, kare başına değil.
- `Vector3.lerp`'in içi `a + (b - a) * t`. `alpha = 1`'de sonuç IEEE 754 gereği
  `b`'ye tam eşit olmak zorunda değil; uçlarda `toBe` yerine `toBeCloseTo` kullanın.
- Sahte taşımada jitter'ı **her** pakette çekin, düşenlerde bile. Yükü taşıyan
  karar bu; iki ayrı RNG akışı tek başına yeterli değil (mutasyonla ölçüldü).
- Sıra bozulması için ayrı bir düğmeye gerek yok — yeterli jitter onu kendiliğinden
  üretir (`±40 ms`'te 30 saniyede 5 kez).
- Kare döngüsünün ilk satırı `const dt = Math.min(rawDt, 100)`. Sekme arka plandan
  dönünce `rawDt` saniyeler olur ve sahte sunucu tek karede snapshot seli üretir.
  `FakeServer`'daki `guard` ikinci savunma hattı.

## Lisans

MIT — bkz. `LICENSE`.
