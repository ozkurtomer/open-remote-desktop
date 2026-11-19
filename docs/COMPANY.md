# Kurumsal / çoklu kullanıcı kurulumu (VPN içi, LDAP)

Kişisel mod tek bir bilgisayar içindir. Birden çok kullanıcının her birinin yalnızca **kendi** bilgisayarlarına bağlandığı, şirket içi (VPN arkasında) bir kurulum için ayrı bir sunucu çalıştırılır.

```
Ofis PC (host, tepsi uygulaması) ──wss──┐
                                         ├──▶ [Caddy(TLS) → sunucu: LDAP girişi + cihaz sahipliği] + coturn   (iç ağ / VPN)
Ev PC / telefon (tarayıcı, LDAP girişi) ──VPN──┘
```

## Nasıl çalışır
1. Kullanıcı ofis bilgisayarındaki uygulamada **Sunucuya bağlan** sekmesinden şirket kullanıcı adı ve parolasıyla bir kez bağlar. Parola saklanmaz, cihaz özel bir token alır.
2. Uygulama arka planda sunucuya kalıcı bağlı kalır.
3. Kullanıcı VPN'e girer, sunucu adresini açar, LDAP bilgileriyle giriş yapar ve **yalnızca kendi cihazlarını** görür. Sahip kontrolü sunucuda yapılır ve testlidir.

## Sunucu kurulumu

Gereksinimler: iç ağda bir Linux VM, Docker, bir iç alan adı, şirket CA'sından sertifika, LDAP için salt-okunur servis hesabı.

```bash
cp .env.example .env            # RC_HOST, TURN_SECRET, LDAP_* alanlarını doldur
mkdir certs && cp rc.crt rc.key certs/
docker compose up -d --build
```

Güvenlik duvarı:

| Kaynak → Hedef | Port |
|---|---|
| VPN ve ofis ağı → sunucu | TCP 443 |
| VPN ve ofis ağı → sunucu | TCP/UDP 3478 (TURN) |
| VPN ve ofis ağı → sunucu | UDP 49160–49200 (TURN röle) |
| Sunucu → domain controller | TCP 636 (LDAPS) |

TURN, iç ağda şarttır: tarayıcılar yerel IP'leri mDNS ile gizler ve mDNS VPN'den geçmez.

## LDAP ayarları (`.env`)
- Active Directory: varsayılanlar çalışır (`sAMAccountName`).
- OpenLDAP: `LDAP_USER_FILTER=(uid={u})`, `LDAP_ID_ATTR=uid`.
- Yalnızca bir gruptakiler: `LDAP_REQUIRED_GROUP=cn=uzaktan-erisim,ou=Groups,dc=sirket,dc=local`.
- Düz metin `ldap://` reddedilir; `ldaps://` veya `LDAP_STARTTLS=1` kullanın.
- `AUTH_MODE=both` yerel (acil durum/admin) hesapları LDAP ile birlikte açar.

## Yönetim
```bash
docker compose exec signaling node server/admin.js list-users
docker compose exec signaling node server/admin.js list-devices
docker compose exec signaling node server/admin.js del-user ali
docker compose exec signaling tail -f /data/audit.log
```

## Durum
LDAP akışı sahte bir LDAP istemcisiyle test edildi, gerçek bir domain controller'la denenmedi. Üretimde kullanmadan önce kendi ortamınızda deneyin ve bağımsız güvenlik incelemesi yaptırın. Sınırlar için [SECURITY.md](../SECURITY.md).
