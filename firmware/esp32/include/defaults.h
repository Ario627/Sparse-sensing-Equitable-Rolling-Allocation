// Default non-rahasia untuk node SERA.
//
// Tidak ada kredensial Wi-Fi atau MQTT di sini. Semuanya diisi lewat captive
// portal WiFiManager pada boot pertama dan disimpan di NVS — sesuai aturan
// 5.2 no.1 docs/SERA_v3_06_HARDWARE_IOT.md ("tidak ada secret hardcoded").
#pragma once

// ------------------------------------------------------------------ identitas
// Harus sama persis dengan seed Prisma: site "demo-01", device "esp32-01".
#define SERA_TOPIC_PREFIX "sera"
#define SERA_SITE_ID "demo-01"
#define SERA_DEVICE_ID "esp32-01"
#define SERA_FIRMWARE_VERSION "0.2.0"

// ID sensor harus terdaftar di tabel Sensor dengan type + unit yang sama.
#define SERA_SENSOR_LEVEL_HEAD "lvl-head-01"
#define SERA_SENSOR_FLOW_HEAD "flow-head-01"
#define SERA_SENSOR_LEVEL_TAIL "lvl-tail-01"

// ------------------------------------------------------------------ captive portal
// Nama AP yang muncul saat provisioning: SERA-<SERA_DEVICE_ID>.
#define SERA_AP_PREFIX "SERA-"
// Password AP portal. Kosongkan ("") bila ingin portal terbuka.
#define SERA_AP_PASSWORD "sera-setup"
// Portal ditutup setelah sekian detik tanpa aktivitas; akan dibuka lagi
// otomatis selama perangkat belum pernah tersambung.
#define SERA_PORTAL_TIMEOUT_S 180

// ------------------------------------------------------------------ perilaku
#define SERA_TELEMETRY_INTERVAL_MS 5000
// Harus <= TELEMETRY_MAX_SKEW_S di backend (default 300 s), kalau tidak
// sample yang di-buffer pasti ditolak dengan alasan timestamp_skew.
#define SERA_MAX_SKEW_S 300
#define SERA_MQTT_PORT_DEFAULT 1883

// Tombol BOOT (GPIO0) ditahan sekian ms saat boot untuk menghapus semua
// kredensial & konfigurasi lalu membuka portal lagi.
#define SERA_RESET_PIN 0
#define SERA_RESET_HOLD_MS 5000
