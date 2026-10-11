# SERA — Firmware node ESP32 (mode mock)

Firmware demonstrator HIL untuk [`docs/SERA_v3_06_HARDWARE_IOT.md`](../../../docs/SERA_v3_06_HARDWARE_IOT.md).
Saat ini **belum ada sensor fisik** — nilai sensor dibangkitkan (mock) dari posisi
gate, tetapi seluruh jalur komunikasi, kontrak payload, ACK, LWT, backoff, dan
watchdog sudah berjalan seperti device sungguhan.

## Peran di sistem

```text
ESP32 ──telemetry──► mosquitto ──► NestJS (services/api)
                                        │  HTTP POST /v1/estimate, /v1/plan
                                        ▼
                                   FastAPI solver (services/solver)
                                        │
ESP32 ◄──command──── mosquitto ◄── NestJS (plans.execution.service.ts)
   └──command/ack──► mosquitto ──► NestJS (commands.ack.service.ts)
```

Backend tidak pernah bicara ke solver lewat MQTT — MQTT hanya jalur device,
backend ke solver memakai HTTP (`SOLVER_URL`, default `http://localhost:8000`).

## Provisioning (WiFiManager)

Tidak ada kredensial di source. Semua diisi lewat captive portal dan disimpan di
NVS perangkat.

**Boot pertama:**

1. Nyalakan ESP32. Perangkat membuka AP bernama **`SERA-esp32-01`**
   (password default: `sera-setup`, ubah di [`include/defaults.h`](./include/defaults.h)).
2. Sambungkan HP/laptop ke AP itu. Halaman portal biasanya terbuka otomatis;
   kalau tidak, buka `http://192.168.4.1`.
3. Pilih Wi-Fi, isi **MQTT host** dengan **IP LAN** komputer yang menjalankan
   broker (mis. `192.168.1.10`) — `localhost` tidak bisa dipakai dari ESP32.
4. Simpan. Perangkat restart koneksi dan mulai mengirim telemetry.

**Boot berikutnya:** langsung tersambung, portal tidak muncul.

**Ganti Wi-Fi / broker:** tahan tombol **BOOT (GPIO0)** ±5 detik saat menyalakan
perangkat. Semua kredensial Wi-Fi + konfigurasi MQTT dihapus dan portal terbuka lagi.

Kalau perangkat belum pernah berhasil tersambung, portal dibuka ulang otomatis
tiap 30 detik sampai dikonfigurasi.

Nilai yang harus cocok dengan backend/database (ada di [`include/defaults.h`](./include/defaults.h)):

| Konstanta | Nilai | Sumber |
|---|---|---|
| `SERA_TOPIC_PREFIX` | `sera` | `MQTT_TOPIC_PREFIX` |
| `SERA_SITE_ID` | `demo-01` | `MQTT_SITE_ID` |
| `SERA_DEVICE_ID` | `esp32-01` | `Sensor.deviceId` (seed) |
| `SERA_SENSOR_*` | `lvl-head-01`, `flow-head-01`, `lvl-tail-01` | tabel `Sensor` |

## Build & flash

```bash
pio run                 # build
pio run -t upload       # flash
pio device monitor      # 115200 baud
```

## Verifikasi cepat

```bash
# telemetry yang dikirim device
mosquitto_sub -h 127.0.0.1 -t 'sera/demo-01/esp32-01/telemetry' -v

# command yang dipublish backend setelah plan di-approve & di-execute
mosquitto_sub -h 127.0.0.1 -t 'sera/demo-01/esp32-01/command' -v

# ack dari device
mosquitto_sub -h 127.0.0.1 -t 'sera/demo-01/esp32-01/command/ack' -v
```

Uji loop penuh: `SERA_MQTT_HOST=<ip-broker> bash scripts/e2e-smoke.sh`.

## Yang perlu diganti saat sensor sudah ada

| Lokasi | Ganti dengan |
|---|---|
| `readSensors()` di `src/main.cpp` | pembacaan ultrasonic/ToF/ADC + filter median |
| `serviceGate()` | `ledcWrite`/Servo + feedback potensiometer |
| kalibrasi level→debit | artefak YAML di `calibration/` |

## Batasan yang diketahui

- **Arduino-ESP32 2.0.17**, bukan 3.3.12 seperti [`docs/SERA_v3_03_TECH_STACK.md`](../../../docs/SERA_v3_03_TECH_STACK.md) §7.
  Platform resmi PlatformIO (`platform = espressif32`) belum menyediakan core 3.x;
  untuk core 3.x perlu platform komunitas `pioarduino`. Pinned di `platformio.ini`.
- **MQTT 3.1.1**, bukan 5.0 seperti `docs/SERA_v3_06_HARDWARE_IOT.md` §7.1.
  PubSubClient hanya mendukung 3.1.1; broker mosquitto menerima keduanya dan
  backend (`mqtt.js`, protocolVersion 5) tidak terpengaruh. Ganti ke `esp_mqtt`
  bila MQTT 5.0 wajib (mis. butuh user properties).
- **Field password di portal tampil sebagai teks biasa** — API `WiFiManagerParameter`
  v2.0.17 belum mendukung `type="password"`. Untuk demo/lab ini dapat diterima;
  jangan dipakai di lapangan tanpa penyesuaian.
- **Buffer offline terbatas 8 sample** dan sample yang lebih tua dari
  `SERA_MAX_SKEW_S` dibuang saat flush, karena backend menolak timestamp di luar
  `TELEMETRY_MAX_SKEW_S` (default 300 s) dengan alasan `timestamp_skew`.
- **LWT memakai timestamp saat connect**, bukan saat disconnect — `handleStatus`
  di backend tidak memeriksa skew untuk topik `status`, jadi ini aman.
- Gate mock tidak punya sensor posisi; `position_pct` di ACK adalah posisi
  internal, bukan hasil pengukuran.
