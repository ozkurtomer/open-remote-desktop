# Open Remote Desktop

**Kendi bilgisayarına uzaktan eriş: açık kaynak, ücretsiz, hesap yok, üçüncü taraf servis yok.**
*Reach your own computer from your phone or another device. Open source, free, no account, no third-party remote-desktop service.*

Tek uygulama: bilgisayarına kur, bir parola belirle, telefonundan tarayıcıyla bağlan. AnyDesk/TeamViewer'a gerek yok.

## Özellikler

- **Tek paket:** Sunucu, web arayüzü ve internet tüneli uygulamanın içinde gömülü. Ayrıca bir şey kurmazsın.
- **Telefona kurulum yok:** Telefondan sadece tarayıcı. Dokunmatik kontrol: imleç sürükleme, tık, sağ tık, kaydırma, ekran klavyesi, Ctrl/⌘/Esc/ok tuşları.
- **Ücretsiz uzaktan erişim:** Tek tuşla Cloudflare tüneli (hesap açmadan) veya Tailscale ile.
- **Gözetimsiz erişim:** Bilgisayarının başında kimse olmasa da bağlanırsın. Bağlanınca bilgisayarda bildirim çıkar.
- **Şifreli:** Görüntü ve kontrol WebRTC ile uçtan uca şifrelenir. Parola yalnızca özet (scrypt) olarak saklanır.
- **İsteğe bağlı kurumsal mod:** LDAP/Active Directory, çoklu kullanıcı, VPN içi kurulum: [docs/COMPANY.md](docs/COMPANY.md).

## Kurulum

[**Releases**](../../releases) sayfasından işletim sistemine uygun dosyayı indir:

| Sistem | Dosya | Durum |
|---|---|---|
| macOS (Apple Silicon) | `OpenRemoteDesktop-*-mac-arm64.dmg` | Denendi (yerel derleme) |
| macOS (Intel) | `OpenRemoteDesktop-*-mac-x64.dmg` | GitHub Actions ile üretilir, **denenmedi** |
| Windows | `OpenRemoteDesktop-*-win-x64.exe` | GitHub Actions ile üretilir, **denenmedi** |
| Linux | `OpenRemoteDesktop-*-linux-x64.AppImage` | GitHub Actions ile üretilir, **denenmedi** |

**macOS:** `.dmg`'yi aç, uygulamayı **Applications**'a sürükle. Uygulama Apple'a ücretli kayıtlı bir geliştirici imzası taşımıyor (ücretsiz "ad-hoc" imzalı), bu yüzden ilk açılışta macOS "doğrulanamadı" diyebilir:
- uygulamaya **sağ tık → Aç → Aç**, veya
- `xattr -cr /Applications/OpenRemoteDesktop.app`

Sonra *Sistem Ayarları → Gizlilik ve Güvenlik* altında **Ekran Kaydı** ve **Erişilebilirlik** izinlerini *OpenRemoteDesktop* için ver ve uygulamayı yeniden aç.

## Kullanım

1. Uygulamayı aç, **Kişisel (sadece ben)** sekmesinde bir parola belirle (en az 10 karakter, uzun ve benzersiz olsun), **Başlat**'a bas.
2. Pencerede adres ve QR kod çıkar.
3. Telefonda adresi aç (veya QR'ı tara), parolanla giriş yap, bilgisayarını seç, **Bağlan**.

### Başka ağdan (evin dışından) bağlanmak

| Yöntem | Telefona kurulum | Nasıl | Dikkat |
|---|---|---|---|
| **Aynı Wi-Fi** | Yok | Pencerede görünen `http://192.168.x.x:8080` adresi | Yalnızca aynı ağda |
| **Cloudflare tüneli** (uygulamada tek tuş) | Yok | **İnternetten erişimi aç** düğmesi, çıkan `https://...trycloudflare.com` adresi | Adres **internete açık**, yalnızca parolan korur. Adres her açışta değişir. Cloudflare bu özelliği "test/geliştirme amaçlı" olarak sunar, çalışma süresi garantisi yoktur |
| **Tailscale** | Tailscale uygulaması | Her iki cihaza [Tailscale](https://tailscale.com) kur (kişisel kullanım ücretsiz), aynı hesapla gir, pencerede çıkan `100.x.x.x` adresini aç | En güvenli seçenek: internete hiçbir şey açılmaz |

> **Görüntü akışı tünelden geçmez.** Tünel yalnızca giriş ve bağlantı kurulumu içindir. Görüntü, telefon ile bilgisayar arasında doğrudan (WebRTC) akar. Bazı operatör/ağ yapılarında (özellikle mobil veri) doğrudan bağlantı kurulamayabilir ve görüntü gelmeyebilir. Bu durumda aynı Wi-Fi veya Tailscale kullan. Ücretsiz TURN röle desteği yol haritasında.

## Güvenlik

Uygulamayı kullanmadan önce [SECURITY.md](SECURITY.md) dosyasını oku. Özet:
- Adresi router'da port yönlendirerek internete **açma**. Düz HTTP ile parola şifresiz gider; yalnızca Tailscale, kendi Wi-Fi'ın veya HTTPS tüneli üzerinden kullan.
- Tüneli açıkken parolan tek savunma hattın. Uzun ve benzersiz bir parola seç, işin bitince tüneli kapat.
- **Bu proje bağımsız bir güvenlik incelemesinden geçmedi.** Hassas ortamlarda kullanmadan önce kodu kendin incele.
- Yalnızca **sahibi olduğun** bilgisayarlarda kullan.

## Kaynaktan derleme

```bash
git clone <bu-repo> && cd open-remote-desktop/host
npm install
npm run fetch-cloudflared   # cloudflared'i indirir (SHA-256 doğrulamalı)
npm start                   # geliştirme
npm run dist                # kurulum paketi üretir (host/dist/)
```
Sunucu testleri: `cd server && npm install && npm test`

## Nasıl çalışır

```
Telefon (tarayıcı) ──https/wss──▶ [Uygulama içindeki sunucu: giriş, eşleştirme]
        ▲                                   │ (cloudflared tüneli veya LAN/Tailscale)
        └──── video + fare/klavye: WebRTC (P2P, şifreli) ◀──── Uygulama (ekran yakalama, girdi)
```
- `host/`: Electron uygulaması (ekran yakalama, fare/klavye uygulama, tepsi, tünel yönetimi)
- `server/`: giriş, cihaz sahipliği, eşleştirme (signaling), testler
- `viewer/`: telefon/tarayıcı arayüzü (dokunmatik kontrol dahil)

## Bilinen sınırlar

- Yalnızca birincil ekran paylaşılır; ses yok; pano/dosya aktarımı yok.
- Çift tıklamanın hedef bilgisayarda doğru algılandığı doğrulanmadı.
- Windows'ta UAC/kilit ekranı kontrol edilemez (servis modu yok).
- Windows ve Linux paketleri CI ile üretilir ama gerçek cihazlarda denenmedi.
- Hızlı tünel adresi her açılışta değişir; kalıcı adres için kendi Cloudflare hesabınla adlandırılmış tünel veya Tailscale kullan.

## Yol haritası

- [ ] Ücretsiz TURN röle desteği (mobil veride bağlantı için)
- [ ] Windows servis modu, çoklu monitör, pano ve dosya aktarımı
- [ ] İki adımlı doğrulama (TOTP)
- [ ] Apple geliştirici imzası/notarization ve Windows imzalama
- [ ] Otomatik güncelleme

## Katkı ve lisans

PR'lar açıktır, büyük değişikliklerden önce issue açın. Lisans: [MIT](LICENSE). Üçüncü taraf bileşenler: [THIRD_PARTY.md](THIRD_PARTY.md).
