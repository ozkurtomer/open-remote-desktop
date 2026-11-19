# Open Remote Desktop

Kendi altyapınızda çalışan, açık kaynak (MIT) uzaktan masaüstü sistemi. AnyDesk/TeamViewer gibi üçüncü taraf bir servise bağlı değildir. VPN içinde, LDAP/Active Directory ile çalışacak şekilde tasarlandı: **herkes yalnızca kendi bilgisayarlarına bağlanabilir.**

```
Ofis PC (host, tepsi uygulaması) ──wss──┐
                                         ├──▶ [Sunucu: Caddy(TLS) → signaling+hesap/cihaz kaydı] + coturn   (iç ağ / VPN)
Ev PC (tarayıcı, LDAP girişi) ───VPN────┘
            └────────── video + fare/klavye: WebRTC (P2P veya TURN röle, şifreli) ──────────┘
```

| Klasör | Açıklama |
|---|---|
| `server/` | Signaling, hesap/cihaz kaydı, sahip kontrolü, audit log, LDAP, admin CLI, testler |
| `viewer/` | Tarayıcı arayüzü (giriş + "Cihazlarım"). Kurulum gerektirmez |
| `host/` | Paylaşılacak bilgisayarda çalışan Electron uygulaması (tepsi, otomatik bağlanma, ekran yakalama, girdi) |

## Kişisel kullanım (tek kişi, kendi bilgisayarına, ücretsiz)

Ayrı sunucu, hesap, LDAP veya bulut gerekmez. Sunucu host uygulamasının içinde çalışır.

**Hazır uygulama (macOS, Apple Silicon):** [Releases](../../releases) sayfasından `OpenRemoteDesktop-*-arm64.dmg` indir, aç, uygulamayı **Applications**'a sürükle.
İlk açılışta macOS "doğrulanamadı" derse (uygulama Apple'a ücretli kayıtlı bir geliştirici imzası taşımıyor, ad-hoc imzalı):
- Uygulamaya **sağ tık → Aç → Aç**, veya
- `xattr -cr /Applications/OpenRemoteDesktop.app` komutunu çalıştır.

Sonra *Ekran Kaydı* ve *Erişilebilirlik* izinlerini **OpenRemoteDesktop** için ver ve uygulamayı yeniden aç.

**Kaynaktan çalıştırma:**

1. `cd host && npm install && npm start`   (paket üretmek için: `npm run dist`)
2. **Kişisel (sadece ben)** sekmesinde bir parola belirle (en az 10 karakter), **Başlat**'a bas. Pencerede bağlantı adresleri ve QR kod çıkar.
3. **Aynı Wi-Fi'da:** telefonda çıkan adresi aç (`http://192.168.x.x:8080`), parolanla gir, **Bağlan**.
4. **Evin dışından (ücretsiz):** bu bilgisayara ve telefona [Tailscale](https://tailscale.com) kur, aynı hesapla giriş yap. Host penceresinde `100.x.x.x` adresi çıkar, telefonda onu aç. Tailscale trafiği şifreler, bu yüzden portu internete açmana gerek kalmaz.
5. macOS'ta *Ekran Kaydı* ve *Erişilebilirlik* izinlerini ver.

> **Güvenlik:** Adresi doğrudan internete açma (router'da port yönlendirme yapma). Düz HTTP ile parola gider, yalnızca Tailscale/VPN veya güvenilir yerel ağ üzerinden kullan. Uzun ve benzersiz bir parola seç.

Kişisel mod dışındaki bölümler (LDAP, sunucu kurulumu) şirket kullanımı içindir.

## Nasıl çalışır (şirket kurulumu)
1. Kullanıcı ofis bilgisayarında host uygulamasını açar, **şirket kullanıcı adı ve parolasıyla bir kez** bağlar. Parola saklanmaz, cihaz özel bir token alır.
2. Host arka planda çalışır ve sunucuya kalıcı bağlı kalır (kopunca otomatik yeniden bağlanır).
3. Kullanıcı evden VPN'e bağlanır, `https://rc.sirket.local` adresini açar, LDAP bilgileriyle girer ve **yalnızca kendi cihazlarını** görür.
4. **Bağlan**'a basınca ekran görünür ve kontrol edilir. Ofiste kimse onay vermek zorunda değildir (host'ta "her bağlantıda bana sor" ayarı açılabilir).

## Yerelde deneme (tek bilgisayar)

```bash
cd server && npm install
npm run admin -- add-user ali            # yerel deneme hesabı (parolayı sorar, min 10 karakter)
npm start                                # http://localhost:8080  (varsayılan AUTH_MODE=local)
```
```bash
cd host && npm install && npm start      # ikinci terminalde
```
1. Host penceresinde sunucu `http://localhost:8080`, kullanıcı `ali` ve parolayı girip **Bağla**'ya bas.
2. Tarayıcıda `http://localhost:8080` aç, `ali` ile giriş yap, cihazın listede **çevrimiçi** görünür, **Bağlan**.
3. macOS: *Privacy & Security* altında **Screen Recording** ve **Accessibility** izinlerini ver, host'u yeniden başlat.

Testler: `cd server && npm test`

## Şirkette kurulum (VPN içi)

**Gereksinimler:** İç ağda bir Linux VM, Docker, bir iç alan adı (`rc.sirket.local`), şirket CA'sından bu ad için sertifika, LDAP için salt-okunur servis hesabı.

```bash
cp .env.example .env            # RC_HOST, TURN_SECRET, LDAP_* alanlarını doldur
mkdir certs && cp rc.crt rc.key certs/    # (+ LDAP CA gerekiyorsa certs/ldap-ca.pem ve .env'de LDAP_CA_FILE=/certs/ldap-ca.pem)
docker compose up -d --build
```

**BT'den istenecekler (firewall):**
| Kaynak → Hedef | Port |
|---|---|
| VPN ve ofis ağı → sunucu | TCP 443 (arayüz + signaling) |
| VPN ve ofis ağı → sunucu | TCP/UDP 3478 (TURN) |
| VPN ve ofis ağı → sunucu | UDP 49160–49200 (TURN röle) |
| Sunucu → domain controller | TCP 636 (LDAPS) |

İnternet erişimi gerekmez. Harici STUN/bulut kullanılmaz. TURN'ün iç ağda şart olmasının sebebi: tarayıcılar yerel IP'leri `.local` (mDNS) adıyla gizler, mDNS VPN'den geçmez, bu yüzden doğrudan P2P çoğu zaman kurulamaz. TURN bunu ve VPN istemci izolasyonunu aşar.

**LDAP ayarları** (`.env`):
- Active Directory: varsayılanlar çalışır (`sAMAccountName`).
- OpenLDAP: `LDAP_USER_FILTER=(uid={u})`, `LDAP_ID_ATTR=uid`.
- Yalnızca belirli bir gruptakiler kullanabilsin: `LDAP_REQUIRED_GROUP=cn=uzaktan-erisim,ou=Groups,dc=sirket,dc=local`.
- Düz metin `ldap://` reddedilir. `ldaps://` kullanın veya `LDAP_STARTTLS=1` verin.
- `AUTH_MODE=both` yerel (acil durum/admin) hesapları LDAP ile birlikte açar.

**Host'ları dağıtma:** Uygulama paketlendiğinde oturum açılışında otomatik başlar (tepside). Çalışan sunucu adresini (`https://rc.sirket.local`) ve kendi LDAP bilgilerini bir kez girer. Şirket kök CA'sı işletim sistemine kuruluysa (kurumsal cihazlarda genelde kurulu) host sertifikaya güvenir.

**Yönetim:**
```bash
docker compose exec signaling node server/admin.js list-users
docker compose exec signaling node server/admin.js list-devices
docker compose exec signaling node server/admin.js del-user ali      # kullanıcı + cihazları
docker compose exec signaling tail -f /data/audit.log               # kim, ne zaman, hangi cihaz
```

## Güvenlik
Sahip kontrolü sunucuda ve testlidir, parolalar LDAP'ta kalır, medya uçtan uca şifrelidir. Ayrıntılar, bilinen sınırlar ve production gereksinimleri: [SECURITY.md](SECURITY.md).

## Yol haritası
- [ ] Windows servis modu (UAC / kilit ekranı)
- [ ] Paketleme (electron-builder), kod imzalama, otomatik güncelleme, toplu dağıtım (MSI/Intune)
- [ ] OIDC/SSO ve AD grup değişikliklerinin otomatik yansıması
- [ ] Çoklu monitör, pano ve dosya aktarımı, ses
- [ ] IT destek rolü (çalışan onayıyla başkasının cihazına bağlanma)
- [ ] CI (GitHub Actions)

## Durum
Erken aşama. Sunucu mantığı (sahip kontrolü, LDAP akışı, güvenlik kontrolleri) otomatik testlerle doğrulanır (sahte LDAP istemcisiyle). Gerçek bir LDAP sunucusu ve host'un ekran yakalama/girdi kısmı sizin ortamınızda denenmelidir.

## Katkı ve lisans
PR'lar açıktır, büyük değişikliklerden önce issue açın. [MIT](LICENSE): kullanabilir, değiştirebilir, ticari olarak da dağıtabilirsiniz.
