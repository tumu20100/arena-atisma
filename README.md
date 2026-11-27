# Arena Atışma

Dostlarınla birgə və ya bir-birinizə qarşı oynaya biləcəyin 3D atışma oyunu. Birinci şəxs görünüşü, 10 silah, 3 rejim, 12 oyunçuya qədər.

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

## 3a. Xəritələr

Lobbidə otaq yaradanda xəritə seçilir (qoşulanlar otağın xəritəsini görür).

- **Arena**: böyüdülmüş beton meydança. Hər oyun başlayanda və hər ölümdən sonra **silah seçim ekranı** açılır: 1 tapança + 2 əsas silah seçirsən, "Başla" basırsan. Seçim yadda qalır. Birgə (bot) rejimi yalnız burada işləyir.
- **Açıq dünya**: 700×700 metrlik nəhəng ərazi (əvvəlkindən ~15 dəfə böyük), ~220 ev, kəndlər, meşələr, daşlar, qutular. Hamı **silahsız, kasksız, bədənliksiz** başlayır. Evlərin içində və qutuların yanında yerdə əşyalar var (~650 yer): 10 silah, 3 səviyyəli kask və bədənlik, tibbi çanta, bandaj, qumbara, tüstü, durbin, susdurucu. Üstünə yaxınlaşmaq kifayətdir, avtomatik götürülür. Götürülən əşya 45 saniyəyə yenidən çıxır. Ölən oyunçunun daşıdığı bütün silahlar, kaskı və bədənliyi düşür.
  - **3 slot:** eyni anda ən çox 3 silah daşıyırsan. Slotlar doludursa yerdəki silah götürülmür. **Q** (telefonda **AT** düyməsi) ilə əlindəki silahı yerə ata bilərsən, sonra başqasını götürərsən.
  - **Nadirlik:** silah nə qədər güclüdürsə, bir o qədər az tapılır (ən çox P92, ən az AWM).
- **Maşın** (açıq dünyada 8 ədəd): yaxınlaşıb **E** bas, minirsən. W/S qaz-əyləc, A/D sükan, Boşluq əl əyləci, yenə E ilə düşürsən. Maşınla adam vurmaq zədə verir. Telefonda ekrandakı **MİN/DÜŞ** düyməsi var.


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
| 1 - 0 və ya siçan çarxı | silah dəyişmək |
| G / H | qumbara / tüstü qumbarası |
| R | doldurmaq |
| Tab (basılı saxla) | xal cədvəli |
| Enter | söhbət |
| E | maşına min / maşından düş |
| Q | silahı yerə at (açıq dünya, 3 slot) |
| F | tam ekran (ekrandakı ⛶ düyməsi də var) |
| Esc | fasilə (buradan Ayarlara girmək olar) |

## 5. Silahlar (10 ədəd)

| Silah | Zədə | Atəş | Dolu | Qeyd |
|---|---|---|---|---|
| P92 (tapança) | 22 | orta | 12 | dəqiq |
| Deagle | 46 | yavaş | 7 | güclü tapança |
| UZI | 10 | çox sürətli | 30 | yaxın məsafə, səpələnir |
| M416 | 14 | sürətli | 30 | ən universal |
| AKM | 19 | sürətli | 30 | M416-dan güclü, geri təpən çox |
| SKS | 36 | orta | 10 | dəqiq, uzaq məsafə (yarımavtomat) |
| M249 | 13 | sürətli | 75 | pulemyot, doldurması uzundur |
| S12K (pompalı) | 8 saçma x 11 | yavaş | 6 | yaxında çox güclü |
| Kar98k | 85 | çox yavaş | 5 | uzaq məsafə |
| AWM | 110 | çox yavaş | 5 | ən güclü snayper |

Silah dəyişmək: **1 2 3 4 5 6 7 8 9 0** düymələri və ya siçan çarxı. Telefonda yuxarıdakı rəqəmlərə toxunun.

## 6. Kask və bədənlik (3 səviyyə)

| Səviyyə | Kask | Bədənlik |
|---|---|---|
| 1 | 50 dayanıqlıq, zədənin 45%-ni udur | 60 dayanıqlıq, 35% |
| 2 | 90 dayanıqlıq, 60% | 100 dayanıqlıq, 50% |
| 3 | 130 dayanıqlıq, 75% | 150 dayanıqlıq, 65% |

Kask başa, bədənlik bədənə dəyən zədəni azaldır. Dayanıqlıq bitəndən sonra tam zədə keçir. Yüksək səviyyəli kask/bədənlik aşağıdakını əvəz edir. Eyni səviyyəni götürsəniz dayanıqlıq bərpa olur. Arenada hamı 2-ci səviyyə ilə başlayır, açıq dünyada heç nə olmadan. Botlarda kask və bədənlik yoxdur.

## 6b. Qumbaralar, əlavələr, müalicə

- **Qumbara (G)**: 3 saniyədən sonra partlayır, 8 metr radiusda zədə verir (yaxında öldürür). Divarlar partlayışı saxlayır, bədənlik zədəni azaldır. Öz qumbaranız sizə də zərər verir, komanda rejimində komanda yoldaşlarına verməz.
- **Tüstü qumbarası (H)**: 1,5 saniyədən sonra 15 saniyəlik tüstü buludu yaradır, görünüşü bağlayır.
- **Durbin**: nişan alanda (ADS) yaxınlaşdırma güclənir, istənilən silahla işləyir.
- **Susdurucu**: atəşi yalnız 28 metr yaxınlıqdakılar eşidir və görür, atəş alovu görünmür.
- **Tibbi çanta**: canı tam doldurur. **Bandaj**: +20 can.

Açıq dünyada bunların hamısı evlərdə və qutuların yanında tapılır. Arenada hər kəs 2 qumbara və 1 tüstü qumbarası ilə doğulur. Telefonda ekranın yuxarı sağında "BOMBA" və "TÜSTÜ" düymələri var (düzülüşü ayarlarda dəyişmək olar).

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
