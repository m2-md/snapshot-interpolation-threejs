# Uzak Oyuncuyu Geçmişte Çizmek: Three.js'te Snapshot Tamponu, Slerp ve Gecikme Pazarlığı

*Sunucu saniyede 15 kez konuşuyor, ekranınız saniyede 120 kez çiziyor. Aradaki boşluğu doldurmanın yolu uzak oyuncuyu "şimdi"de değil, ölçülü bir gecikmeyle geçmişte çizmekten geçiyor: sıralı bir snapshot tamponu, geri sarmayan bir render saati, pozisyon için lerp, dönüş için slerp — bir de `three` kaynağından sökeceğimiz bir quaternion tuzağı.*

*Tahmini okuma süresi: 17 dakika*

---

Bir maçı radyodan dinleyen komşunuz, siz televizyonda golü görmeden önce bağırır. Yayın gecikmelidir. Birkaç saniye geriden gelir. O birkaç saniye sayesinde uydu paketleri düzensiz düştüğünde görüntü kesilmez, akmaya devam eder.

İlk multiplayer prototipimde ben komşuyu seçmiştim. Sunucudan snapshot (durum anlık görüntüsü) geldiği anda küpü oraya koyuyordum. Sonuç: uzak oyuncular sekiz kare kıpırdamadan duruyor, dokuzuncu karede yirmi santim ileri sıçrıyordu. Buna bir isim koydum bile — "ağ kötü". Ağ gayet iyiydi. Saniyede 15 kez gelen bilgiyi saniyede 120 kareye yaymayı beceremiyordum.

Uzak oyuncuları izlerken **yayın izliyorsunuz**, canlı değil. İyi bir yayının gizli malzemesi de ölçülü bir gecikmedir.

Kapsamı en baştan çizeyim. Bu yazı yalnızca **uzak** varlıklarla ilgileniyor. Kendi karakterinizin gecikmesiz hissetmesini sağlayan client-side prediction (istemci tarafı tahmin), server reconciliation (sunucu uzlaştırması) ve rollback konularını Canvas serisindeki netcode üçlemesinde işlemiştik; burada onları tekrar anlatmayacağım. Snapshot interpolation onların rakibi de değil, tamamlayıcısı: kendi karakteriniz tahminle çizilir, geri kalan herkes tamponla.

Yol haritası şu. Önce naif çözümün neden lastik bant (rubber-banding) ürettiğini, "sadece yumuşatsak olmaz mı" fikrinin nerede çuvalladığını konuşacağız. Sonra tamponu kurup pozisyonu `lerp`, dönüşü `slerp` edeceğiz — aynı alpha, farklı matematik. Asıl tuzak ondan sonra geliyor: `three@0.185.1` kaynağındaki `Quaternion.slerp`'i satır satır okuyup kısa yolu gerçekten seçip seçmediğine bakacağız. En sonda da gecikme payını tartmak yerine ölçen bir düzenek var.

Gerçek ağ yok. WebSocket sunucusu yok. Bunun yerine tohumlu bir RNG ile gecikme, jitter (gecikme oynaklığı), paket kaybı ve sıra bozulması üreten sahte bir transport (taşıma katmanı) yazacağız. Böylece bütün hat Node altında, tarayıcısız, deterministik biçimde test edilebiliyor. Bu depoda `Math.random()` yasak.

Sürüm notu: `three@0.185.1` (r185), TypeScript, Vite 6, vitest, npm. React ya da R3F yok.

### Naif Çözüm: Snapshot Geldi, Küpü Oraya Koy

En basit istemci üç satır:

```ts
transport.onSnapshot((snapshot) => {
  const state = snapshot.entities.find((e) => e.id === remoteId);
  if (state) cube.position.set(state.px, state.py, state.pz);
});
```

Çalışır. Ve berbat görünür.

Sebebi aritmetikte. Sunucu 15 Hz'de yayın yapıyorsa iki snapshot arası 66,67 ms. Ekranınız 120 Hz ise o aralıkta 8 kare çiziyorsunuz. Bu 8 karenin 7'sinde küp taş gibi duruyor, 8'incisinde bir sıçrama yapıyor.

| Snapshot hızı | Aralık | 120 Hz'de kaç kare | 60 Hz'de kaç kare |
|---|---|---|---|
| 10 Hz | 100,00 ms | 12 | 6 |
| 15 Hz | 66,67 ms | 8 | 4 |
| 20 Hz | 50,00 ms | 6 | 3 |
| 30 Hz | 33,33 ms | 4 | 2 |

Mesafeye çevirince daha da net oluyor. Saniyede 4 metre koşan bir karakter, 15 Hz'de her snapshot'ta 26,7 santim ilerler. Ekranda gördüğünüz şey, 26,7 santimlik adımlarla ışınlanan bir küp.

Bir de ilk denemede pek akla gelmeyen ikinci bir sorun var: paketler her zaman sıralı gelmez. Bir snapshot ötekini geçerse — buna out-of-order (sıra bozulması) deniyor — küp bir kare geriye ışınlanır, sonra tekrar ileri. Bu artık sıçrama değil, titreme.

Dönüş tarafı daha da kötü. Pozisyon sıçraması gözü rahatsız eder; dönüş sıçraması karakteri bir anda ters çevirir.

### "Sadece Yumuşatsak Olmaz mı?"

Herkesin aklına gelen ilk düzeltme şu: son gelen snapshot'ı bir hedef olarak tut, her karede küpü ona doğru biraz yaklaştır. Canvas serisindeki prediction yazısında bunun kare hızından bağımsız hâlini yazmıştık — `1 - Math.exp(-rate * dt)`.

O yazıda doğru araçtı. Burada değil. Üç sebepten.

Birincisi: sürekli hareket eden bir hedefi kovalayan üstel yumuşatma hedefe hiç varmaz. Hep geride, hep belirsiz bir mesafede kalır. Karakter hızlandıkça geri kalır, yavaşladıkça yetişir. Ekranda gördüğünüz mesafe artık oyunun değil, `rate` katsayınızın fonksiyonudur.

İkincisi: bu yaklaşımın zaman kavramı yok. Bir paket 40 ms geç geldiyse, bir sonraki 40 ms erken geldiyse, yumuşatma bunu bilmez. Elinde yalnızca "son değer" vardır, o değerin *ne zamana ait* olduğunu umursamaz.

Üçüncüsü: paket kaybolduğunda sessizce hareket uydurur. Hedef güncellenmediği hâlde küp ona doğru yaklaşmaya devam eder ve yavaşlayarak durur. Oyuncu bir şey olmadığını sanır. Oysa bilgi kesilmiştir.

Snapshot interpolation bunların üçünü de tek bir kararla çözüyor: hedefi kovalamayı bırak, **iki bilinen nokta arasında ol**.

Peki iki bilinen nokta arasında olmak için ne lazım? Çizdiğiniz andan *sonrasına* ait bir snapshot. Ve sunucu size geleceği göndermediğine göre, geriye tek bir seçenek kalıyor.

### Render Zamanını Geçmişe Almak

Denklem bu kadar:

```
renderTime = serverNow() - interpolationDelay
```

Ekranda gördüğünüz her uzak oyuncu, sunucu saatine göre `interpolationDelay` kadar geçmişte duruyor. Karşılığında, tampon dolu olduğu sürece elinizde iki snapshot var: biri `renderTime`'dan önce, biri sonra. İkisinin arasını doldurmak artık tahmin değil, ölçüm. Televizyondaki yayın gecikmesinin tek satırlık hâli.

Bu takasın bedeli de açık: uzak oyuncuların bilgisi `interpolationDelay` kadar bayattır. Bir rakibe ateş ettiğinizde, gördüğünüz onun 100 ms önceki hâlidir. Rekabetçi nişancı oyunlarında sunucunun bunu telafi etmek için yaptığı şeye lag compensation (gecikme telafisi) deniyor ve o başka bir yazının konusu. Burada satın aldığımız şey pürüzsüzlük, ödediğimiz şey tazelik.

Şunu da not düşeyim: yerel karakteriniz bu tampondan geçmez. O tahminle çizilir, gecikmesi sıfırdır. Bu yüzden iyi kurulmuş bir multiplayer istemcisinde iki farklı zaman akar — biriniz şimdide, herkes geçmişte.

### Tampon: Sıralı Ekleme, Budama, Kapsayan Çift

Gelen snapshot'ları zaman sırasına göre tutan bir yapıya ihtiyacımız var. Her snapshot bir `tick` (sunucunun adım sayacı) ve bir sunucu zaman damgası taşıyor. Tampon üç iş yapıyor: sıralı eklemek, eskiyeni atmak ve verilen bir `renderTime`'ı kapsayan çifti bulmak.

Önce ölçülecek şeyin tipi:

```ts
// src/snapshot.ts
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
  serverTime: number; // ms, sunucu saati
  entities: EntityState[];
}
```

Ölçek (`scale`) burada yok, bilerek. Sebebine birazdan geleceğim.

Tamponun kendisi:

```ts
// src/buffer.ts
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
```

Dört yeri işaretlemek istiyorum.

`insert` sondan geriye tarıyor, baştan değil. Paketler çoğunlukla sıralı gelir; sıralı geldiklerinde `while` döngüsü sıfır kez döner ve ekleme sabit maliyete iner. Sıra bozulduğunda birkaç adım geri gider. Bu kadar.

`prune`'un koşulu `items[1].serverTime <= renderTime`. `items[0]`'ı ancak `items[1]` de hâlâ geçmişteyse atıyoruz. Böylece kapsayan çiftin sol ucu her zaman tamponda kalıyor. Koşulu `items[0]`'a bakacak şekilde yazarsanız — ki ilk denememde öyle yazmıştım — interpolasyonun sol ucunu her karede kendi elinizle siliyorsunuz ve `kind` sürekli `"before"` dönüyor.

Kapsayan çifti doğrusal tarama ile buluyorum, ikili aramayla değil. Dürüst olalım: 15 Hz'de ve 100 ms gecikmeyle tamponda tipik olarak 3–5 eleman durur. Sondan geriye üç adımlık bir taramayı ikili aramayla yenmek zor; üstelik sıçramalı erişim önbelleğe de iyi gelmez. İkili arama, tamponu yüzlerce elemana çıkardığınız gün — mesela replay (tekrar oynatma) ya da lag compensation için geçmişi saklarken — anlamlı hâle gelir. O gün gelene kadar bu döngü işi görüyor.

Ve `kind` bir süs değil, ölçüm noktası. Dört durumu ayırıyor:

| `kind` | Anlamı | Ekranda |
|---|---|---|
| `empty` | Hiç snapshot gelmedi | Varlık henüz yok |
| `before` | `renderTime` tamponun en eskisinden de eski | En eskiye tutunur (başlangıç anı) |
| `between` | Kapsayan çift bulundu | İnterpolasyon çalışıyor |
| `after` | `renderTime` en yeniyi geçti | **Tampon açlığı** — donma |

`after` bu yazının en önemli sayacı. Ona bir bölüm ayıracağım.

### Aynı Alpha, İki Farklı Matematik

Kapsayan çift ve `alpha` elimizde. Şimdi pozisyonu ve dönüşü ayrı ayrı ele alacağız.

```ts
// src/interpolate.ts
import { Quaternion, Vector3 } from "three";
import type { EntityState } from "./snapshot";

const _to = new Vector3();
const _qto = new Quaternion();

export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
}

export function createPose(): Pose {
  return { position: new Vector3(), quaternion: new Quaternion() };
}

/** Pozisyon düz çizgide, dönüş küre üstünde. Aynı alpha, farklı matematik. */
export function interpolatePose(
  from: EntityState,
  to: EntityState,
  alpha: number,
  out: Pose,
): Pose {
  out.position.set(from.px, from.py, from.pz);
  _to.set(to.px, to.py, to.pz);
  out.position.lerp(_to, alpha);

  out.quaternion.set(from.qx, from.qy, from.qz, from.qw);
  _qto.set(to.qx, to.qy, to.qz, to.qw);
  out.quaternion.slerp(_qto, alpha);

  return out;
}
```

Pozisyon için `lerp` doğru araç, çünkü iki nokta arasındaki en kısa yol düz çizgidir ve düz çizgi üstünde sabit hızda ilerlemek `a + (b - a) * t` ile ifade edilir. Dönüş için düz çizgi diye bir şey yok. Bir quaternion dört boyutlu birim kürenin üstünde bir noktadır; iki nokta arasındaki en kısa yol bir yay (arc) parçasıdır ve o yay üstünde sabit açısal hızda ilerlemek `slerp` (spherical linear interpolation, küresel doğrusal aradeğerleme) demektir.

Bileşen bileşen `lerp` yapıp sonra `normalize()` çağırmak da bir sonuç üretir. Yayın üstüne düşer bile. Ama üstünde **sabit hızda** ilerlemez: ortalarda hızlanır, uçlarda yavaşlar. Küçük açılarda kimse fark etmez. Büyük açılarda karakter bir salınım kazanır. Ve birazdan göreceğimiz bir durumda kısa yayı bırakıp uzun yayı seçer.

Peki söz verdiğim `scale`? Dışarıda kalması bir eksiklik değil, bir karar.

Ölçek çoğu oyunda sürekli bir büyüklük değil, olay güdümlü bir büyüklüktür: bir güçlendirme alınır, bir düşman ölürken küçülür, bir nesne büyür. Bunlar zaman içinde akan değil, tetiklenen değişimler; sunucunun her snapshot'ta üç float daha göndermesine değmezler. Aynı ölçeği her karede tele koymak, sabit bir sayıyı saniyede 15 kez tekrar söylemekten ibaret. Ölçek gerçekten animasyonluysa bile o animasyon istemcide, olay tetiklendiğinde yerel olarak koşturulur — ağdan gelen bir eğri olarak değil.

Bir de şu var: interpolasyona kattığınız her alan, kapsayan çiftin bulunamadığı anlarda hakkında yalan söylemek zorunda kalacağınız bir alandır. Ne kadar az alan, o kadar az yalan.

Küçük bir kayan nokta notu, çünkü test yazarken kafanızı karıştırabilir. `Vector3.lerp`'in içi `this.x += (v.x - this.x) * alpha` biçiminde. `alpha = 0`'da sonuç tam olarak `from`. `alpha = 1`'de ise `a + (b - a)` oluyor ve IEEE 754 bunun `b`'ye tam eşit olacağını garanti etmiyor. Tohumlu 200.000 örnekle oyun ölçeğinde ([-100, 100] aralığı) taradım, tek sapma çıkmadı. Büyüklükler ayrışınca bozuluyor: `a = 948276.8422458321`, `b = 9.533007256686686e-8` için `a + (b - a)` sonucu `9.534414857625961e-8` veriyor. Testlerinizde uçlarda `toBe` yerine `toBeCloseTo` kullanmanın sebebi bu.

### Slerp'in Kısa Yolu: r185 Kaynağını Okuyalım

Şimdi yazının kalbi.

İki quaternion'un `dot` çarpımı negatifse, o çift — harfi harfine yorumlandığında — 180 dereceden büyük bir dönüşü temsil eder. Aralarında naif biçimde ilerlerseniz karakter kısa yoldan değil, uzun yoldan döner. Ekranda gördüğünüz şey bir takla.

Somut bir örnekle. Dairesel yörüngede dönen bir varlık düşünün; sunucu yönünü `Math.atan2` ile hesaplıyor, dolayısıyla açı her zaman `(-π, π]` aralığına sarılıyor. Turun bir yerinde arka arkaya iki snapshot şöyle geliyor: −178,8° ve +176,7°. Gerçek dönüş 4,5 derece. Ama bu iki quaternion'un dot çarpımı −0,9992.

Ölçtüğüm sonuç şu — iki yolu 2000 adımda örnekleyip toplam açısal mesafeyi topladım:

| Yöntem | Kat edilen açı | Görünen |
|---|---|---|
| `Quaternion.slerp` | 4,50° | Doğru: hafif bir düzeltme |
| Bileşen bileşen `lerp` + `normalize` | 355,50° | Karakter kendi etrafında takla atıyor |

Bir tur başına bir kez, hep yörüngenin aynı noktasında.

Peki `THREE.Quaternion.slerp` bunu kendi içinde hallediyor mu? Hatırlamaya güvenmeyelim, kaynağı okuyalım. `node_modules/three/src/math/Quaternion.js`, r185:

```js
slerp( qb, t ) {

    let x = qb._x, y = qb._y, z = qb._z, w = qb._w;

    let dot = this.dot( qb );

    if ( dot < 0 ) {

        x = - x;
        y = - y;
        z = - z;
        w = - w;

        dot = - dot;

    }

    let s = 1 - t;

    if ( dot < 0.9995 ) {

        // slerp

        const theta = Math.acos( dot );
        const sin = Math.sin( theta );

        s = Math.sin( s * theta ) / sin;
        t = Math.sin( t * theta ) / sin;
        // ... bileşenler s ve t ile harmanlanır

    } else {

        // for small angles, lerp then normalize
        // ... harmanla, sonra normalize et

    }

    return this;

}
```

Cevap: evet, koşulsuz olarak. Fonksiyonun ilk işi `dot`'a bakmak ve negatifse hedefi dört bileşeniyle birlikte negatiflemek. `Quaternion.slerpFlat` — düz `Float32Array`'ler üstünde çalışan statik sürüm, `AnimationMixer` ve InstancedMesh tarzı toplu senaryolarda kullanılır — aynı korumaya sahip. Kendi `slerp`'inizi yazmadığınız sürece bu tuzağa düşmüyorsunuz.

Ama üç ayrıntı gözden kaçıyor, üçü de test edilmeye değer.

Birincisi: r185'te `t === 0` ya da `t === 1` için erken çıkış yok. `t = 0`'da sonuç tam olarak `this` — çünkü `Math.sin(theta)/Math.sin(theta)` birebir 1,0 ve `Math.sin(0)` birebir 0. Bunu güvenle test edebilirsiniz. `t = 1`'de ise sonuç `qb` değil, **`±qb`**. `dot < 0` ise hedef negatiflendiği için sonuç `-qb` çıkar. Aynı dönüş, farklı bileşenler. `angleTo` sıfırı gösterir (kayan nokta payıyla 3e-8 civarı), `equals` ise `false` der. Snapshot'ları bileşen bileşen karşılaştırıp yinelenen paket eleyen bir kodunuz varsa, bu ayrım sizi bulur.

İkincisi: `0.9995` eşiği. `dot` bu eşiğin üstündeyse `acos` hiç çağrılmaz, kod bileşen harmanlaması artı `normalize()` yoluna gider — çünkü çok küçük açılarda `Math.sin(theta)` sıfıra yaklaşır ve bölme kararsızlaşır. Yan etkisi güzel: birim olmayan girdiler yüzünden `dot` bir miktar 1'i aştığında `Math.acos` NaN üretemiyor, çünkü o dalda hiç çalışmıyor. Kendi `slerp`'inizi yazacaksanız `dot`'u `[-1, 1]` aralığına clamp'lemeyi unutmayın; unutursanız NaN bir kareyi değil, o nesnenin bütün ömrünü zehirler.

Üçüncüsü: `angleTo` sizi yanıltabilir. Kaynağı tek satır:

```js
angleTo( q ) {
    return 2 * Math.acos( Math.abs( clamp( this.dot( q ), - 1, 1 ) ) );
}
```

`Math.abs` yüzünden `angleTo` her zaman 180 derecenin altında bir değer döner. "Slerp kısa yoldan gitti mi" sorusunu tek başına `angleTo` ile cevaplayamazsınız — uzun yoldan giden bir sonuç için de küçük bir açı raporlayabilir. Doğru test toplamsallık: ara noktayı bulup `a.angleTo(mid) + mid.angleTo(b)` toplamının `a.angleTo(b)`'ye eşit olup olmadığına bakmak. Kısa yolda toplam korunur; uzun yolda 4,5 yerine 355,5 çıkar.

### Telden Gelen Quaternion Birim Değildir

`slerp` girdilerinin birim uzunlukta olduğunu varsayar. Kaynakta bunu doğrulayan bir satır yok, olmasına da gerek yok — normalizasyon çağıranın işi.

Netcode bağlamında bu varsayım tehlikeli, çünkü quaternion'lar telde nadiren 32-bit float dörtlüsü olarak taşınır. Bant genişliğini kısmak için bileşenler 16-bit tamsayılara nicelenir (quantization), en büyük bileşen atılıp karşı tarafta yeniden türetilir. Geri açıldığında elinizdeki dörtlü artık tam olarak birim değildir.

Ne kadar bozulduğunu görmek için bir deneme yaptım. Sıfır derece ile 120 derece arasında `slerp(t = 0.5)`, doğru cevap 60 derece. Hedef quaternion'u 1,5 katıyla ölçekleyip aynı çağrıyı yapınca:

| Girdi | `slerp(0.5)` sonucu | Sonucun uzunluğu |
|---|---|---|
| Birim quaternion'lar | 60,00° | 1,000 |
| Hedef 1,5 katına ölçeklenmiş | 73,17° | 1,165 |

On üç derecelik sapma ve birim olmayan bir çıktı. Sessizce. Ne hata, ne uyarı.

Çözüm tek satır, ama yerini doğru seçmek gerekiyor: deserialize (çözümleme) anında, kare başına değil.

```ts
// src/snapshot.ts
export function normalizeEntity(e: EntityState): EntityState {
  const len = Math.sqrt(e.qx * e.qx + e.qy * e.qy + e.qz * e.qz + e.qw * e.qw);
  if (len === 0) {
    e.qx = 0;
    e.qy = 0;
    e.qz = 0;
    e.qw = 1; // birim quaternion
    return e;
  }
  const inv = 1 / len;
  e.qx *= inv;
  e.qy *= inv;
  e.qz *= inv;
  e.qw *= inv;
  return e;
}
```

Snapshot başına bir kez, varlık başına bir kare kök. 15 Hz'de sekiz varlık için saniyede 120 kare kök. Bunu kare başına yapmaya kalksanız 120 Hz'de saniyede 960 olurdu — yine küçük bir maliyet, ama gereksiz iş. Doğru yerde yapın, bir daha düşünmeyin.

### İki Saat Arasındaki Fark — ve Geri Sarmayan Render Saati

`renderTime = serverNow() - interpolationDelay` demiştik. Peki `serverNow()` nereden geliyor? İstemcinin `performance.now()`'ı ile sunucunun saati arasında bilmediğiniz bir fark var.

Elinizde yalnızca tek yönlü snapshot'lar varsa şu bağıntıyla çalışırsınız. `serverClock = clientClock + offset` olsun. Sunucu saatine göre `S` anında damgalanan bir paket, istemci saatine göre `R` anında varsın. Paketin tek yönlü gecikmesi `d ≥ 0` ise:

```
S - R = offset - d
```

Her örnek `offset`'in altında kalıyor; **en az geciken paket en iyi kestirimi veriyor**. Yani pencere içindeki en büyük örneği alacağız:

```ts
// src/clock.ts
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

  /** Penceredeki en az geciken paket = en büyük örnek. */
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
```

Kusurlarını sayayım, çünkü bu kestirim üretim kalitesinde değil.

Tek şanslı paket tahmini çiviliyor. Pencerede alışılmadık biçimde hızlı gelen bir paket varsa, `offset` o paketin belirlediği yerde kalır ve pencereden düşene kadar orada durur. Saat kayması (clock drift) hiç modellenmiyor: istemcinin ve sunucunun kristalleri milyonda birkaç parça farkla çalışır, saatlerce açık kalan bir oturumda bu birikir. Sunucu snapshot'ı damgalayıp yolladığı ana kadar geçen süreyi de ölçmüyoruz — damgalama ile `send` arasındaki gecikme, ölçülmüş `d`'nin içine sızıyor. Bir de düzeltmenin kendisi ani: pencere en büyük örneği düşürdüğünde tahmin bir anda aşağı kayar.

Gerçek uygulamalarda bunun yerine gidiş-dönüş sondalar (ping/pong) kullanılır; RTT'nin (round-trip time, gidiş-dönüş süresi) yarısı tek yönlü gecikme kestirimi olur, örnekler filtrelenir ve saat yumuşak biçimde kaydırılır. Bu yazının konusu değil — burada tek yönlü kestirimi anlaşılır tutup kusurunu yazıyorum.

Ama bir kusuru gerçekten düzeltmemiz gerek. `offset` aniden aşağı kayarsa `renderTime` da aşağı kayar. Ve geriye giden bir render zamanı, uzak oyuncuların bir kare boyunca geri sarması demek.

```ts
// src/clock.ts
export class RenderClock {
  private last = Number.NEGATIVE_INFINITY;

  constructor(public delayMs: number) {}

  /** renderTime = serverNow - delay, ama ASLA geri gitmez. */
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
```

Sert kelepçe. Hedef geri kaydığında render saati donuyor ve hedef ona yetişene kadar bekliyor. Alternatifi slew (yavaş kaydırma): hedefe doğru kare başına birkaç yüzde birlik bir oranla ilerlemek, böylece hem geri sarmamak hem de donmamak. Slew daha zarif; kelepçe daha basit ve daha kolay test edilir. Bu projede kelepçeyi seçtim. Demoda gecikme kaydırıcısını yukarı çektiğinizde bir anlık duraklama olmasının sebebi de bu.

### interpolationDelay: Formül Değil, Pazarlık

Sıra en çok yanlış anlaşılan sayıda.

İnternette dolaşan kural şu: `interpolationDelay` yaklaşık 1,5–2 snapshot aralığı olmalı. 15 Hz'de bu 100–133 ms demek. Kural fena değil ama bir formül değil, bir başlangıç noktası. Nereden geldiğine bakalım.

Tamponun boşalmaması için, `renderTime` her karede tamponun en yeni snapshot'ının gerisinde kalmalı. En yeni snapshot'ın yaşı iki şeyden oluşuyor: o paketin (en hızlı pakete göre) fazladan gecikmesi, artı son varıştan bu yana geçen süre. Jitter `±J` ve aralık `I` ise, en kötü durumda bir paket `+J` geç, ondan önceki `−J` erken gelir; araya bir de kayıp paket girerse boşluk bir aralık daha büyür.

```ts
// src/delay.ts
/**
 * Başlangıç noktası, garanti değil.
 * intervalMs: snapshot aralığı · jitterMs: tek yönlü jitter genliği (±)
 * lossTolerance: arka arkaya kaç kayıp pakete dayanılacağı
 */
export function recommendedDelay(intervalMs: number, jitterMs: number, lossTolerance = 1): number {
  return intervalMs * (1 + lossTolerance) + 2 * jitterMs;
}
```

Jitter sıfır ve tolerans 1 iken bu tam olarak 2 aralık veriyor — meşhur kuralın çıktığı yer burası. Jitter büyüdükçe ikisi ayrışıyor: 15 Hz'de ±40 ms jitter varken bu hesap 213 ms istiyor, kuralın söylediği 133 ms'yi değil. İki sayıdan hangisinin doğru olduğunu ise ne kural ne hesap söyler.

Takasın diğer ucunu yukarıda kurmuştuk: gecikmeyi büyüttükçe uzak oyuncular hakkındaki bilginiz bayatlar, küçülttükçe tampon boşalır ve karakterler donar. İkisi de kötü. Hangisinin daha az kötü olduğu oyunun türüne bağlı.

Bu sayı hesaplanmaz, seçilir. Seçebilmek için de ölçmek gerekiyor.

```ts
// src/stats.ts
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

    // "after" = renderTime en yeni snapshot'ı geçti = elimizde bilgi kalmadı.
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
```

`longestStarveMs` benim en çok güvendiğim sayı. Oran yanıltıcı olabilir: karelere serpilmiş binde beşlik bir açlığı kimse fark etmez, tek seferde 180 ms süren bir donma ise battığı gibi batar. Ortalamalar değil, kuyruklar rahatsız eder.

Bütün hat deterministik olduğu için aşağıdaki tablo tarayıcıya hiç girmeden, Node altında tek bir `npm run bench` koşumuyla doldurulabiliyor. Sabitler: 15 Hz snapshot, 120 Hz render, 30 saniye (3600 kare), tohum 1337, taban gecikme 60 ms. Hücre içeriği: aç geçen kare sayısı, parantez içinde en uzun tek kesinti.

| `interpolationDelay` | Jitter ±0 ms | Jitter ±20 ms | Jitter ±40 ms | ±40 ms + %5 kayıp |
|---|---|---|---|---|
| 33 ms (0,5 aralık) | 1804 (67 ms) | 2844 (392 ms) | 3156 (658 ms) | 3178 (658 ms) |
| 67 ms (1,0 aralık) | 8 (67 ms) | 688 (75 ms) | 1596 (167 ms) | 1708 (242 ms) |
| 100 ms (1,5 aralık) | 8 (67 ms) | 19 (75 ms) | 504 (83 ms) | 652 (100 ms) |
| 133 ms (2,0 aralık) | 8 (67 ms) | 9 (75 ms) | 33 (83 ms) | 157 (83 ms) |
| 200 ms (3,0 aralık) | 8 (67 ms) | 9 (75 ms) | 10 (83 ms) | 10 (83 ms) |

Ölçüm koşulu: Node v22.22.2, macOS (Darwin 25.5), Apple Silicon. Bu tabloda duvar saati yok — `simulate()` sabit adımlı sanal saatle koşuyor, dolayısıyla sayılar makine yüküne bağlı değil. İki ardışık `npm run bench` çıktısını `diff`'ledim: bit birebir aynı. "Koşum yayılımı" diye bir şey yok, çünkü yayılım sıfır.

Bir de her hücrenin altındaki taban var. İlk snapshot 60 ms yolda; 120 Hz'de bu 8 kare demek ve o 8 karede tampon `empty` olduğu için açlık sayılıyor. `8 (67 ms)` bu yüzden bir "sıfır" değil, açılış maliyeti. Örtebilirdim — ilk saniyeyi ölçüm dışı bırakan bir ısınma penceresi üç satır. Bırakmadım, çünkü oyuncu o 8 kareyi de görüyor.

Şimdi kehanetin hesabı. Ölçmeden önce şunu yazmıştım: ilk satır her sütunda felaket, son satırın ilk üç sütunu sıfıra yakın, kavga ortadaki iki satırda.

İlk ikisi tuttu. İlk satır %50 ile %88 arasında aç — 33 ms gecikme, jitter hiç yokken bile karelerin yarısını donmuş geçiriyor. Son satırın ilk üç sütunu 8, 9, 10 kare; yani binde iki-üç ve hepsi açılış tabanı, sonrasında tek bir donma yok.

Üçüncüsünde yanıldım. Kavga ortadaki iki satırda değil, **alttaki ikisinde**: 100 ms ve 133 ms. 67 ms satırı bir kavga değil, bir yenilgi — ±20 ms jitterde %19, ±40 ms'te %44 aç. "1,0 aralık yeter" diye düşünmüştüm; yetmiyor. İnternetteki 1,5–2 aralık kuralı bu tabloda hakkını veriyor: 100 ms sütunların ilk ikisinde temiz, 133 ms üçünde temiz. Kural fena değilmiş.

Kuyruklara da bakın, oranlara değil. 33 ms / ±40 ms hücresinde en uzun tek kesinti 658 ms. Yarım saniyeden uzun süre donmuş bir rakip, "%88 aç" ifadesinden çok daha somut bir şey.

### Sahte Ağ: Tohumlu Gecikme, Jitter ve Kayıp

Bu tabloyu üretebilmek için ağı taklit eden bir katman gerekiyor. Gerçek WebSocket ile ölçüm yapamazsınız — iki koşum asla aynı çıkmaz.

```ts
// src/rng.ts
/** mulberry32: 32 bit durumlu, tohumlu, hızlı PRNG. Bu depoda Math.random() yasak. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Taşıma katmanı:

```ts
// src/transport.ts
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
```

İki tasarım kararına dikkat.

Kayıp ve jitter için iki ayrı RNG akışı var; jitter, düşen paketlerde bile çekiliyor. Amaç ölçüm hijyeni: kayıp oranını %0'dan %20'ye çıkardığınızda hayatta kalan paketlerin varış zamanları birebir aynı kalsın, böylece iki koşumu karşılaştırırken hangi farkın kayıptan hangisinin jitterden geldiğini ayırabilesiniz.

Bu iki karardan hangisinin yükü taşıdığını mutasyonla ölçtüm — testi bozup kırmızıya döndüğünü görmek. Sonuç beklediğim gibi çıkmadı, o yüzden yazıyorum. Yükü taşıyan **jitter'ın her pakette çekilmesi**: `rollJitter()` çağrısını kayıp kontrolünün arkasına alır almaz test kızarıyor, çünkü kayıp arttıkça jitter akışı yavaş ilerliyor ve hayatta kalan paketler başka değerler alıyor. İki akış ise tek başına kurtarmıyor — ama bir şeyi de bozmuyor. `rollJitter`'ı `rollLoss`'un aynısı yapıp testi tekrar koştum: yeşil. Çünkü tek akışta bile her paket tam iki çekim tüketiyor, akış konumu kayıp oranından bağımsız kalıyor. Doğrudan da ölçtüm: tek akışla, kayıp %20 iken hayatta kalan 168 paketin 168'i temiz koşumdakiyle aynı varış anına sahip.

Yani "tek akış kullansaydınız jitter dizisi kayardı" cümlesini kurmaya hazırdım ve yanlış olacaktı. İki akışı yine de tutuyorum, ama artık gerekçesi farklı: tek akışın bağımsızlığı "her paket eşit sayıda çekim tüketir" gibi hatırlanması gereken bir görgü kuralına yaslanıyor. İki akışta bu bir görgü kuralı değil, yapının kendisi. Bir gün üçüncü bir rastgele karar eklerseniz — mesela paket çoğaltma — tek akış sessizce bozulur.

Sıra bozulması için ayrı bir düğme yok. Gerek de yok: jitter yeterince büyükse geç yollanan bir paket erken yollananı doğal olarak geçer. `poll` paketleri varış zamanına göre sıralayıp teslim ediyor ve `seq` geriye düştüğünde `outOfOrder` sayacını artırıyor. Sıra bozulması uydurulmuş bir olay değil, jitterin sonucu — modelin gerçeğe sadık kaldığı yerlerden biri.

Sunucu tarafı da bir o kadar sade. Varlıklar dairesel yörüngede dönüyor ve yönleri `atan2` ile hesaplanıyor:

```ts
// src/world.ts
import { createEntityState } from "./snapshot";
import type { EntityState, Snapshot } from "./snapshot";

export interface RemoteConfig {
  id: number;
  radius: number;
  speed: number; // rad/s
  phase: number;
  y: number;
}

export function poseAt(cfg: RemoteConfig, serverTimeMs: number, out: EntityState): EntityState {
  const a = cfg.phase + (serverTimeMs / 1000) * cfg.speed;

  out.id = cfg.id;
  out.px = Math.cos(a) * cfg.radius;
  out.py = cfg.y;
  out.pz = Math.sin(a) * cfg.radius;

  // Teğet yön. atan2 açıyı (-π, π] aralığına SARAR; bu yüzden quaternion'un
  // işareti tur başına bir kez atlar ve dot çarpımı negatife düşer.
  // Slerp tuzağını demoda görebilmemizin sebebi bu satır.
  const yaw = Math.atan2(-Math.sin(a), Math.cos(a));
  const half = yaw * 0.5;

  out.qx = 0;
  out.qy = Math.sin(half);
  out.qz = 0;
  out.qw = Math.cos(half);
  return out;
}
```

O `atan2` bilinçli bir seçim. Açıyı sarmadan biriktirseydim quaternion sürekli değişir, işaret hiç atlamaz ve tuzak demoda hiç görünmezdi. Sunucuların yönü sarılmış bir açıdan türetmesi de son derece yaygın: bu kurgulanmış bir senaryo değil, standart bir senaryo.

### Tampon Boşalırsa Ne Olur? (Bu Yazıda Çözümü Yok)

`kind === "after"` döndüğü an, `renderTime` tampondaki en yeni snapshot'ı geçmiştir. Elimizde interpolasyon yapacak sağ uç yoktur.

Bu kodun yaptığı şey: en yeni snapshot'ta durmak. Karakter donar. Yeni paket gelince kaldığı yerden devam eder.

Yayın mecazının borcunu ödediği yer burası. Tamponu boşalan bir canlı yayın da tam olarak böyle davranır: son kareyi ekranda tutar ve bekler. Kimse "bağlantı koptu" yazmaz, sadece görüntü çakılı kalır. Oyuncunun gördüğü şey de bir hata mesajı değil, hareketsiz duran bir rakip.

Bunun daha iyi bir cevabı var: dead reckoning (ölü hesap), ya da başka bir adla extrapolation (dışdeğerleme). Son bilinen hızla ileriye devam etmek, sonra gerçek snapshot geldiğinde sapmayı yumuşatarak kapatmak. Kulağa basit geliyor, değil. Nereye kadar dışdeğerleyeceğiniz, duvara çarpan bir karakteri duvarın içine sokmamak, geri dönüş düzeltmesini gizlemek — hepsi ayrı kararlar. Bu yazıda o kapıyı açmıyorum.

Bunun yerine ölçüyorum. Donmayı sayıyorum, süresini tutuyorum, en uzun kesintiyi raporluyorum. `interpolationDelay` pazarlığının somut para birimi bu sayaçlar.

Bir sonraki yazının konusu da böylece belli oldu.

### Kanıt: GPU'suz, Deterministik Testler

Bu makalenin en sevdiğim tarafı burası. Snapshot interpolation'ın tamamı saf mantık: tampon, saat, kapsayan çift, taşıma katmanı. Hiçbiri WebGL istemiyor. `THREE.Quaternion` ve `THREE.Vector3` de Node altında sorunsuz çalışıyor. Bütün hat vitest ile, tarayıcısız, milisaniyelerde doğrulanabiliyor.

Önce tamponun dört durumu:

```ts
// test/buffer.test.ts
import { describe, expect, it } from "vitest";
import { SnapshotBuffer } from "../src/buffer";

const snap = (tick: number, serverTime: number) => ({ tick, serverTime });

describe("SnapshotBuffer.sampleAt", () => {
  it("kapsayan çifti bulur ve alpha'yı doğru hesaplar", () => {
    const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
    buffer.insert(snap(0, 0));
    buffer.insert(snap(1, 100));
    buffer.insert(snap(2, 200));

    const s = buffer.sampleAt(150);
    expect(s.kind).toBe("between");
    expect(s.from?.tick).toBe(1);
    expect(s.to?.tick).toBe(2);
    expect(s.alpha).toBe(0.5);
  });

  it("tam bir snapshot'ın üstünde alpha 0 verir", () => {
    const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
    buffer.insert(snap(0, 0));
    buffer.insert(snap(1, 100));
    buffer.insert(snap(2, 200));

    const s = buffer.sampleAt(100);
    expect(s.kind).toBe("between");
    expect(s.from?.tick).toBe(1);
    expect(s.alpha).toBe(0);
  });

  it("tamponun gerisinde 'before', önünde 'after' döner", () => {
    const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
    buffer.insert(snap(5, 500));
    buffer.insert(snap(6, 600));

    expect(buffer.sampleAt(400).kind).toBe("before");
    expect(buffer.sampleAt(700).kind).toBe("after");
    expect(buffer.sampleAt(700).from?.tick).toBe(6); // en yeniye tutunur
    expect(new SnapshotBuffer().sampleAt(0).kind).toBe("empty");
  });
});
```

Sonra sıra bozulması ve yinelenen paket:

```ts
// test/buffer.test.ts (devam)
it("sırasız gelen paket doğru yere yerleşir", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
  buffer.insert(snap(0, 0));
  buffer.insert(snap(2, 200)); // 1 geç kaldı
  expect(buffer.insert(snap(1, 100))).toBe(true);

  expect(buffer.toArray().map((s) => s.tick)).toEqual([0, 1, 2]);
});

it("yinelenen tick yok sayılır", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
  buffer.insert(snap(0, 0));
  buffer.insert(snap(1, 100));

  expect(buffer.insert(snap(1, 100))).toBe(false);
  expect(buffer.size).toBe(2);
});

it("prune kapsayan çiftin sol ucunu ASLA silmez", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>();
  for (let i = 0; i < 6; i++) buffer.insert(snap(i, i * 100));

  buffer.prune(430);
  expect(buffer.toArray().map((s) => s.tick)).toEqual([4, 5]);
  expect(buffer.sampleAt(430).kind).toBe("between"); // hâlâ interpole edilebiliyor
});

it("kapasite aşılınca en eski düşer; çok geç gelen paket tampona giremez", () => {
  const buffer = new SnapshotBuffer<{ tick: number; serverTime: number }>(3);
  buffer.insert(snap(10, 1000));
  buffer.insert(snap(11, 1100));
  buffer.insert(snap(12, 1200));

  expect(buffer.insert(snap(1, 100))).toBe(false); // fosil
  expect(buffer.toArray().map((s) => s.tick)).toEqual([10, 11, 12]);
});
```

`prune` testi tam olarak benim yediğim golü bekliyor. Koşulu `items[0].serverTime <= renderTime` yapın, o test kırmızıya döner ve `sampleAt` artık `"before"` demeye başlar.

Şimdi asıl mesele — slerp'in kısa yolu:

```ts
// test/slerp.test.ts
import { MathUtils, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

const Y = new Vector3(0, 1, 0);
const yawQuat = (deg: number) => new Quaternion().setFromAxisAngle(Y, MathUtils.degToRad(deg));

/** Bir interpolasyon yolunun toplam açısal uzunluğu (derece). */
function pathDegrees(step: (t: number) => Quaternion, samples = 2000): number {
  let total = 0;
  let prev = step(0);
  for (let i = 1; i <= samples; i++) {
    const q = step(i / samples);
    total += prev.angleTo(q);
    prev = q;
  }
  return MathUtils.radToDeg(total);
}

describe("slerp kısa yolu seçer", () => {
  const a = yawQuat(-178.8);
  const b = yawQuat(176.7);

  it("bu çiftte dot NEGATİF — uzun yol tuzağı kurulu", () => {
    expect(a.dot(b)).toBeLessThan(0);
    expect(a.dot(b)).toBeCloseTo(-0.99923, 5);
  });

  it("slerp 4,5 dereceyi kat eder, bileşen lerp'i 355,5", () => {
    const slerped = pathDegrees((t) => a.clone().slerp(b, t));
    const naive = pathDegrees((t) =>
      new Quaternion(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
        a.w + (b.w - a.w) * t,
      ).normalize(),
    );

    expect(slerped).toBeCloseTo(4.5, 2);
    expect(naive).toBeCloseTo(355.5, 2);
  });

  it("ara nokta toplamsallığı korur (angleTo tek başına yetmez)", () => {
    const mid = a.clone().slerp(b, 0.5);
    const sum = MathUtils.radToDeg(a.angleTo(mid) + mid.angleTo(b));
    expect(sum).toBeCloseTo(MathUtils.radToDeg(a.angleTo(b)), 6);
    expect(MathUtils.radToDeg(a.angleTo(b))).toBeLessThanOrEqual(180);
  });

  it("t=0 TAM eşitlik; t=1'de dot<0 ise sonuç -qb olur", () => {
    const at0 = a.clone().slerp(b, 0);
    expect(at0.x).toBe(a.x);
    expect(at0.y).toBe(a.y);
    expect(at0.z).toBe(a.z);
    expect(at0.w).toBe(a.w);

    const at1 = a.clone().slerp(b, 1);
    expect(at1.equals(b)).toBe(false); // bileşenler eşit DEĞİL
    expect(at1.angleTo(b)).toBeCloseTo(0, 6); // dönüş AYNI (acos'un kayan nokta payı)
    expect(at1.y).toBe(-b.y);
    expect(at1.w).toBe(-b.w);
  });

  it("birim olmayan girdi açıyı sessizce kaydırır", () => {
    const from = yawQuat(0);
    const to = yawQuat(120);
    const scaled = new Quaternion(to.x * 1.5, to.y * 1.5, to.z * 1.5, to.w * 1.5);

    const good = from.clone().slerp(to, 0.5);
    const bad = from.clone().slerp(scaled, 0.5);

    expect(MathUtils.radToDeg(from.angleTo(good))).toBeCloseTo(60, 6);
    expect(bad.length()).toBeGreaterThan(1.1); // sonuç birim bile değil
  });
});
```

Dördüncü test bu paketin en öğretici olanı. `t = 1`'de sonucun `b`'ye eşit *olmadığını* ama aynı dönüşü temsil ettiğini iddia ediyor. Bunu yazana kadar r185'in `t === 1` için erken çıkışı olmadığını fark etmemiştim; kaynağı okumasam makaleye "uçlarda tam eşitlik" diye yazacaktım.

Taşıma katmanının determinizmi de test edilebilir bir sözleşme:

```ts
// test/transport.test.ts
import { describe, expect, it } from "vitest";
import { FakeTransport } from "../src/transport";

function run(lossRate: number): number[] {
  const t = new FakeTransport<number>({ latencyMs: 60, jitterMs: 40, lossRate, seed: 1337 });
  const arrivals: number[] = [];
  for (let i = 0; i < 200; i++) {
    t.send(i, i * 66.67);
    for (const payload of t.poll(i * 66.67)) arrivals.push(payload);
  }
  return arrivals;
}

it("aynı tohum aynı diziyi verir", () => {
  expect(run(0)).toEqual(run(0));
});

it("kayıp oranını değiştirmek jitter akışını BOZMAZ", () => {
  const clean = run(0);
  const lossy = run(0.2);
  // Kayıplı koşumda gelenlerin hepsi temiz koşumda da aynı SIRADA var.
  const cleanIndex = new Map(clean.map((v, i) => [v, i]));
  let last = -1;
  for (const v of lossy) {
    const idx = cleanIndex.get(v);
    expect(idx).toBeDefined();
    expect(idx!).toBeGreaterThan(last);
    last = idx!;
  }
  expect(lossy.length).toBeLessThan(clean.length);
});

it("yeterli jitter sıra bozulması üretir", () => {
  const t = new FakeTransport<number>({ latencyMs: 60, jitterMs: 60, lossRate: 0, seed: 7 });
  for (let i = 0; i < 300; i++) {
    t.send(i, i * 33.33);
    t.poll(i * 33.33);
  }
  expect(t.outOfOrder).toBeGreaterThan(0);
});
```

İkinci test bir sözleşmeyi çiviliyor: kayıp oranı değiştiğinde hayatta kalan paketlerin göreli sırası korunuyor. Bu olmadan "kayıp %5'e çıkınca donma arttı" cümlesini kuramazsınız; jitter dizisi de değiştiği için hangi değişkenin etkisini gördüğünüzü bilemezsiniz.

Bir de render saatinin monotonluğu:

```ts
// test/clock.test.ts
import { describe, expect, it } from "vitest";
import { RenderClock, ServerClockEstimator } from "../src/clock";

it("offset penceredeki EN BÜYÜK örneği alır (en az geciken paket)", () => {
  const c = new ServerClockEstimator(4);
  c.addSample(1000, 900); // offset - d = 100
  c.addSample(1100, 1030); //            = 70
  c.addSample(1200, 1085); //            = 115
  expect(c.offset).toBe(115);
  expect(c.serverNow(2000)).toBe(2115);
});

it("renderTime asla geri gitmez", () => {
  const clock = new RenderClock(100);
  expect(clock.advance(1000)).toBe(900);
  expect(clock.advance(1050)).toBe(950);
  expect(clock.advance(900)).toBe(950); // offset aşağı kaydı: DON, geri sarma
  expect(clock.advance(1200)).toBe(1100);
});
```

Son olarak açlık sayacı — tarayıcısız, tohumlu, tekrarlanabilir:

```ts
// test/starvation.test.ts
import { describe, expect, it } from "vitest";
import { simulate } from "../scripts/starvation-bench";

it("aynı tohum aynı açlık sayısını verir", () => {
  const a = simulate({ delayMs: 100, jitterMs: 40, lossRate: 0.05, seed: 1337, seconds: 10 });
  const b = simulate({ delayMs: 100, jitterMs: 40, lossRate: 0.05, seed: 1337, seconds: 10 });
  expect(a.starvedFrames).toBe(b.starvedFrames);
  expect(a.longestStarveMs).toBe(b.longestStarveMs);
});

it("gecikme büyüdükçe açlık azalır (monoton)", () => {
  const opts = { jitterMs: 40, lossRate: 0, seed: 1337, seconds: 10 };
  const short = simulate({ ...opts, delayMs: 33 });
  const long = simulate({ ...opts, delayMs: 200 });
  expect(long.starvedFrames).toBeLessThanOrEqual(short.starvedFrames);
});

/**
 * Yukarıdaki monotonluk testi tek başına ZAYIF bir koruma: `delayMs` hiç
 * kullanılmasa (RenderClock(0)) iki koşum da eşit çıkar ve `toBeLessThanOrEqual`
 * yine geçer. Mutasyonla yakalandı, bu test onun için var — sayılar çivileniyor.
 */
it("delayMs gerçekten etki ediyor: ±40 ms jitterde 33 ms vs 200 ms", () => {
  const opts = { jitterMs: 40, lossRate: 0, seed: 1337, seconds: 10 };
  const short = simulate({ ...opts, delayMs: 33 });
  const long = simulate({ ...opts, delayMs: 200 });

  expect(short.frames).toBe(1200);
  expect(short.starvedFrames).toBe(1051);
  expect(long.starvedFrames).toBe(10);
  expect(short.longestStarveMs).toBeCloseTo(641.67, 1);
  expect(long.longestStarveMs).toBeCloseTo(83.33, 1);
});
```

İkinci testin `toBeLessThanOrEqual` olmasına dikkat. `toBeLessThan` yazmak cazipti, ama gecikme yeterince büyükse iki koşum da sıfır döner ve test kendi başarısından ölür. Sınır durumları test yazarken de geçerli.

Üçüncü test o esnekliğin faturası. Bu paketteki her testi mutasyonla denedim — iddiayı bozup kırmızıya döndüğünü görmek — ve iki tanesi hayatta kaldı. Biri buydu: `simulate` içindeki `new RenderClock(options.delayMs)` yerine `new RenderClock(0)` yazdım, yani `interpolationDelay`'i tamamen yok saydım. İki koşum artık birbirinin aynısı, `toBeLessThanOrEqual` hâlâ geçiyor. Monotonluk testi doğru bir şey söylüyor ama hiçbir şeyi korumuyordu. Üçüncü test sayıları çiviliyor: aynı mutasyon şimdi anında kızarıyor. (Diğer hayatta kalan `InterpolationStats`'ın açlık tanımıydı; ona da ayrı bir test dosyası yazdım.)

### Demo: Yan Yana İki Küme

Demo bilerek hafif. Toplam sekiz küp: solda dört tanesi ışınlanıyor, sağda dört tanesi interpole ediliyor. Aynı sahne, aynı kamera, aynı veri, tek fark uygulama biçimi. Bloom yok, gölge yok, otomatik süpürme yok.

İki tarafın kusuru da aynı karede görünsün diye böyle kurdum. Sol taraf snapshot geldiği anda ışınlanıyor, dolayısıyla kesik kesik atlıyor; jitter kaydırıcısını yukarı çektiğinizde ara sıra geri de sıçrıyor. Sağ taraf tampondan okuduğu için akıyor. Kaybı %20'ye çektiğinizde o da tökezliyor — ama onun tökezlemesi donma, titreme değil. Aradaki farkı gözle tartışmak yerine HUD'daki `LONGEST STARVE` sayacından okuyabilirsiniz.

HUD'da iki blok var ve etiketleri ayrı: ölçülen sayılar bir yanda, modelden gelen sabitler öbür yanda. Sebebi yukarıdaki tabloyla aynı — ölçülmemiş bir sayı ölçülmüş gibi durmasın.

```ts
// src/hud.ts — etiketler KAYNAKTA BÜYÜK yazılır.
// text-transform: uppercase + lang="tr" İngilizce "i" harfini "İ" yapar:
// INTERPOLATION -> İNTERPOLATİON. Sinsi bir hata, bir kez yaşayan unutmaz.
export const MEASURED_LABELS = [
  "SNAPSHOTS RECEIVED",
  "DROPPED",
  "OUT OF ORDER",
  "BUFFER SIZE",
  "MIN BUFFER SIZE",
  "STARVED FRAMES",
  "STARVED RATIO",
  "LONGEST STARVE",
  "CURRENT ALPHA",
] as const;

export const MODEL_LABELS = [
  "SNAPSHOT RATE",
  "INTERPOLATION DELAY",
  "RECOMMENDED DELAY",
  "LATENCY",
  "JITTER",
  "LOSS RATE",
] as const;
```

Kaydırıcılar elle oynatılır, ölçüm elle tetiklenir. "Ölç" düğmesi sayaçları sıfırlar, on saniye sayar, sonucu dondurur. Otomatik koşan hiçbir şey yok — bunun sebebini bir önceki demoda makinemin fanlarını boş yere çalıştırdıktan sonra öğrendim.

Bir de kolay atlanan bir ayrıntı: sekme arka plana atılınca `requestAnimationFrame` durur, geri döndüğünüzde `dt` birkaç saniye olur. Kelepçelemezseniz sahte sunucu tek karede yüzlerce snapshot üretir ve tamponu doldurur. Döngünün ilk satırı bu yüzden `const dt = Math.min(rawDt, 100)`.

### Özetle:

1. Naif çözüm — snapshot geldiğinde nesneyi oraya koymak — 15 Hz sunucu ve 120 Hz ekranda 8 karede bir sıçrama üretir. Sorun ağda değil, 8 karenin doldurulmamasında.
2. Son değeri üstel yumuşatmayla kovalamak yeterli değil: hedefe hiç varmaz, zaman kavramı yoktur ve paket kaybolduğunda sessizce hareket uydurur. İki bilinen nokta arasında olmak gerekir.
3. Denklem `renderTime = serverNow() - interpolationDelay`. Uzak oyuncuları geçmişte çizersiniz, karşılığında — tampon dolu kaldığı sürece — iki taraflı veriniz olur. Yerel karakteriniz bu tampondan geçmez.
4. Tampon üç iş yapar: sıralı ekleme (sondan geriye tarayın, paketler çoğunlukla sıralı gelir), yinelenen tick eleme ve budama. `prune` koşulu `items[1]`'e bakmalı; `items[0]`'a bakarsa interpolasyonun sol ucunu siler.
5. Kapsayan çifti aramak için ikili aramaya gerek yok. Tipik tampon 3–5 eleman tutar; sondan geriye doğrusal tarama bunun için fazlasıyla yeterli. İkili arama, tamponu yüzlerce elemana çıkardığınız gün gelir.
6. Pozisyon `lerp`, dönüş `slerp` — aynı alpha, farklı matematik. Ölçek interpole edilmez: olay güdümlü bir büyüklüktür, telde yer kaplar ve interpole ettiğiniz her alan tampon boşaldığında hakkında yalan söyleyeceğiniz bir alandır.
7. `three@0.185.1`'de `Quaternion.slerp` `dot < 0` durumunda hedefi koşulsuz negatifler; `slerpFlat` de aynı korumaya sahip. Kısa yol garantidir — kendi `slerp`'inizi yazmadığınız sürece.
8. r185'te `t === 0` / `t === 1` için erken çıkış yok. `t = 0` bileşen bileşen tam eşitlik verir; `t = 1` ise `dot < 0` iken `-qb` döndürür — aynı dönüş, farklı bileşenler. Bileşen karşılaştırmasıyla yinelenen eleyen kod bu yüzden kırılır.
9. `angleTo` `Math.abs(dot)` kullandığı için hep 180 derecenin altını raporlar; "kısa yoldan gitti mi" sorusunu tek başına cevaplayamaz. Toplamsallığı test edin: `a.angleTo(mid) + mid.angleTo(b) === a.angleTo(b)`.
10. `slerp` girdilerin birim olduğunu varsayar. Nicelenmiş quaternion'lar birim değildir; ölçülü bir örnekte 60 derecelik interpolasyon 73,17 dereceye kayıyor ve sonuç birim bile çıkmıyor. Deserialize anında bir kez `normalize()` edin, kare başına değil.
11. `interpolationDelay` bir formül değil, pazarlık. Başlangıç noktası `interval × (1 + kayıpToleransı) + 2 × jitter`; küçük seçerseniz tampon açlıktan donar, büyük seçerseniz uzak oyuncular hakkındaki bilginiz bayatlar. Sayı hesaplanmaz, ölçülerek seçilir.
12. Ölçüm sayacınız oran değil, kuyruk olsun. Karelere serpilmiş küçük bir açlık göze batmaz; tek seferlik uzun bir donma batar. `longestStarveMs` tutun.
13. Sahte taşıma katmanında jitter'ı **her** pakette çekin — düşenlerde bile. Kayıp oranını değiştirdiğinizde jitter dizisini yerinde tutan karar bu; mutasyonla ölçtüm, yükü taşıyan tek şey o. Ayrı RNG akışları tek başına yeterli değil ama yapıyı ileride kırılmaz kılıyor.
14. Sıra bozulması için ayrı bir düğmeye gerek yok — yeterli jitter onu kendiliğinden üretir. `poll` paketleri varış zamanına göre teslim etsin, `seq` geriye düştüğünde saysın.
15. Tampon boşaldığında bu kod donuyor. Dead reckoning / extrapolation daha iyi bir cevap ama ayrı bir konu; burada çözmüyoruz, ölçüyoruz.

Kodun tamamı — tampon, saat kestirimi, interpolasyon, sahte taşıma katmanı, açlık ölçüm düzeneği ve testler — GitHub'da. `npm test` mantığın tamamını tarayıcısız doğruluyor, `npm run bench` gecikme/jitter tablosunu Node altında üretiyor, `npm run dev` yan yana iki kümeli demoyu açıyor.

Bu yazıyı yazarken beni asıl durduran şey slerp'in matematiği değildi. `Quaternion.js`'i açıp `slerp`'i okuyana kadar, "t = 1'de tam olarak hedefi alırsın" cümlesini kurmaya hazırdım. Yıllardır öyle biliyordum. Kaynaktaki yirmi satır bana bunun yarısının yanlış olduğunu gösterdi — sonuç aynı dönüş, ama aynı sayılar değil. Bir kütüphaneyi kullanmakla nasıl çalıştığını bilmek arasındaki mesafe, çoğu zaman tek bir dosyanın uzağında duruyor. ⚙️🧠
