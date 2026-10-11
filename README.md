# SERA

**Sparse-sensing Equitable Rolling Allocation** — *decision-support layer* untuk
jaringan irigasi tersier yang bekerja dengan **sensing terbatas**.

SERA mengestimasi kondisi jaringan yang tidak terukur lengkap, menghitung
kebutuhan air tanaman, mengingat **histori pelayanan** tiap blok, lalu
mengoptimalkan alokasi secara **berulang (rolling)** saat kondisi berubah —
supaya keputusan alokasi tetap **layak, adil, dan aman bagi tanaman** meski
informasi yang tersedia sedikit.

> SERA bukan "smart irrigation" generik, bukan produk IoT, dan bukan pengganti
> aturan kelembagaan air. Ia duduk di atas aturan yang sudah ada (giliran,
> entitlement, jadwal P3A) dan membantu operator membuat keputusan yang bisa
> dijelaskan dan diuji.


## Status

Fondasi repositori. Setiap angka performa adalah **hipotesis** sampai eksperimen
berjalan dan artefaknya tersedia di `experiments/results/`. Batas demonstrator
hardware (HIL, bukan validasi lapangan) 

## Arsitektur

```text
                    ┌──────────────────────────────┐
                    │        SERA WEB APP          │
                    │   React + Vite + TypeScript  │
                    │  /operations      /lab       │
                    └───────────────┬──────────────┘
                                    │ HTTP + WebSocket
                                    ▼
                    ┌──────────────────────────────┐
                    │        NESTJS API            │
                    │  auth · users · networks     │
                    │  telemetry · plans · approval│
                    │  audit · MQTT · WebSocket    │
                    └───────┬──────────────┬───────┘
                            │              │
                 REST/JSON  │              │  PostgreSQL (Prisma)
                            ▼              ▼
              ┌──────────────────┐   ┌──────────────────────┐
              │   FASTAPI        │   │  PostgreSQL          │
              │   SCIENTIFIC     │   └──────────────────────┘
              │  simulator       │
              │  estimator       │   ┌──────────────────────┐
              │  demand · ledger │   │  Parquet files       │
              │  optimizer       │   │  (hasil eksperimen)  │
              │  experiment      │   └──────────────────────┘
              └────────┬─────────┘
                       ▼
              ┌──────────────────┐
              │ OR-Tools HiGHS   │
              │ / SCIP           │
              └──────────────────┘

   ┌──────────────┐   MQTT   ┌───────────────┐
   │ ESP32 +      │ ───────► │  MOSQUITTO    │ ───► NestJS (telemetry ingest)
   │ sensor/gate  │ ◄─────── │  broker       │ ◄─── NestJS (command publish)
   └──────────────┘ command  └───────────────┘
```

Tujuh prinsip yang mengikat: satu mesin dua GUI, pemisahan domain,
simulation-first, contract-first, human-in-the-loop, graceful degradation,
observability sejak awal. Detail + ADR di
[`docs/SERA_v3_02_ARSITEKTUR.md`](../docs/SERA_v3_02_ARSITEKTUR.md).

## Struktur repository

Monorepo npm workspaces (`apps/*`, `services/*`, `packages/*`).

```text
SERA/
├── apps/
│   └── web/              # React 19 + Vite + TanStack Router/Query  (@sera/web)
├── services/
│   ├── api/              # NestJS 11 + Prisma 7 + MQTT + WebSocket  (@sera/api)
│   └── solver/           # FastAPI + OR-Tools (Python, scientific engine)
├── packages/
│   └── contracts/        # tipe & validator bersama TS  (@sera/contracts)
├── firmware/
│   └── esp32/            # PlatformIO — node device (mode mock)
├── experiments/          # config & artefak eksperimen (bukan kode service)
├── scripts/
│   └── e2e-smoke.sh      # uji end-to-end lintas service
├── docs/                 # dokumentasi kanonik
└── package.json          # workspaces + script root
```

Aturan struktur yang mengikat (jangan dilanggar):

1. Tidak ada logika domain di `apps/web` selain presentasi + pemanggilan API.
2. Tidak ada akses DB di `services/solver`; ia menerima input via HTTP/artefak.
3. `packages/contracts` adalah satu-satunya sumber tipe bersama TS.
4. Web tidak pernah memanggil solver langsung — NestJS yang menjadi perantara.

## Prasyarat

| Kebutuhan | Versi | Dipakai oleh |
|---|---|---|
| Node.js | >= 26 | web, api, contracts |
| npm | >= 12 | workspaces |
| PostgreSQL | 14+ | `services/api` (Prisma) |
| Python | >= 3.14 | `services/solver` |
| [uv](https://docs.astral.sh/uv/) | terbaru | `services/solver` |
| Mosquitto (broker MQTT) | 2.x | api + firmware |
| PlatformIO Core | 6.x | `firmware/esp32` (opsional) |

## Setup cepat (dev lokal)

### 1. Dependensi JavaScript

```bash
npm install
```

### 2. Database

```bash
createdb sera          # atau lewat psql/docker, terserah
cd services/api
cp .env.example .env   # isi DATABASE_URL dan JWT_SECRET (min. 32 karakter)
cd ../..
npm run prisma:migrate -w @sera/api
npm run seed -w @sera/api
```

> **Jangan tinggalkan variabel opsional dalam keadaan kosong.** `MQTT_USERNAME=`
> dan `MQTT_PASSWORD=` divalidasi sebagai `string().min(1).optional()`, sehingga
> nilai kosong **bukan** "tidak diisi" — API akan gagal boot dengan
> `Config validation error`. Biarkan barisnya dikomentari bila broker dev
> mengizinkan koneksi anonim (seperti di `.env.example`).

Seed membuat P3A demo, user demo, satu jaringan `BRANCHED` dengan 6 blok,
3 sensor untuk device `esp32-01`, forecast cuaca, dan ledger awal.

Kredensial demo: `admin@sera.local` / `sera-demo-admin`,
`operator@sera.local` / `sera-demo-operator`,
`researcher@sera.local` / `sera-demo-researcher`.

### 3. Solver (Python)

```bash
cd services/solver
cp .env.example .env
uv sync
uv run uvicorn sera.app.main:app --reload
```

Cek: `curl -fsS http://localhost:8000/health`.

### 4. Broker MQTT

```bash
mosquitto -v            # dev lokal, boleh anonim, port 1883
```

`services/api/.env` default sudah menunjuk `mqtt://localhost:1883`.

### 5. API

```bash
npm run dev:api
```

Cek: `curl -fsS http://localhost:3000/health`.

### 6. Web

```bash
npm run dev:web
```

Buka <http://localhost:5173>. Vite mem-proxy `/v1` dan `/socket.io` ke
`SERA_API_URL` (default `http://localhost:3000`), jadi tidak perlu konfigurasi CORS
tambahan untuk dev.

### 7. Firmware (opsional)

Lihat [`firmware/esp32/README.md`](./firmware/esp32/README.md). Ringkasnya:

```bash
cd firmware/esp32
pio run -t upload && pio device monitor
```

Boot pertama membuka captive portal `SERA-esp32-01` untuk mengisi Wi-Fi dan
alamat broker — tidak ada kredensial di source.

## Perintah umum

```bash
npm run build          # build semua workspace
npm run test           # unit test semua workspace
npm run typecheck      # typecheck semua workspace
npm run lint           # Biome (check)
npm run lint:fix       # Biome (auto-fix)
npm run format         # Biome (format)
npm run dev:web        # web dev server
npm run dev:api        # api watch mode
npm run e2e:smoke      # uji end-to-end lintas service
```

Per-workspace:

```bash
npm run prisma:migrate -w @sera/api    # prisma migrate dev
npm run prisma:deploy  -w @sera/api    # prisma migrate deploy
npm run seed           -w @sera/api    # seed demo
npm run studio         -w @sera/api    # Prisma Studio
uv run pytest                          # dari services/solver
uv run sera-exp --help                 # CLI eksperimen
```

## Kontrak

### HTTP

| Endpoint | Service | Keterangan |
|---|---|---|
| `GET /health`, `GET /health/ready` | api | tanpa prefix `v1` |
| `GET /health` | solver | health check |
| `/v1/*` | api | seluruh REST API (auth, networks, plans, telemetry, ledger, events, audit, experiments) |
| `/v1/estimate`, `/v1/plan`, `/v1/simulate` | solver | dipanggil **hanya** oleh api, bukan oleh web |

Skema bersama ada di [`packages/contracts`](./packages/contracts/src) dan
[`docs/SERA_v3_05_DATA_MODEL.md`](../docs/SERA_v3_05_DATA_MODEL.md) §6.

### MQTT

```text
sera/<site>/<device>/telemetry      device → broker → backend
sera/<site>/<device>/status         device → broker → backend (LWT online/offline)
sera/<site>/<device>/command        backend → broker → device
sera/<site>/<device>/command/ack    device → broker → backend
```

QoS 1 untuk telemetry & command; `retain` hanya untuk `status`. Payload v1 wajib
punya `schema_version`. Contoh untuk seed demo:
`sera/demo-01/esp32-01/telemetry`. Aturan lengkap + contoh payload di
[`docs/SERA_v3_05_DATA_MODEL.md`](../docs/SERA_v3_05_DATA_MODEL.md) §5.

## Verifikasi

```bash
bash scripts/e2e-smoke.sh
```

Script ini menutup loop penuh: login → publish telemetry via `mosquitto_pub` →
propose plan → approve → execute → cek command log → publish ack → settle ledger
→ cek feeds. Butuh api, solver, dan mosquitto jalan; `mosquitto_pub` dan `jq`
harus terpasang (langkah yang tidak bisa dijalankan akan di-`SKIP`, bukan `FAIL`).

Override target lewat env: `SERA_API_BASE`, `SERA_SOLVER_BASE`, `SERA_MQTT_HOST`,
`SERA_MQTT_PORT`, `SERA_MQTT_SITE`, `SERA_MQTT_DEVICE`.

