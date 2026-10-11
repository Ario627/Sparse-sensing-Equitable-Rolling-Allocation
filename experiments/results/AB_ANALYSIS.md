# Laporan A/B: optimasi konstruksi kendala dispersion

Status: **selesai**. Ringkasan ini ditulis setelah kedua lengan terverifikasi.
Jangan memperbarui klaim hasil di proposal sebelum angka di sini dianggap final.

> Semua path di dokumen ini relatif terhadap **root repo** (`SERA/`).

| Item | Nilai |
|---|---|
| Lengan sebelum | `E_ab_before` (240 run, 0 gagal) |
| Lengan sesudah | `E_ab_after` (240 run, 0 gagal) |
| Pasangan environment | 240 (48 environment × 5 metode) |
| Seed berbeda | 0 |
| Config | `experiments/configs/E_ab_before.yaml` / `E_ab_after.yaml` (identik kecuali `experiment_id`) |
| `stage_time_limit_s` | 2.0 (tidak diubah antara lengan) |
| Objektif / formulasi | tidak diubah |

## 1. Apa yang diubah

Hanya **cara membangun** kendala dispersi di
`services/solver/sera/optimizer/model.py::_add_dispersion_constraints`.
Formulasi matematisnya tidak disentuh: jumlah kendala (3.188 pada 18 blok × 5
skenario), urutan, nama, dan koefisiennya identik.

`_fairness_denominator` dan `_delivered_expression` hanya bergantung pada
(blok, skenario), tetapi sebelumnya dihitung ulang untuk setiap pasangan blok —
`2 · n(n−1)/2` kali per skenario. Sekarang dihitung sekali per kombinasi, dan
suku luar diangkat keluar dari loop dalam.

Ekuivalensi dijaga oleh `tests/test_dispersion_equivalence.py` (15 test):
himpunan kendala, **urutan**, nama, jumlah variabel, optimum relaksasi LP, dan
solusi lexicographic penuh. Test ini divalidasi dengan uji negatif: menukar
urutan suku memicu 9 kegagalan, dan mengubah koefisien sebesar 1e-6 memicu 5
kegagalan.

## 2. Kualitas KPI: tidak ada perubahan yang terdeteksi

Perbandingan berpasangan 48 run SERA, CI 95% bootstrap (10.000 resample):

| KPI | sebelum | sesudah | selisih | CI 95% selisih |
|---|---|---|---|---|
| adequacy | 0.44300 | 0.44297 | −0.00003 | [−0.00010, +0.00003] |
| worst_sr | 0.46677 | 0.46674 | −0.00003 | [−0.00013, +0.00006] |
| shortage_total_m3 | 11804.24 | 11805.16 | +0.92 | [−0.62, +2.85] |
| cvar_shortage_m3 | 131.407 | 131.449 | +0.041 | [−0.006, +0.109] |

**Semua CI memuat nol.** Tidak ada perubahan kualitas yang dapat dideteksi —
hasil yang diharapkan untuk perubahan yang terbukti setara secara struktur.

### 6 dari 240 run tetap berbeda — dan itu bukan efek optimasi

Seluruh 6 perbedaan hanya pada `sera`, dan pada setiap kasus `n_fallbacks` ikut
berbeda (0→1, 0→1, 6→4, 3→0, 1→0, 0→1 — dua arah, jadi bukan regresi).

**Kontrol non-determinisme** (`E_det_rep_a` vs `E_det_rep_b`: kode identik,
environment dan seed sama, dijalankan dua kali):

| metode | adequacy A | adequacy B | identik? |
|---|---|---|---|
| oracle | 0.17145 | 0.17145 | ya |
| sera | 0.17019 | 0.17046 | **tidak** |

Jadi ketika `stage_time_limit_s` mengikat, keputusan solver bergantung pada
kondisi wall-clock dan **tidak reproducible**. Ini menjelaskan keenam perbedaan
tanpa perlu menyalahkan perubahan kode.

## 3. Feasibility & fallback

| Lengan | run | gagal | total fallback | run SERA dengan fallback |
|---|---|---|---|---|
| sebelum | 240 | 0 | 14 | 7 / 48 |
| sesudah | 240 | 0 | 10 | 6 / 48 |

Tidak ada kegagalan di kedua lengan. Penurunan fallback 14 → 10 berada di dalam
derau non-determinisme di atas, jadi **jangan** diklaim sebagai perbaikan.

## 4. Waktu

### Build model (efek langsung optimasi)

| metode pengukuran | speedup |
|---|---|
| A/B berpasangan, 240 pasangan (SERA) | **1.0827x** — selisih −47.7 s dari 623.9 s |
| Berpasangan, CI 95% | [−11.8%, −3.7%] pada rata-rata per-run |
| Mikrobenchmark dalam satu proses, median 7× | 1.02x – 1.20x menurut ukuran (lihat tabel) |

Mikrobenchmark per ukuran masalah (median 7 pembangunan model, mesin idle).
**Catatan provenance:** tabel ini dari pengukuran ad-hoc di luar repo (dua
implementasi dijalankan bergantian dalam satu proses), bukan dari perintah CLI
yang tersedia. Angka utamanya tetap berasal dari A/B berpasangan di atas.

| blok | skenario | naif | produksi | speedup |
|---|---|---|---|---|
| 6 | 1 | 5.3 ms | 5.2 ms | 1.02x |
| 6 | 5 | 28.3 ms | 23.9 ms | 1.18x |
| 10 | 5 | 51.9 ms | 50.0 ms | 1.04x |
| 18 | 1 | 26.8 ms | 22.3 ms | 1.20x |
| 18 | 5 | 121.6 ms | 113.0 ms | 1.08x |
| 24 | 5 | 199.0 ms | 181.8 ms | 1.09x |

Speedup A/B per ukuran environment (SERA, rata-rata):

| environment | sebelum | sesudah | speedup |
|---|---|---|---|
| BRANCHED-18 | 26.93 s | 24.82 s | 1.085x |
| CHAIN-10 | 10.09 s | 8.56 s | 1.178x |
| CHAIN-6 | 4.56 s | 4.33 s | 1.054x |
| BRANCHED-10 | 10.42 s | 10.32 s | 1.010x |

### Wall-clock end-to-end: ada confounder, jangan pakai angka mentah A/B

A/B melaporkan `run_wall_seconds` 4395.0 s → 4021.7 s (**1.093x**). Angka ini
**tidak boleh** diklaim sebagai hasil optimasi, karena:

| komponen | speedup A/B | dijelaskan oleh optimasi? |
|---|---|---|
| `model_build_seconds` | 1.0827x | **ya** — efek yang dituju |
| `solver_wall_seconds` | **1.0972x** | **tidak** — kode solver tidak disentuh |

Solver tidak berubah sama sekali, jadi perbaikan 9.7% di sana murni perbedaan
kondisi mesin antar lengan (lengan "sebelum" berjalan saat beban mesin lebih
tinggi). Karena itu:

> **Perolehan end-to-end yang dapat dipertahankan ≈ 1.3%**, dihitung dari pangsa
> build (17.0% dari `run_wall`) dikali speedup build (1.0827x), dengan asumsi
> solver tidak berubah. Bukan 8.5%.

## 5. Keterbatasan

1. **Kedua lengan dijalankan berurutan, bukan berselang-seling.** Beban mesin
   berbeda antar lengan (terbukti dari `solver_wall_seconds`). Untuk angka
   end-to-end yang bersih, lengan harus dijalankan berselang-seling atau
   serentak, atau `solver_wall_seconds` dipakai sebagai kovariat.
2. **Non-determinisme solver saat time limit mengikat** membuat metrik keputusan
   tidak reproducible untuk run besar. Klaim ekuivalensi karena itu berlaku
   untuk struktur model (terbukti) dan untuk KPI secara statistik (CI memuat
   nol), bukan untuk setiap run individual.
3. **`solve_time_ms` bukan besaran reproducible.** Ia waktu dinding di dalam
   solver; jangan dipakai untuk membandingkan implementasi secara langsung.
4. **Pangsa build 17%** diukur pada grid ini (`stage_time_limit_s: 2.0`,
   `n_scenarios: 5`, horizon 2). Pada konfigurasi lain pangsanya berbeda,
   sehingga perolehan end-to-end juga berbeda.
5. **Perolehan kecil.** Yang dominan justru tetap: model 5 skenario, 6 stage
   lexicographic, dan jumlah kendala dispersion yang O(n²) — ketiga hal terakhir
   tidak dapat diperbaiki tanpa mengubah formulasi.

## 6. Yang tidak diubah

Sesuai batasan tugas, dalam satu langkah ini **tidak** diubah:

- objektif dan urutan stage lexicographic,
- `stage_time_limit_s` (tetap 2.0 s di kedua lengan),
- `n_scenarios` (tetap 5) dan `cvar_alpha` (tetap 0.8),
- formulasi kendala (hanya konstruksinya).

Usulan berikutnya untuk dampak lebih besar — **belum** dikerjakan dan belum
diukur: mengurangi jumlah skenario, mengurangi jumlah stage, atau memakai ulang
model antar resolve (membangun sekali, memperbarui RHS per slot).

## Reproduksi

```bash
cd services/solver
uv run sera-exp benchmark --config ../../experiments/configs/E_ab_before.yaml --workers 4
uv run sera-exp benchmark --config ../../experiments/configs/E_ab_after.yaml  --workers 4
uv run sera-exp compare-ab --before E_ab_before --after E_ab_after \
    --report ../../experiments/results/AB_REPORT.md
uv run sera-exp verify --experiment E_ab_before
uv run sera-exp verify --experiment E_ab_after
uv run pytest tests/test_dispersion_equivalence.py tests/test_ab_compare.py
```
