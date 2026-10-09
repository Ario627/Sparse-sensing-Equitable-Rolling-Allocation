# SERA Solver

Scientific engine untuk **SERA (Sparse-sensing Equitable Rolling Allocation)**: estimasi kondisi jaringan irigasi tersier yang jarang disensor, kebutuhan air padi, memori pelayanan blok, dan optimasi alokasi rolling yang adil serta aman bagi tanaman.

Status: fondasi repositori. Setiap angka performa adalah **[HIPOTESIS]** sampai eksperimen berjalan dan artefaknya tersedia di `experiments/results/`.

Service ini satu-satunya tempat logika scientific SERA hidup. Web tidak pernah memanggil solver langsung; NestJS yang menjadi perantara (ADR-002).

## Batas service

| Dikerjakan di sini | Tidak dikerjakan di sini |
| --- | --- |
| Simulator, estimator, demand, ledger, optimizer, sensing, eksperimen | Auth, CRUD, approval, audit (NestJS) |
| Skenario, seed, artefak eksperimen (Parquet + `meta.json`) | Database (solver tidak mengakses DB) |
| Penjelasan keputusan (binding factors) | Keputusan final operator (human-in-the-loop) |
| Perhitungan keputusan | LLM sebagai pengambil keputusan (ADR-007) |

## Peta modul

Seluruh paket Python berada di bawah satu namespace `sera/`; `sera/app/` hanya entrypoint (settings, CLI, FastAPI app).

| Paket | Tanggung jawab | Rujukan |
| --- | --- | --- |
| `sera/app/` | Entrypoint FastAPI, settings, CLI | `04` §5–§7 |
| `sera/core/` | Tipe & satuan inti, RNG deterministik, canonical JSON + hashing | `04` §2, `05` §7 |
| `sera/demand/` | KP-01 dan neraca air padi | `04` §6 |
| `sera/ledger/` | Service ratio, debt, dua jenis deficit | `04` §7 |
| `sera/api/` | Endpoint HTTP + skema Pydantic (mirror kontrak) | `05` §6 |
| `sera/simulator/` | Ground truth: hydraulics, crop, weather, gate, sensors, scenario, recorder | `04` §12 |
| `sera/estimator/` | State estimation, loss estimation, confidence + NIS | `04` §3–§4 |
| `sera/sensing/` | Identifiability gate, VOI, regret, sensor selection | `04` §5, §10 |
| `sera/optimizer/` | Model MILP, lexicographic, stochastic/CVaR, rolling, fallback, event-trigger, binding factors | `04` §8–§9, §13–§14 |
| `sera/baselines/` | Proportional, fixed rotation, ledger-greedy, oracle | `08` §2 |
| `sera/experiments/` | Runner, metrics, statistik, reporting | `08` §5–§7 |

## Quickstart

```bash
cd services/solver
cp .env.example .env
uv sync
uv run uvicorn sera.app.main:app --reload
```

Verifikasi: `curl -fsS http://localhost:8000/health` harus mengembalikan `status`, `version`, dan `schema_version`.

## Perintah

```bash
uv run pytest                                        # unit + property
uv run pytest -m "not slow and not experiment"       # cepat, untuk pra-commit
uv run ruff check . && uv run ruff format --check .  # lint + format
uv run pyright                                       # type check strict
uv run sera-exp run --config ../../experiments/configs/E1_sensor_budget.yaml --out ../../experiments/results
uv run sera-exp verify --experiment <id>
```

## HTTP API (internal)

Semua endpoint memakai prefix `/v1/`, membawa `request_id`, dan mengembalikan `schema_version`.

| Endpoint | Fungsi |
| --- | --- |
| `POST /v1/simulate` | Jalankan simulator untuk satu skenario + seed |
| `POST /v1/estimate` | State + loss estimation dari observasi |
| `POST /v1/plan` | Rolling solve dengan profil kebijakan |
| `POST /v1/sensing/select` | Pemilihan lokasi sensor |
| `POST /v1/experiments` | Mulai job eksperimen |
| `GET /v1/experiments/{id}` | Status dan progres job |
| `GET /v1/experiments/{id}/metrics` | Agregat metrik |
| `GET /health` | Health check |

## Satuan, waktu, dan hashing

Aturan yang tidak boleh dilanggar (bug historis v2, `04` §2.4):

- `1 L/s x 1 jam = 3,6 m3`; volume net terminal `V_del = 3,6 q dt y pi`; gross `V_gross = V_del / pi`; storage `dS[mm] = (V_del / A) x 1000`.
- `pi_i` adalah produk `eta_e` sepanjang path; `eta` selalu di `(0, 1]`.
- Waktu selalu UTC di semua artefak; konversi zona hanya di UI.
- `config_hash` dihitung dari canonical JSON (key terurut, tanpa spasi) agar stabil lintas platform.

## Reproducibility

1. Semua seed eksplisit; tidak ada random global. Perbandingan metode memakai paired run dengan common random numbers (`08` §6.1).
2. Setiap hasil eksperimen menulis `meta.json` (git commit, versi dependency, OS, `config_hash`, tanggal), `runs.parquet`, dan `summary.json` (`08` §7.1).
3. Model sama + seed sama + config sama menghasilkan hash yang sama; diverifikasi oleh `tests/test_reproducibility.py`.
4. Artefak mentah bersifat immutable; koreksi ditulis sebagai run baru.
5. Simulator selalu lebih kompleks daripada estimator (anti inverse crime, `04` §12.1).

## Eksperimen

| ID | Pertanyaan | Prioritas |
| --- | --- | --- |
| E1 | Berapa sensor minimum yang cukup? | Flagship 1 |
| E2 | Apakah sensor decision-optimal berbeda dari estimation-optimal? | Flagship 2 |
| E3 | Apakah service ledger menambah nilai? | Wajib |
| E4 | Seberapa tahan terhadap mismatch dan gangguan? | Wajib |
| E5 | Bagaimana trade-off equity vs shortage berubah antar profil? | Sebaiknya |
| E6 | Apakah active probing aman dan bermanfaat? | Flagship 3, opsional |
| E7 | Apakah event-trigger menghemat solve tanpa merusak keputusan? | Sebaiknya |
| E8 | Apakah jalur telemetry sampai aktuasi hidup? | Wajib |

## Kualitas

- `ruff` (lint + format) dan `pyright` strict sebagai gerbang CI.
- `pytest` + `hypothesis` untuk invarian numerik dan kontrak; tulisya di `tests/`.
- Coverage bukan sasaran angka; fokus pada jalur gagal yang mahal (`11` §1):
  konservasi massa, nonanticipativity, ledger bounded, fallback berjenjang, kalibrasi interval.

## Konvensi

1. Identifier kode berbahasa Inggris; dokumentasi dan komunikasi berbahasa Indonesia.
2. Satuan di nama variabel bila ambigu (`flow_lps`, `volume_m3`, `level_mm`).
3. Semua fungsi publik bertipe; domain memakai dataclass/Pydantic, bukan dict bebas.
4. Tanpa komentar inline; makna dan provenance tinggal di nama, konstanta bernama, dan tabel parameter (`04` §15).
5. Operasi array memakai NumPy, bukan loop Python, untuk data besar.

## Urutan baca untuk kontributor baru

`sera/app/settings.py` → `sera/core/` → `sera/demand/` → `sera/ledger/` → `sera/simulator/` → `sera/estimator/` → `sera/optimizer/` → `sera/api/`.


