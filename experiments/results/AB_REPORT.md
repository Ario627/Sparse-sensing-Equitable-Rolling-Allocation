# Perbandingan A/B: E_ab_before vs E_ab_after

- Pasangan environment: 240
- Run sebelum/sesudah: 240 / 240
- Seed berbeda: 0

## Ekuivalensi metrik keputusan

| Kolom | Jumlah berbeda | Selisih absolut maksimum |
|---|---|---|
| adequacy | 6 | 0.00483146 |
| efficiency | 6 | 0.00108577 |
| dependability | 2 | 0.00166667 |
| equity | 6 | 0.00556866 |
| worst_sr | 6 | 0.00720361 |
| shortage_total_m3 | 6 | 148.03 |
| tail_deficit_m3 | 6 | 93.6563 |
| cvar_shortage_m3 | 5 | 6.00843 |
| state_rmse | 6 | 0.299676 |
| gate_switches | 6 | 22 |
| decision_regret | 6 | 148.03 |
| storage_coverage | 4 | 0.00333333 |
| mean_confidence | 6 | 0.00118376 |
| n_fallbacks | 9 | 3 |
| review_required | 9 | 3 |
| nis_violations | 2 | 1 |

## Waktu (berpasangan)

| Kolom | n | sebelum (rata2) | sesudah (rata2) | selisih | CI 95% | speedup |
|---|---|---|---|---|---|---|
| model_build_seconds | 240 | 3.0776 | 2.8438 | -0.2338 | [-0.3636, -0.1135] | 1.082 |
| solver_wall_seconds | 240 | 14.7368 | 13.4846 | -1.2522 | [-1.9074, -0.6715] | 1.093 |
| run_wall_seconds | 240 | 18.3124 | 16.7570 | -1.5554 | [-2.3553, -0.8563] | 1.093 |
