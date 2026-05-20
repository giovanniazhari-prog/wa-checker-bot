# WA Checker Bot

Bot Telegram untuk cek info akun WhatsApp secara massal menggunakan Baileys.js.

> Hosting: **Railway** — bukan Replit. Replit hanya dipakai untuk setup repo dan deploy awal.

Klasifikasi akun:
- Exclusive — Verified Meta (Official Business Account / centang biru)
- Standard Business — Akun bisnis dengan verifiedName dari WA server
- Low Business — Akun bisnis biasa tanpa verified name
- Personal — Akun WhatsApp personal
- Invalid — Nomor tidak terdaftar di WhatsApp

---

## Cara Run Lokal

```bash
cp .env.example .env
# Edit .env, isi BOT_TOKEN dengan token dari BotFather
npm install
npm start
```

---

## Environment Variables

| Variable | Default | Keterangan |
|---|---|---|
| `BOT_TOKEN` | — | **Wajib.** Token bot Telegram dari BotFather |
| `SESSION_FOLDER` | `./session` | Lokasi simpan session Baileys. Gunakan `/data/session` di Railway |
| `PAIRING_TIMEOUT_MS` | `60000` | Timeout pairing/koneksi WA dalam ms |
| `BOT_NAME` | `@YourBotName` | Nama bot di output file |
| `TIMEZONE` | `Asia/Jakarta` | Timezone output waktu |
| `BATCH_SIZE` | `50` | Jumlah nomor per batch |
| `DELAY_MS` | `500` | Delay antar batch (ms) |
| `BAILEYS_LOG_LEVEL` | `silent` | Level log Baileys (`silent`, `info`, `debug`) |

---

## Deploy ke Railway

1. Login ke [railway.app](https://railway.app)
2. New Project → Deploy from GitHub repo → pilih `wa-checker-bot`
3. Masuk ke tab **Variables**, tambahkan:
   - `BOT_TOKEN` = token dari BotFather
   - `SESSION_FOLDER` = `/data/session`
   - `PAIRING_TIMEOUT_MS` = `60000`
4. Untuk session WhatsApp yang persisten, buat **Railway Volume**:
   - Masuk ke service → Storage → Add Volume
   - Mount path: `/data`
   - Ini mencegah session hilang saat redeploy/restart
5. Railway akan auto-deploy. Tunggu status **Active**.

---

## Setup Railway Volume /data

Agar session WhatsApp tidak hilang saat redeploy:

1. Buka service di Railway dashboard
2. Klik tab **Storage**
3. Klik **Add Volume**
4. Mount Path: `/data`
5. Save — Railway akan redeploy otomatis

Session WA tersimpan di `/data/session`. Tanpa Volume, pairing WA akan hilang setiap kali service restart.

---

## Cara Pakai Bot

### Step 1: Pair WhatsApp

```
/pair +628123456789
/pair +15551234567
/pair +447700900123
/pair 60123456789
```

Bot kirim **Pairing Code**. Masukkan ke WA: Settings → Linked Devices → Link with Phone Number.

### Step 2: Upload File .txt

Buat file `.txt`, satu nomor per baris:

```
628123456789
08111222333
+15551234567
60123456789
+447700900123
```

Kirim file ke bot. Bot proses dan kirim hasil.

### Commands

```
/start   — Info bot
/pair    — Connect WhatsApp
/status  — Cek status koneksi
/help    — Panduan lengkap
```

---

## Tech Stack

- Runtime: Node.js 20+
- WA Library: Baileys (WhiskeySockets)
- Telegram: node-telegram-bot-api
- Deploy: Railway

---

## Disclaimer

Bot ini menggunakan WA non-resmi (Baileys), nomor WA yang dipakai bisa kena ban. Gunakan nomor dedicated, bukan nomor utama. Developer tidak bertanggung jawab atas ban atau penyalahgunaan.
