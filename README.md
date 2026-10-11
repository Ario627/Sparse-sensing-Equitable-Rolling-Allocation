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

Dari root repo bisa juga langsung: `npm run dev:solver`.

> **Jalankan dari `services/solver`, jangan dari root.** Root tidak punya
> `pyproject.toml`, sehingga `uv run` di sana membuat environment sementara tanpa
> paket `sera` dan `uvicorn sera.app.main:app` gagal dengan
> `ModuleNotFoundError: No module named 'sera'` (memakai Python 3.11, sedangkan
> solver butuh >= 3.14). Opsi `--with uvicorn` juga tidak perlu — uvicorn sudah
> dependency proyek.

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
npm run dev:solver     # solver (uvicorn, reload) — dijalankan dari services/solver
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

## Benchmark & perbandingan metode

Untuk membandingkan SERA dengan metode lain (`proportional`, `rotation`,
`greedy`) dan batas atas `oracle`, solver punya runner benchmark paralel yang
menghasilkan chart:

```bash
cd services/solver
uv run sera-exp benchmark --config ../../experiments/configs/E_benchmark_main.yaml --workers 4
```

Bila shard sudah selesai dan hanya perlu digabung ulang (mis. setelah proses
induk berhenti), pakai:

```bash
uv run sera-exp merge --config ../../experiments/configs/E_benchmark_main.yaml --workers 4
uv run sera-exp verify --experiment E_benchmark_main
```

Keluaran: `experiments/results/<experiment_id>/charts/` berisi `kpi_comparison.png`,
`sweep_*.png`, `estimation_learning.png`, `service_trajectories.png`, dan
`final_scorecard.png` (peringkat kualitas + profil radar + biaya komputasi).

Test yang menyertainya:

```bash
uv run pytest            # dari services/solver — termasuk test sharding & chart
npm test -w @sera/api    # dari root — termasuk pemrosesan telemetry backend
```

Test backend menulis artefaknya sendiri ke
`experiments/results/backend_pipeline/` (`report.json` + `pipeline.svg`).

Catatan metodologi, biaya komputasi, dan keterbatasan grid ada di
[`experiments/README.md`](./experiments/README.md). Hasil audit dan perbandingan
sebelum/sesudah optimasi dispersion ada di
[`experiments/results/AB_ANALYSIS.md`](./experiments/results/AB_ANALYSIS.md).

Dua grid utama disediakan:

| Config | `stage_time_limit_s` | Kegunaan |
|---|---|---|
| [`E_benchmark_main.yaml`](./experiments/configs/E_benchmark_main.yaml) | 0.5 | Artefak v1; menunjukkan efek batas waktu yang terlalu ketat |
| [`E_benchmark_v2.yaml`](./experiments/configs/E_benchmark_v2.yaml) | 2.0 | Angka yang dianjurkan untuk pelaporan |

**Kenapa oracle selalu di atas SERA.** Oracle adalah *full-information upper
bound* (`docs/SERA_v3_08_EKSPERIMEN_KPI.md` §2): ia diberi seluruh state dan
parameter yang SERA harus estimasi, jadi ia memang harus jadi yang terbaik.
Selisihnya sendiri kecil (adekuasi 0.6013 vs 0.6333; regret 76.6 vs 0).

**Kenapa SERA jauh lebih mahal.** Terukur pada instance identik: SERA 2.87 s vs
oracle 0.18 s untuk 6 stage. Penyebabnya ensembel 5 skenario + CVaR (variabel
443 → 2.211) dan 6 stage lexicographic; loop stage ditulis tangan karena backend
HiGHS menolak multi-objective bawaan MathOpt (`Highs does not support multiple
objectives`).

**Inefisiensi yang ditemukan.** Pembangunan model memakan ≈258 ms per resolve
(18 blok × 5 skenario) dan **tidak dihitung** di `solve_time_ms`; sekitar 47%-nya
dari `_add_dispersion_constraints` yang O(n²) (linearisasi Gini). Pada satu run
pembanding, 38 s dari 150 s wall-clock tidak terlihat di metrik mana pun.
Rincian + rekomendasi di [`experiments/README.md`](./experiments/README.md).

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


## Dokumentasi

Dokumentasi kanonik ada di folder **`docs/`**, yang di workspace ini berada
**satu tingkat di atas** root repo (`../docs/`) dan tidak ikut ter-commit ke repo
`SERA`. Kalau repo ini di-clone sendirian, folder tersebut perlu disalin manual.

| File | Isi |
|---|---|
| [`00_INDEX`](../docs/SERA_v3_00_INDEX.md) | Peta dokumen & urutan baca |
| [`01_KONTEKS`](../docs/SERA_v3_01_KONTEKS.md) | Problem, scope, non-goals, glossary |
| [`02_ARSITEKTUR`](../docs/SERA_v3_02_ARSITEKTUR.md) | Service, data flow, ADR, batas kepercayaan |
| [`03_TECH_STACK`](../docs/SERA_v3_03_TECH_STACK.md) | Stack per layer + versi terkunci |
| [`04_ALGORITMA`](../docs/SERA_v3_04_ALGORITMA.md) | Estimator, ledger, optimizer, sensor selection |
| [`05_DATA_MODEL`](../docs/SERA_v3_05_DATA_MODEL.md) | Skema Prisma, kontrak MQTT, kontrak API |
| [`06_HARDWARE_IOT`](../docs/SERA_v3_06_HARDWARE_IOT.md) | ESP32, sensor, kalibrasi, HIL |
| [`08_EKSPERIMEN_KPI`](../docs/SERA_v3_08_EKSPERIMEN_KPI.md) | E1–E8, baseline, KPI, desain statistik |
| [`09_SECURITY`](../docs/SERA_v3_09_SECURITY.md) | Threat model, kontrol, MQTT security |
| [`12_OPERASI_RUNBOOK`](../docs/SERA_v3_12_OPERASI_RUNBOOK.md) | Deploy, migrasi, rollback, observability |

Dokumen internal repo:

| File | Isi |
|---|---|
| [`experiments/README.md`](./experiments/README.md) | Grid eksperimen, benchmark, chart, catatan metodologi |
| [`services/solver/README.md`](./services/solver/README.md) | Detail scientific engine |
| [`firmware/esp32/README.md`](./firmware/esp32/README.md) | Firmware node ESP32 (mode mock) |

## Batasan yang diketahui

- **`docker/compose.yml` belum ada** meski disebut di
  [`docs/SERA_v3_02_ARSITEKTUR.md`](../docs/SERA_v3_02_ARSITEKTUR.md) dan
  [`docs/SERA_v3_12_OPERASI_RUNBOOK.md`](../docs/SERA_v3_12_OPERASI_RUNBOOK.md).
  Jalur yang berfungsi saat ini adalah menjalankan tiap service secara manual
  seperti di §Setup cepat.
- **Firmware masih mode mock** — belum ada sensor fisik; nilai sensor
  dibangkitkan. Yang diuji adalah jalur komunikasi & kontrak, bukan hidrologi.
- **Arduino-ESP32 2.0.17**, bukan 3.3.12 seperti
  [`docs/SERA_v3_03_TECH_STACK.md`](../docs/SERA_v3_03_TECH_STACK.md) §7 —
  platform resmi PlatformIO belum menyediakan core 3.x.
- **Solver tidak reproducible saat time limit mengikat.** Bila sebuah stage
  lexicographic kehabisan waktu, solusi yang dikembalikan bergantung pada kondisi
  wall-clock, sehingga keputusan dapat berbeda antar-run dengan seed dan kode
  yang sama. Terbukti eksperimen kontrol (`E_det_rep_a` vs `E_det_rep_b`); oracle
  identik, tetapi `sera` berbeda. `solve_time_ms` juga bukan besaran reproducible.
- **Angka benchmark bukan klaim optimalitas.** `stage_time_limit_s` diturunkan
  demi kelayakan waktu, dan grid utama bersifat eksploratif (memetakan *di mana*
  SERA unggul, bukan satu angka tunggal). Rincian di
  [`experiments/README.md`](./experiments/README.md).
- **Artefak eksperimen tidak di-commit.** `experiments/results/*` diabaikan
  `.gitignore` (timeseries Parquet, chart PNG, checkpoint shard), kecuali dua
  laporan ringkas `AB_ANALYSIS.md` dan `AB_REPORT.md`. Semua artefak dapat
  diregenerasi — lihat [`experiments/README.md`](./experiments/README.md).
- Versi toolchain yang terkunci bisa berbeda dari environment terpasang —
  sumber kebenaran tetap [`docs/SERA_v3_03_TECH_STACK.md`](../docs/SERA_v3_03_TECH_STACK.md).
