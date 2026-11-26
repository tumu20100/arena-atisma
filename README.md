# Arena Atışma

Dostlarınla birgə və ya bir-birinizə qarşı oynaya biləcəyin 3D atışma oyunu. Birinci şəxs görünüşü, 4 silah, 3 rejim, 12 oyunçuya qədər.

## 1. Qurulum (2 dəqiqə)

1. [Node.js](https://nodejs.org) yüklə (18 və ya daha yeni versiya). Başqa heç nə quraşdırmaq lazım deyil.
2. Bu qovluqda terminal aç və yaz:

   ```
   node server.js
   ```
3. Brauzerdə `http://localhost:3000` aç. Adını yaz, **Oyuna qoşul** bas.

Server işə düşəndə konsolda "Eyni Wi-Fi-da" ünvanı da görünəcək.

> Oyun Chrome, Edge və ya Firefox ilə kompüterdə oynanır. 3D şəkil və kitabxana (Three.js) internetdən yüklənir, ona görə oynayarkən internet lazımdır.

## 2. Dostlar necə qoşulur?

**Eyni Wi-Fi-dasınızsa:** dostlar brauzerdə konsolda yazılan ünvanı açır, məsələn `http://192.168.1.15:3000`. Qoşula bilmirlərsə, kompüterin firewall-u 3000 portuna icazə verməlidir.

**Fərqli yerlərdəsinizsə (ən asan yol):** serveri öz kompüterində saxla və müvəqqəti açıq link yarat. Hesab açmaq lazım deyil:

```
cloudflared tunnel --url http://localhost:3000
```

([cloudflared yükləmə səhifəsi](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)). Verilən `https://....trycloudflare.com` linkini dostlara göndər. Alternativ: `ngrok http 3000`.

**Daimi server istəyirsənsə:** layihəni Render, Railway, Fly.io və ya istənilən Node.js hostinqinə yüklə. Start əmri `node server.js` olsun. Server `PORT` dəyişənini avtomatik oxuyur, `/health` ünvanı yoxlama üçündür.

## 3. Otaq və rejimlər

- **Otaq kodu** boş qalsa, yeni otaq yaranır və kod ekranın sol yuxarısında görünür. Ora klikləyin (və ya Esc basıb "Dəvət linkini kopyala") və dostlara göndərin. Link açılanda kod avtomatik yazılır.
- Dostlar eyni kodu yazıb qoşulur. Rejimi otağı yaradan seçir.

| Rejim | Qayda |
|---|---|
| Hamı hamıya qarşı | Hər kəs tək oynayır. 20 öldürməyə ilk çatan qalibdir. |
| Komanda döyüşü | Qırmızı və Mavi komandalar avtomatik bərabər bölünür. Öz komandana atəş zədə vurmur. 30 xala ilk çatan qalibdir. |
| Birgə | Hamınız birlikdə botlara qarşısınız. Dalğalar getdikcə güclənir. Ölən oyunçu növbəti dalğada canlanır. Hamı eyni anda ölsə oyun bitir. |

Raund bitəndən 8 saniyə sonra yeni oyun avtomatik başlayır.

## 4. İdarəetmə

| Düymə | İş |
|---|---|
| W A S D | hərəkət |
| Siçan | ətrafa baxmaq |
| Sol klik | atəş |
| Sağ klik | nişan almaq (snayperdə durbin) |
| Boşluq | tullanmaq (alçaq qutuların üstünə çıxmaq olar) |
| Ctrl (basılı saxla) + W | sürətli qaçış |
| W-ni 2 saniyə basılı saxla | **avtomatik qaçış** (aşağıya bax) |
| Shift (basılı saxla) | əyilmək: daha yavaş, amma hədəf kiçilir və güllələr üstündən keçə bilər |
| 1 2 3 4 və ya siçan çarxı | silah dəyişmək |
| R | doldurmaq |
| Tab (basılı saxla) | xal cədvəli |
| Enter | söhbət |
| Esc | fasilə (buradan Ayarlara girmək olar) |

## 5. Silahlar

| Silah | Zədə | Sürət | Qoruyucu | Qeyd |
|---|---|---|---|---|
| Tapança | 22 | orta | 12 | dəqiq |
| Avtomat | 14 | çox sürətli (basılı saxla) | 30 | ən universal |
| Pompalı | 8 saçma x 11 | yavaş | 6 | yaxın məsafədə güclü |
| Snayper | 85 | çox yavaş | 5 | ən uzaq məsafə |

Başa vurulan atəş 2 dəfə zədə vurur, uzaq məsafədə zədə azalır. Beş saniyə zədə almasan can yavaş-yavaş bərpa olur.

## 6. Kask və bədənlik

Hər oyunçu kask (50) və bədənliklə (60) doğulur. Kask başa dəyən zədənin yarısını, bədənlik bədənə dəyən zədənin yarısını udur. Dayanıqlıq bitəndən sonra tam zədə keçir. Ekranın sol aşağısında can çubuğunun altında hər ikisi görünür. Ölüb yenidən doğulanda tam bərpa olur. Birgə rejimdə hər dalğa başlayanda sağ qalanların kaskı və bədənliyi yenilənir. Botlarda kask və bədənlik yoxdur.

### Avtomatik qaçış

2 saniyə fasiləsiz irəli getsəniz, personaj özü qaçmağa başlayır və W-ni buraxsanız da qaçmağa davam edir. Geri getmək istəsəniz (S), əyilsəniz (Shift), nişan alsanız və ya divara dirənsəniz, normal yerişə keçir. Ayarlardan söndürmək olar.

## 6a. Ayarlar

Lobbidə "Ayarlar" düyməsi, oyun içində Esc → Ayarlar (telefonda ⚙ düyməsi):

- Səsləri ümumiyyətlə açıb bağlamaq və ümumi səs səviyyəsi
- Ayrıca: atəş səsləri, addım səsləri, zərbə/xəbərdarlıq səsləri
- Siçan həssaslığı
- Avtomatik qaçışı açıb bağlamaq
- Telefonda: **düymələrin yerini və ölçüsünü dəyişmək**. "Düymələrin yerini dəyiş" seçin, düyməni barmaqla istədiyiniz yerə sürüşdürün, aşağıdakı çubuqla böyüdün/kiçildin, "Hazır" basın. "Sıfırla" ilkin düzülüşü qaytarır.

Ayarlar brauzerdə yadda qalır.

## 7. Telefonda oynamaq

Telefonun brauzerində eyni linki açın, telefonu **üfüqi** tutun.

- Solda joystik: hərəkət. Sağ tərəfdə ekranı barmaqla sürüşdürün: ətrafa baxmaq.
- Düymələr: ATƏŞ, TULLAN, NİŞAN (aç/bağla), DOLDUR, ƏYİL (aç/bağla), QAÇ (aç/bağla), CƏDVƏL.
- Silah dəyişmək üçün yuxarıdakı silah adına toxunun.
- Android Chrome-da oyun tam ekrana keçir. iPhone-da Safari tam ekranı dəstəkləmir, ən yaxşı nəticə üçün "Paylaş → Ana ekrana əlavə et" ilə quraşdırıb oradan açın.
- Zəif telefonlarda kölgələr və şəkil keyfiyyəti avtomatik azaldılır.

## 8. Layihənin quruluşu

```
server.js          oyun serveri (asılılıqsız: HTTP + WebSocket + oyun qaydaları + botlar)
public/index.html  menyu və ekran interfeysi
public/client.js   3D müştəri (Three.js), idarəetmə, səs, HUD
public/shared.js   server və brauzerin ortaq istifadə etdiyi xəritə, silahlar, toqquşma hesabı
```

**Dəyişdirmək istəyirsənsə:** silahların rəqəmləri (`WEAPONS`) və xəritə (`addBox`, `sym` sətirləri) `public/shared.js` faylındadır. Qalib xalı və otaq ölçüsü `server.js`-in yuxarısındadır. Fayl dəyişəndən sonra serveri yenidən başladın.

## 9. Texniki qeydlər

- Hərəkət oyunçunun öz brauzerində hesablanır, atəş, zədə, öldürmə və xal isə serverdə. Server oyunçunun sürətini yoxlayır, amma bu, ciddi aldatma müdafiəsi deyil. Dost oyunları üçün yetərlidir.
- Gecikmə kompensasiyası yoxdur. İnternet üzərindən yüksək pinqlə (150 ms-dən çox) vurmaq çətinləşə bilər.
- Ctrl+W brauzer qısayolu olduğu üçün tam ekran açıq olmalıdır (menyudakı qutu). Tam ekranı söndürsəniz, Ctrl+W oyunu yox, brauzer səhifəsini bağlaya bilər.
- Fayllar GitHub-a `public` qovluğu olmadan, birbaşa kökə yüklənibsə də server işləyir.
