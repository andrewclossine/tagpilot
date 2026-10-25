# Gushyira TAGPILOT online kuri VPS ya Megabit

Iyi nyandiko isobanura intambwe ku yindi uko TAGPILOT ishyirwa kuri server (VPS) yanyu.
Iyo birangiye, kuri server haba harimo ibi bitatu bikorera hamwe muri Docker:

- **app**: software ya TAGPILOT,
- **db**: database ya PostgreSQL (ishyirwa kuri server ubwayo, ntimukeneye kuyigura ukwayo),
- **HTTPS**: icyemezo cy'umutekano (cadenas 🔒) kibonwa kandi kikavugururwa nta muntu ukivugurura.

---

## 0. Ibyo mukenera mbere yo gutangira

| Igikenewe | Aho mukibona |
|---|---|
| **Domain** (urugero `tagpilot.com` cyangwa `tagpilot.rw`) | Mugura kuri Megabit ubwayo, Namecheap, cyangwa Cloudflare |
| **Aderesi ya IP ya VPS** n'uburyo bwo kuyinjiramo (SSH) | Kuri konti yanyu ya Megabit (email bohereje igihe mwaguraga VPS) |
| **Repository ya GitHub ya private** yitwa `tagpilot` | github.com → **New repository** → *Private* → ntimushyiremo README |

---

## 1. Guhuza domain na server (DNS)

Ahantu mwaguriye domain, mujye kuri **DNS settings**, maze mwongeremo:

| Type | Name | Value |
|---|---|---|
| A | `@` | IP ya VPS yanyu |
| A | `www` | IP ya VPS yanyu |

Bishobora gufata kuva ku minota mike kugeza ku masaha 24 kugira ngo bikore hose.

---

## 2. Kwinjira kuri server

Kuri Windows, fungura **PowerShell** maze wandike (simbuza `root` na `IP` n'ibyanyu):

```
ssh root@IP
```

Ibikurikira byose mubyandikira **kuri server**.

---

## 3. Gushyiraho Docker (rimwe gusa)

```
curl -fsSL https://get.docker.com | sh
docker --version
```

Reba niba hari indi website (urugero hrleave.com) isanzwe ikoresha imiryango 80/443:

```
sudo ss -tlnp | grep -E ':80 |:443 '
```

- **Niba nta kigaragara**: muzakoresha **Inzira A** (Caddy).
- **Niba hagaragara nginx cyangwa apache**: muzakoresha **Inzira B** (nginx).

---

## 4. Kuzana code kuri server

1. Kuri server, mukore urufunguzo (key) rwo gusoma kuri GitHub:
   ```
   ssh-keygen -t ed25519 -f ~/.ssh/tagpilot_deploy -N ""
   cat ~/.ssh/tagpilot_deploy.pub
   ```
2. Kuri GitHub: repository `tagpilot` → **Settings → Deploy keys → Add deploy key**. Mushyiremo ibyasohotse (bitangira `ssh-ed25519`). **Ntimutikure** kuri "Allow write access".
3. Kuri server:
   ```
   printf 'Host github.com\n  IdentityFile ~/.ssh/tagpilot_deploy\n' >> ~/.ssh/config
   git clone git@github.com:IZINA-RYANYU/tagpilot.git /opt/tagpilot
   cd /opt/tagpilot
   ```

---

## 5. Igenamiterere (`.env`)

```
cp .env.production.example .env
openssl rand -hex 24
nano .env
```

Muri `.env`, mwuzuze:
- `DOMAIN=` domain yanyu (nta `https://`)
- `POSTGRES_PASSWORD=` ijambo ry'ibanga ryavuye kuri `openssl rand -hex 24`
- `ANTHROPIC_API_KEY=`, Flutterwave (`FLW_...`) na SMTP

Mubike (save) mukanda **Ctrl+O**, **Enter**, hanyuma **Ctrl+X**. **Iyi file ntijya kuri GitHub**, kandi ntimuyihe undi muntu.

---

## 6. Gutangiza TAGPILOT

**Inzira A: nta yindi website iri kuri server**

```
docker compose --profile https up -d --build
```

**Inzira B: nginx isanzwe iriho (urugero kubera hrleave.com)**

```
docker compose up -d --build
sudo cp deploy/nginx-tagpilot.conf /etc/nginx/sites-available/tagpilot
sudo nano /etc/nginx/sites-available/tagpilot      # simbuza tagpilot.example.com na domain yanyu
sudo ln -s /etc/nginx/sites-available/tagpilot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d DOMAIN-YANYU -d www.DOMAIN-YANYU
```

Ubwa mbere bifata iminota 3 kugeza kuri 10, kubera ko software ibanza kubakwa (build).

**Kugenzura:** fungura `https://DOMAIN-YANYU/api/health`. Igomba kwerekana `{"ok":true}`.
Hanyuma mujye kuri `https://DOMAIN-YANYU/signup` mukore konti ya mbere y'admin.

---

## 7. Backup buri munsi (ni ngombwa)

```
chmod +x /opt/tagpilot/deploy/backup.sh
crontab -e
```

Mwongeremo uyu murongo. Buri joro saa 02:30 database na documents bibikwa muri `/opt/tagpilot-backups`, kandi backup zibikwa iminsi 14:

```
30 2 * * * cd /opt/tagpilot && ./deploy/backup.sh >> /var/log/tagpilot-backup.log 2>&1
```

Inama: rimwe mu cyumweru, mujye mumanura (download) backup imwe muyibike ahandi hatari kuri server.

---

## 8. Umutekano wa server

```
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Database ntigera kuri internet: iboneka imbere muri Docker gusa.

---

## 9. Ibindi bigenamiterere

- **Flutterwave** → Settings → Webhooks: URL `https://DOMAIN-YANYU/api/flutterwave/webhook`, kandi secret hash ihuye na `FLW_SECRET_HASH` iri muri `.env`.
- **SMTP**: amakuru ya email (Megabit itanga na email, cyangwa mukoreshe Gmail).

---

## 10. Kuvugurura TAGPILOT (iyo hari ibishya)

```
cd /opt/tagpilot
git pull
docker compose up -d --build
```

Database ivugururwa ubwayo iyo software itangiye.

## Iyo hari ikibazo

```
docker compose ps                  # ibiri gukora
docker compose logs -f app         # ibyo software yandika (kanda Ctrl+C kugira ngo uhagarike)
docker compose restart app         # kongera kuyitangiza
```
