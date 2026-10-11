# Experiments

Konfigurasi dan artefak eksperimen SERA. Kode runner ada di
[`services/solver/sera/experiments/`](../services/solver/sera/experiments);
folder ini hanya menyimpan grid dan hasilnya.

## Peta folder

```text
experiments/
├── configs/                     # grid eksperimen (YAML)
│   ├── E1_sensor_budget.yaml
│   └── E_benchmark_main.yaml    # benchmark utama untuk chart perbandingan
└── results/
    ├── <experiment_id>/         # satu direktori per eksperimen
    │   ├── meta.json            # config + hash + provenance
    │   ├── checkpoint.jsonl     # catatan per run (dipakai untuk resume)
    │   ├── runs.parquet         # satu baris per run, 34 kolom metrik
    │   ├── summary.json         # agregat + CI + uji berpasangan
    │   ├── timeseries/          # trajektori per slot (Parquet, dipartisi)
    │   └── charts/              # PNG + charts.json
    └── backend_pipeline/        # artefak test backend (report.json + pipeline.svg)
```

## Menjalankan

```bash
cd services/solver

# sekuensial (satu proses)
uv run sera-exp run --config ../../experiments/configs/E_benchmark_main.yaml

# paralel: pecah grid jadi shard, jalankan beberapa proses, lalu gabungkan
uv run sera-exp benchmark --config ../../experiments/configs/E_benchmark_main.yaml --workers 4

# gabungkan ulang shard yang sudah ada + hasilkan chart (tanpa menjalankan ulang)
uv run sera-exp merge --config ../../experiments/configs/E_benchmark_main.yaml --workers 4

# periksa konsistensi artefak (hash + jumlah baris)
uv run sera-exp verify --experiment E_benchmark_main
```

`run` menulis hasil ke `results_root` yang ditentukan config; path relatif
diselesaikan terhadap **direktori kerja**, jadi jalankan dari root repo bila
config memakai `experiments/results`.

### Cara kerja `benchmark`

1. Grid dipecah **per environment** (kombinasi skenario × blok × topologi ×
   k_factor × replikasi × sensor set), bukan per run. Semua metode yang
   membandingkan kondisi yang sama selalu berada di shard yang sama.
2. Tiap shard dijalankan sebagai proses terpisah (`run --shard i/N`) sehingga
   paralel dan terisolasi secara memori.
3. Checkpoint shard digabung, duplikat dibuang, indeks dirapikan, lalu
   `attach_decision_regret` dan `build_summary` dijalankan sekali atas data utuh.
4. Checkpoint gabungan ditulis ulang dengan hash plan penuh sehingga
   `sera-exp verify` tetap konsisten.
5. Chart dihasilkan.

Karena checkpoint ditulis bertahap, `merge` bisa dijalankan **sementara shard
masih berjalan** untuk melihat hasil parsial. Jalankan lagi setelah selesai untuk
hasil final.

## Chart yang dihasilkan

| File | Isi |
|---|---|
| `kpi_comparison.png` | Bar per KPI: mean + CI 95%, oracle sebagai garis referensi |
| `sweep_<faktor>.png` | KPI terhadap tiap faktor yang bervariasi (k_factor, jumlah blok, jumlah sensor, topologi, skenario) |
| `estimation_learning.png` | `eta_est` mengejar `eta_true` dari waktu ke waktu + trajektori storage — analog kurva training |
| `service_trajectories.png` | Service ratio, debt ledger, dan aktivitas gate per waktu |
| `final_scorecard.png` | **Chart final**: peringkat kualitas (bar), profil KPI (radar), dan biaya komputasi |
| `charts.json` | Indeks + angka di balik chart final |

### Aturan yang dipatuhi

- Setiap KPI digambar **dengan interval**, tidak pernah titik tunggal
  (`docs/SERA_v3_08_EKSPERIMEN_KPI.md` §5.4).
- `n` (jumlah run) dicetak di chart.
- **Oracle di luar peringkat.** `decision_regret` tidak berlaku bagi oracle
  (ia referensinya sendiri), sehingga jumlah KPI-nya selalu lebih sedikit dan
  skornya tidak apple-to-apple. Oracle digambar sebagai batas atas.
- **Biaya komputasi dipisah dari kualitas.** Baseline heuristik selalu 0 ms;
  bila solve time ikut dirata-ratakan dalam skor komposit, metode sepele akan
  tampak unggul. Biaya dilaporkan di panel terpisah dan tidak masuk peringkat.

## Catatan desain & keterbatasan

Temuan dari probe biaya sebelum benchmark dijalankan:

1. **CHAIN adalah kasus degenerat.** Untuk topologi berantai, semua kebijakan
   yang sadar kapasitas menghasilkan alokasi yang sama — metrik SERA, proportional,
   dan oracle bisa identik sampai tiga desimal. Diskriminasi muncul di
   **BRANCHED** dengan kelangkaan (`k_factor < 1`). Grid utama karena itu memuat
   keduanya, termasuk `k_factor: 1.0` sebagai kontrol "tanpa kelangkaan".
2. **`stage_time_limit_s` diturunkan ke 0.5 s** (default 6 s) demi kelayakan
   waktu. Ini menaikkan MIP gap, sehingga angka absolut **bukan** klaim
   optimalitas. Yang dibandingkan adalah perbedaan antar metode pada anggaran
   waktu yang sama.
3. **Biaya terkonsentrasi di SERA.** Satu run SERA ≈ 9–53 s tergantung ukuran
   grid, sementara baseline heuristik ≈ 0 s dan oracle ≈ 3–10 s.
4. **`n_scenarios` dibatasi `α`.** CVaR menuntut `n_scenarios × (1 − α) ≥ 1`;
   grid memakai `α = 0.8` dengan 5 skenario.
5. **Uji berpasangan butuh ≥ 5 environment** yang sama antar metode
   (`MIN_PAIRS`). Pemasangan memakai kunci `(seed, sensor_set)`.
6. **Grid utama bersifat eksploratif.** Rentangnya lebar (2 topologi × 2 jumlah
   blok × 3 tingkat kelangkaan × 2 skenario × 3 set sensor × 2 replikasi), jadi
   ia memetakan *di mana* SERA unggul, bukan mengklaim satu angka tunggal.
   Untuk klaim yang lebih kuat, persempit kondisi dan tambah replikasi.
7. **Celah perekaman yang ditemukan saat membuat chart** (belum diperbaiki,
   dicatat agar tidak dikira datanya hilang):
   - `eta_lo` / `eta_hi` **null untuk semua metode**. Interval keyakinan `eta`
     tidak ikut terekam, sehingga KPI *empirical coverage*
     (`docs/SERA_v3_08_EKSPERIMEN_KPI.md` §5.2) belum bisa dihitung dari artefak.
   - `service_ratio`, `debt_m3`, dan `eta_est` **null untuk `proportional` dan
     `rotation`**. Keduanya loop terbuka tanpa estimator/ledger, jadi besaran itu
     memang tidak dihasilkan. Panel `service_trajectories.png` menandainya
     eksplisit sebagai "tidak terekam".
   - `gate_open` tersimpan sebagai boolean, sehingga panel aktivitas gate perlu
     memetakannya ke 0/1 sebelum diagregasi.
8. **`n_blocks` bukan jumlah blok sebenarnya.** Penamaan blok selalu `b1..bN`
   mengikuti jumlah blok internal jaringan, dan topologi bercabang punya blok
   lebih banyak daripada yang diminta:

   | topologi | `n_blocks` | blok aktual |
   |---|---|---|
   | CHAIN | 6 | `b1..b6` |
   | CHAIN | 10 | `b1..b10` |
   | BRANCHED | 6 | `b1..b10` |
   | BRANCHED | 10 | `b1..b18` |

   Akibatnya `sensor_sets` **wajib hanya menyebut blok yang ada di semua
   kombinasi** pada grid. Menyebut `b8` aman untuk BRANCHED dan untuk
   `n_blocks: 10`, tetapi **gagal di CHAIN dengan `n_blocks: 6`**.
9. **Kegagalan run tercatat, tidak disembunyikan.** `summary.json` memuat
   `failures_total`, `checkpoint.jsonl` memuat entri `failed` lengkap dengan
   spesifikasi, tipe galat, dan pesannya. Skor di chart hanya dihitung dari run
   yang berhasil.
   - Saat grid masih memakai `sensor_sets: [b2,b5,b8]`, 48 dari 720 run gagal —
     semuanya di CHAIN `n_blocks: 6`, dan hanya pada empat metode non-oracle
     (oracle melewati validasi sensor karena memakai seluruh blok).
   - Config yang dikirim di repo sudah diperbaiki ke `[b2, b5, b6]` yang valid di
     keempat kombinasi. Artefak `E_benchmark_main` berasal dari grid sebelum
     perbaikan; `meta.json` di dalamnya menyimpan konfigurasi as-run, sehingga
     menjalankan `merge` kembali dengan config yang sudah diperbaiki akan
     menghasilkan hash plan yang berbeda.
10. **`merge` menyaring catatan di luar plan.** Bila config diubah setelah shard
   selesai, environment yang tidak lagi ada di grid akan diabaikan dan jumlahnya
   dilaporkan sebagai `di luar plan`. Ini mencegah `runs.parquet` memuat data
   yang tidak diakui `meta.json`.

## Analisis akar masalah: kenapa SERA lebih lambat & di bawah oracle

Investigasi ini menjawab tiga pertanyaan: (a) kenapa SERA di bawah oracle,
(b) kenapa SERA lebih mahal secara komputasi, (c) apakah ada bug.

### (a) Di bawah oracle itu **sesuai desain**, bukan kegagalan

`docs/SERA_v3_08_EKSPERIMEN_KPI.md` §2 menetapkan oracle sebagai
**full-information upper bound**: ia diberi seluruh state dan parameter yang
SERA harus estimasi. Karena itu:

- Oracle **wajib** jadi yang terbaik — kalau tidak, benchmark-nya salah.
- Skor komposit oracle selalu mendekati 1.0 karena normalisasi min-max
  memberi nilai 1.0 kepada metode terbaik di tiap KPI. Oracle yang mencapai
  1.000 adalah **hasil yang diharapkan**.
- Selisih nyata SERA–oracle pada grid penuh kecil:

  | KPI | SERA | oracle |
  |---|---|---|
  | adequacy | 0.6013 | 0.6333 |
  | worst service ratio | 0.6197 | 0.6557 |
  | decision regret | 76.6 | 0 (referensi) |
  | state RMSE | 14.39 mm | 3.46 mm |

  Catatan: oracle unggul besar di `state_rmse` karena ia memang tidak perlu
  mengestimasi. Metrik itu tidak dipakai di scorecard justru karena alasan ini.

- Oracle melewati jalur estimasi: `mean_confidence` 0.99 vs SERA 0.20, dan
  `n_fallbacks` 0.014 vs SERA 8.64 di v1.

### (b) Kenapa SERA jauh lebih mahal: diperiksa langsung, bukan diduga

Diukur pada instance identik (18 blok × 2 slot, 6 stage, batas 2.0 s/stage):

| varian | waktu | status stage |
|---|---|---|
| oracle (1 skenario, tanpa CVaR) | **0.18 s** | 6/6 OPTIMAL |
| SERA (5 skenario) | **2.87 s** | 5 OPTIMAL + 1 FEASIBLE |
| SERA (5 skenario + CVaR α=0.8) | **2.67 s** | 5 OPTIMAL + 1 FEASIBLE |

Sumber perbedaan, dari kode:

1. **Ensembel skenario.** `policies._planning_problem` selalu membangun **satu**
   skenario pusat; `rolling._resolve_ensemble` lalu mengembangkannya menjadi
   `n_scenarios` (5 di grid ini) hanya untuk SERA. Oracle memakai problem
   apa adanya — 1 skenario. Jumlah variabel naik linear: 443 → 2.211 variabel
   (18 blok).
2. **CVaR** menambah variabel/auxiliary (`enable_cvar`) dan dibatasi oleh
   `n_scenarios × (1 − α) ≥ 1`.
3. **6 stage lexicographic** (`SAFETY`, `SHORTAGE_RISK`, `EQUITY`, `DISPERSION`,
   `STABILITY`, `GROSS_WITHDRAWAL`) berarti **6 kali solve MILP per resolve**,
   masing-masing dengan kendala yang mengunci optimum stage sebelumnya.

Ketiganya adalah keputusan desain yang terdokumentasi
(`docs/SERA_v3_04_ALGORITMA.md`), bukan bug — tetapi harganya nyata dan perlu
dilaporkan eksplisit.

### (c) Inefisiensi nyata yang ditemukan

**Yang terbesar: pembangunan model, dan itu tidak dihitung di metrik.**

`total_solve_seconds` hanya menjumlahkan `solve_stats.solve_time` dari solver
(`solver._solve_seconds`). Waktu Python untuk `build_plan_model` **tidak masuk
hitungan** — padahal model dibangun ulang di setiap resolve.

| blok | 1 skenario | 5 skenario | pasangan n(n−1)/2 |
|---|---|---|---|
| 6 | 7.1 ms | 48.5 ms | 15 |
| 10 | 15.0 ms | 98.6 ms | 45 |
| 18 | 44.3 ms | **258.3 ms** | 153 |
| 24 | 71.3 ms | 352.1 ms | 276 |

Untuk BRANCHED dengan `n_blocks: 10` (18 blok aktual), 120 resolve berarti
**≈ 31 detik hanya untuk membangun model** — membandingkan dengan
`solve_time_ms` SERA yang terlapor ≈ 49 s, artinya biaya sebenarnya jauh lebih
tinggi daripada yang terlihat di chart.

Profil `cProfile` pada 5 kali pembangunan model (18 blok, 5 skenario):

| bagian | waktu | porsi |
|---|---|---|
| `_add_dispersion_constraints` | 1.427 s | **47%** |
| `_add_capacity_constraints` | 0.308 s | 10% |
| `_add_storage_constraints` | 0.281 s | 9% |
| `_declare_variables` | 0.254 s | 8% |
| `_add_stability_constraints` | 0.209 s | 7% |

`_add_dispersion_constraints` adalah **loop bersarang O(n²)**: satu kendala per
pasangan blok per skenario, dua arah. Jumlahnya:

| blok | 1 skenario | 5 skenario |
|---|---|---|
| 6 | 30 | 150 |
| 10 | 90 | 450 |
| 18 | 306 | **1.530** |

Pada 18 blok × 5 skenario, **1.530 dari ≈3.188 kendala (48%)** berasal dari
dispersion saja. Biayanya bukan di solver, melainkan di overhead Python:
15.940 pemanggilan `add_linear_constraint` per 5 model, masing-masing melalui
`as_normalized_linear_inequality` (~0.12 ms/overhead).

Penting: O(n²) itu **melekat pada definisi Gini** yang dipakai
(`_dispersion_expression` menjumlahkan selisih berpasangan semua blok =
Gini mean difference). Jadi ini bukan salah tulis, melainkan konsekuensi
memilih ukuran dispersi eksak.

### Rekomendasi, diurutkan menurut dampak

1. **Naikkan `stage_time_limit_s`.** Sudah dilakukan di `E_benchmark_v2.yaml`
   (0.5 → 2.0 s). Terbukti memangkas fallback dari 40 menjadi 2 pada
   environment terburuk dengan tambahan waktu total hanya ~10%.
2. **Laporkan waktu pembangunan model sebagai metrik terpisah.** Saat ini ia
   tidak terlihat sama sekali; tanpa ini, optimasi konstruksi model tidak akan
   pernah terukur.
3. **Kurangi biaya dispersion** tanpa mengubah semantik: bangun kendala
   langsung ke protobuf, atau vektorkan, alih-alih 1.530 panggilan Python
   individual. Pendekatan lain: ganti Gini eksak dengan mean absolute deviation
   yang O(n), dengan catatan bahwa itu **mengubah** ukuran ketidakmerataan dan
   harus dilaporkan sebagai pilihan model.
4. **Pertimbangkan ulang jumlah stage lexicographic** untuk kasus besar; enam
   solve per resolve memberi kontribusi berganda terhadap biaya.
5. **`_attempt_solve` mengulang tanpa presolve** bila hasil `INFEASIBLE` atau
   exception. Ini menggandakan waktu terburuk untuk instance yang benar-benar
   infeasible. Perlu diukur seberapa sering terjadi sebelum diubah.

### Yang **bukan** bug

- Oracle unggul dari SERA — sesuai desain, oracle adalah batas atas.
- SERA lebih lambat dari oracle — konsekuensi ensembel 5 skenario + CVaR +
  6 stage.
- 48 kegagalan run di `E_benchmark_main` — berasal dari `stage_time_limit_s: 0.5`
  yang terlalu ketat untuk instance besar, bukan dari kesalahan algoritma.
  Dikonfirmasi eksperimen: pada environment & seed identik, menaikkan batas ke
  2.0 s menurunkan fallback 40 → 2 dan menaikkan `worst_sr` 0.107 → 0.168.

## Optimasi dispersion & perbandingan A/B

Hasil lengkap ada di [`results/AB_ANALYSIS.md`](../experiments/results/AB_ANALYSIS.md)
dan laporan yang dihasilkan CLI di
[`results/AB_REPORT.md`](../experiments/results/AB_REPORT.md). Ringkasnya:

- **Formulasi tidak berubah.** Hanya cara membangun kendala dispersion yang
  dioptimalkan (`_fairness_denominator` dan `_delivered_expression` dihitung
  sekali per (blok, skenario), bukan sekali per pasangan). Jumlah, urutan, nama,
  dan koefisien kendala identik — dijaga oleh
  [`tests/test_dispersion_equivalence.py`](../services/solver/tests/test_dispersion_equivalence.py).
- **Kualitas KPI tidak berubah.** CI 95% selisih berpasangan memuat nol untuk
  adequacy, worst_sr, shortage, dan cvar_shortage.
- **Build model −7.6%** (A/B berpasangan, 240 pasangan, selisih −47.7 s dari
  623.9 s); mikrobenchmark 1.02–1.20x menurut ukuran masalah.
- **End-to-end ≈ 1.3%**, bukan 8.5%. Angka `run_wall` mentah A/B terkontaminasi
  karena `solver_wall_seconds` juga bergerak 1.097x padahal kode solver tidak
  disentuh — bukti beban mesin berbeda antar lengan.

### Catatan penting: solver tidak reproducible saat time limit mengikat

`E_det_rep_a` vs `E_det_rep_b` (kode identik, environment & seed sama,
dijalankan dua kali) menunjukkan oracle identik tetapi **sera berbeda**
(adequacy 0.17019 vs 0.17046). Konsekuensinya:

- 6 dari 240 run berbeda keputusan antara lengan A/B; semuanya `sera`, dan
  `n_fallbacks`-nya ikut berbeda dua arah. Itu derau time limit, bukan regresi.
- Klaim ekuivalensi berlaku untuk **struktur model** (terbukti) dan **KPI secara
  statistik**, bukan untuk setiap run individual.
- `solve_time_ms` adalah waktu dinding di dalam solver, jadi **bukan** besaran
  yang reproducible dan tidak boleh dipakai membandingkan implementasi.

### Keterbatasan pengukuran

Kedua lengan dijalankan **berurutan**, bukan berselang-seling, sehingga beban
mesin berbeda antar lengan. Untuk angka end-to-end yang bersih, lengan perlu
dijalankan berselang-seling atau serentak, atau `solver_wall_seconds` dipakai
sebagai kovariat.

## Artefak test backend

`experiments/results/backend_pipeline/` dihasilkan oleh
[`services/api/test/backend-pipeline.test.ts`](../services/api/test/backend-pipeline.test.ts):

| File | Isi |
|---|---|
| `report.json` | Jumlah baris ditulis / reading ditolak per kategori payload |
| `pipeline.svg` | Chart alur pemrosesan telemetry backend |

Jalankan dengan `npm test -w @sera/api`.
