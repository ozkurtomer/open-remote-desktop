# Güvenlik

## Tasarım
- **Sahip kontrolü sunucuda:** Her cihaz bir kullanıcıya bağlıdır. Kullanıcı yalnızca kendi cihazlarını görür ve bağlanır. Başkasının cihazı ile olmayan cihaz aynı hatayı döner (ID taranamaz). Bu kural otomatik testlerle doğrulanır (`server/test`).
- **Kimlik doğrulama:** LDAP/Active Directory (kullanıcı kendi parolasıyla bind eder, parola sunucuda saklanmaz) veya yerel hesap (scrypt hash). Boş parola reddedilir (LDAP anonim bind). LDAP filtresi kaçışlanır. Düz metin `ldap://` varsayılan olarak reddedilir.
- **Cihaz kaydı:** Host uygulaması bir kez kullanıcı bilgisiyle kaydolur, 256 bit rastgele cihaz token'ı alır. Sunucu yalnızca SHA-256 özetini tutar. Host'ta token işletim sistemi anahtar deposuyla şifrelenir (Keychain/DPAPI). Parola host'ta saklanmaz.
- **Oturum:** HttpOnly + SameSite=Strict çerez, 12 saat. State-değiştiren isteklerde Origin ve Content-Type kontrolü, WebSocket'te Origin kontrolü (CSWSH).
- **Deneme sınırı:** Giriş, kayıt ve cihaz token denemelerinde IP ve kullanıcı bazlı kilit.
- **Şifreleme:** Video ve girdi WebRTC (DTLS-SRTP) ile uçtan uca şifrelidir. TURN röle olsa bile medyayı göremez. TURN kimlik bilgileri 1 saatlik, HMAC ile üretilir.
- **Görünürlük:** Bağlantı başladığında host'ta bildirim ve "UZAKTAN KONTROL AKTİF" durumu. İsteğe bağlı "her bağlantıda bana sor" modu.
- **Audit log:** `data/audit.log` (JSON satırları): giriş, başarısız giriş, cihaz kaydı/silme, bağlantı isteği, oturum başlangıç/bitiş.
- **Tek viewer:** Bir cihaza aynı anda bir bağlantı.

## Production gereksinimleri
- Sunucuyu **TLS** arkasında çalıştırın (Caddy yapılandırması dahil). Parolalar bu kanaldan geçer.
- Sunucuya yalnızca VPN/iç ağdan erişilsin. İnternete açmayın.
- `TURN_SECRET` uzun ve rastgele olsun. `data/` klasörüne yalnızca servis hesabı erişsin (yedekleri de koruyun).
- LDAP için salt-okunur servis hesabı ve `ldaps://` (veya StartTLS) kullanın.

## Kişisel mod ve internet tüneli
- Kişisel modda tek hesap (`owner`) vardır. Sunucu uygulamanın içinde çalışır ve varsayılan olarak yerel ağdan erişilebilir (düz HTTP). Parolanın şifresiz gitmemesi için yalnızca Tailscale/VPN veya güvenilir Wi-Fi üzerinden kullanın.
- **Cloudflare tüneli açıkken adres internete açıktır** ve tek savunma parolanızdır (HTTPS tünelde sağlanır, çerez `Secure`+`HttpOnly`+`SameSite=Strict`, deneme sınırı ve Origin kontrolü vardır). Uzun, benzersiz bir parola kullanın, işiniz bitince tüneli kapatın. Tünel varsayılan olarak kapalıdır ve her açılışta yeni, tahmin edilemez bir adres alır.
- Tünel yalnızca giriş ve bağlantı kurulumunu taşır; görüntü ve kontrol WebRTC ile doğrudan akar ve şifrelidir.
- Cloudflare tünel trafiğinin (giriş sayfası, parola dahil, TLS sonlandırması Cloudflare'de yapılır) görünür olduğu üçüncü taraftır. Bunu istemiyorsanız Tailscale kullanın.
- Bağımsız bir güvenlik incelemesinden geçmemiştir.

## Bilinen sınırlar
- **Hesap devre dışı bırakma gecikmesi:** AD'de devre dışı bırakılan kullanıcının mevcut tarayıcı oturumu (en çok 12 saat) ve kayıtlı cihaz token'ları sürer. Hemen kesmek için: `npm run admin -- del-user <kullanici>`. Gruba bağlı otomatik senkronizasyon yol haritasında.
- Hesap kilitleme saldırganın bir kullanıcıyı geçici kilitlemesine izin verebilir (VPN içinde düşük risk).
- Oturumlar bellekte tutulur, sunucu yeniden başlayınca herkes yeniden giriş yapar.
- Windows'ta UAC/kilit ekranı için servis modu yok, yalnızca birincil ekran paylaşılır.
- Veri deposu tek dosyadır (küçük/orta ölçek). Çok büyük kurulumlarda veritabanına geçilmelidir.
- Bağımsız bir güvenlik incelemesinden geçmemiştir. Şirket genelinde yaygınlaştırmadan önce yaptırın.

## Sorumlu kullanım
Yalnızca **sahibi olduğunuz veya açık izin aldığınız** cihazlarda kullanın.

## Açık bildirimi
Güvenlik açığını herkese açık issue yerine GitHub Security Advisories ile özel olarak bildirin.
