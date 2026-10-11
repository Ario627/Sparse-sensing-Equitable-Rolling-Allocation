// SERA — firmware node ESP32 (mode mock, belum ada sensor fisik).
//
// Provisioning memakai WiFiManager (captive portal). Pada boot pertama perangkat
// membuka AP "SERA-<device>"; buka halaman portal, isi Wi-Fi + alamat broker,
// lalu simpan. Semua nilai masuk NVS — tidak ada kredensial di source.
//
// Kontrak yang dipatuhi (packages/contracts/src/topics.ts + telemetry.ts,
// dan services/api/src/mqtt/mqtt.topic.ts di sisi backend):
//
//   sera/<site>/<device>/telemetry      device -> broker, QoS 1
//   sera/<site>/<device>/status         device -> broker, QoS 1 + retain (LWT offline)
//   sera/<site>/<device>/command        broker -> device, QoS 1
//   sera/<site>/<device>/command/ack    device -> broker, QoS 1
//
// Yang divalidasi backend (TelemetryService.handleTelemetry) dan wajib cocok:
//   * site_id / device_id di payload harus sama dengan segmen topik
//   * sensor_id harus terdaftar di DB, type dan unit harus sama persis
//   * |ts - waktu backend| <= TELEMETRY_MAX_SKEW_S (default 300 s) -> wajib NTP
//   * schema_version = 1 dan objek bersifat strict (tidak boleh ada field asing)
//   * seq monoton per device; (sensor_id, ts, seq) unik -> retransmit aman

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <esp_system.h>

#include "defaults.h"

namespace {

// ------------------------------------------------------------------ konstanta

constexpr int SCHEMA_VERSION = 1;
constexpr uint16_t MQTT_BUFFER_BYTES = 768;
constexpr uint32_t MQTT_KEEPALIVE_S = 30;
constexpr size_t BUFFER_SLOTS = 8;

constexpr uint32_t MQTT_BACKOFF_BASE_MS = 1000;
constexpr uint32_t MQTT_BACKOFF_MAX_MS = 30000;
constexpr uint32_t WIFI_RETRY_MS = 15000;
constexpr uint32_t PORTAL_REOPEN_MS = 30000;
constexpr uint32_t NTP_RETRY_MS = 10000;
constexpr uint32_t WDT_STALL_MS = 60000;

constexpr float GATE_RAMP_PCT_PER_S = 100.0f;
constexpr float GATE_TOLERANCE_PCT = 0.5f;
constexpr uint32_t GATE_TIMEOUT_MS = 10000;
constexpr uint32_t STATUS_HEARTBEAT_MS = 60000;

constexpr int64_t MIN_VALID_EPOCH = 1700000000LL;

constexpr size_t FIELD_HOST = 64;
constexpr size_t FIELD_USER = 48;
constexpr size_t FIELD_PASS = 64;

// ------------------------------------------------------------------ konfigurasi (NVS)

struct DeviceConfig {
  char mqttHost[FIELD_HOST];
  char mqttPort[8];
  char mqttUser[FIELD_USER];
  char mqttPass[FIELD_PASS];
};

DeviceConfig config = {"", "", "", ""};

Preferences preferences;
WiFiManager wifiManager;

char apName[32];

// Buffer parameter harus hidup selama portal aktif.
char paramHostValue[FIELD_HOST];
char paramPortValue[8];
char paramUserValue[FIELD_USER];
char paramPassValue[FIELD_PASS];

WiFiManagerParameter paramMqttHost("mqtt_host", "MQTT host (IP LAN broker)",
                                   paramHostValue, FIELD_HOST);
WiFiManagerParameter paramMqttPort("mqtt_port", "MQTT port", paramPortValue, 8);
WiFiManagerParameter paramMqttUser("mqtt_user", "MQTT username (opsional)",
                                   paramUserValue, FIELD_USER);
WiFiManagerParameter paramMqttPass("mqtt_pass", "MQTT password (opsional)",
                                   paramPassValue, FIELD_PASS);

bool configLoaded = false;

void loadConfig() {
  preferences.begin("sera", true);
  const String host = preferences.getString("mqtt_host", "");
  const String port = preferences.getString("mqtt_port", "");
  const String user = preferences.getString("mqtt_user", "");
  const String pass = preferences.getString("mqtt_pass", "");
  preferences.end();

  strncpy(config.mqttHost, host.c_str(), FIELD_HOST - 1);
  config.mqttHost[FIELD_HOST - 1] = '\0';
  strncpy(config.mqttPort, port.length() > 0 ? port.c_str() : "1883", 7);
  config.mqttPort[7] = '\0';
  strncpy(config.mqttUser, user.c_str(), FIELD_USER - 1);
  config.mqttUser[FIELD_USER - 1] = '\0';
  strncpy(config.mqttPass, pass.c_str(), FIELD_PASS - 1);
  config.mqttPass[FIELD_PASS - 1] = '\0';

  configLoaded = config.mqttHost[0] != '\0';
}

void saveConfig() {
  preferences.begin("sera", false);
  preferences.putString("mqtt_host", config.mqttHost);
  preferences.putString("mqtt_port", config.mqttPort);
  preferences.putString("mqtt_user", config.mqttUser);
  preferences.putString("mqtt_pass", config.mqttPass);
  preferences.end();
  configLoaded = config.mqttHost[0] != '\0';
}

void clearConfig() {
  preferences.begin("sera", false);
  preferences.clear();
  preferences.end();
  config.mqttHost[0] = '\0';
  config.mqttPort[0] = '\0';
  config.mqttUser[0] = '\0';
  config.mqttPass[0] = '\0';
  configLoaded = false;
}

uint16_t mqttPort() {
  const long port = strtol(config.mqttPort, nullptr, 10);
  return port > 0 && port <= 65535 ? static_cast<uint16_t>(port)
                                   : SERA_MQTT_PORT_DEFAULT;
}

// Dipanggil WiFiManager tepat setelah pengguna menekan Save di portal.
void onSaveParams() {
  const char* host = paramMqttHost.getValue();
  const char* port = paramMqttPort.getValue();
  const char* user = paramMqttUser.getValue();
  const char* pass = paramMqttPass.getValue();

  strncpy(config.mqttHost, host, FIELD_HOST - 1);
  config.mqttHost[FIELD_HOST - 1] = '\0';
  strncpy(config.mqttPort, port, 7);
  config.mqttPort[7] = '\0';
  strncpy(config.mqttUser, user, FIELD_USER - 1);
  config.mqttUser[FIELD_USER - 1] = '\0';
  strncpy(config.mqttPass, pass, FIELD_PASS - 1);
  config.mqttPass[FIELD_PASS - 1] = '\0';

  saveConfig();
  Serial.print("[cfg] konfigurasi disimpan, broker=");
  Serial.print(config.mqttHost);
  Serial.print(":");
  Serial.println(config.mqttPort);
}

// ------------------------------------------------------------------ state

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

char telemetryTopic[96];
char statusTopic[96];
char commandTopic[96];
char commandAckTopic[96];

uint32_t telemetrySeq = 0;
float gatePosPct = 0.0f;
float gateTargetPct = 0.0f;

struct Sample {
  time_t ts;
  uint32_t seq;
  float levelHead;
  float flowHead;
  float levelTail;
};

struct BufferedSample {
  Sample sample;
  bool used;
};

BufferedSample sampleBuffer[BUFFER_SLOTS];

struct PendingAck {
  bool active;
  bool waitForGate;
  uint32_t queuedAtMs;
  char commandId[80];
  char status[16];
  char detail[96];
};

PendingAck pendingAck;

uint32_t lastTelemetryMs = 0;
uint32_t lastStatusMs = 0;
uint32_t lastNtpAttemptMs = 0;
uint32_t lastWifiRetryMs = 0;
uint32_t lastPortalAttemptMs = 0;
uint32_t nextMqttAttemptMs = 0;
uint32_t mqttBackoffMs = MQTT_BACKOFF_BASE_MS;
uint32_t droppedSamples = 0;
volatile uint32_t heartbeat = 0;

// ------------------------------------------------------------------ utilitas

uint32_t withJitter(uint32_t baseMs) {
  const uint32_t half = baseMs / 2;
  return half + static_cast<uint32_t>(random(static_cast<long>(half) + 1));
}

void isoUtc(time_t t, char* out, size_t size) {
  struct tm parts;
  gmtime_r(&t, &parts);
  strftime(out, size, "%Y-%m-%dT%H:%M:%SZ", &parts);
}

// Hari sejak 1970-01-01 (algoritma days_from_civil, Howard Hinnant).
// Dipakai supaya parsing expires_at tidak bergantung pada timegm/mktime.
int64_t daysFromCivil(int year, unsigned month, unsigned day) {
  year -= month <= 2 ? 1 : 0;
  const int era = (year >= 0 ? year : year - 399) / 400;
  const unsigned yoe = static_cast<unsigned>(year - era * 400);
  const unsigned doy =
      (153u * (month + (month > 2 ? -3u : 9u)) + 2u) / 5u + day - 1u;
  const unsigned doe = yoe * 365u + yoe / 4u - yoe / 100u + doy;
  return static_cast<int64_t>(era) * 146097 + static_cast<int64_t>(doe) - 719468;
}

bool parseIsoUtc(const char* text, time_t& out) {
  int year, month, day, hour, minute, second;
  if (sscanf(text, "%4d-%2d-%2dT%2d:%2d:%2d", &year, &month, &day, &hour,
             &minute, &second) != 6) {
    return false;
  }
  out = static_cast<time_t>(daysFromCivil(year, month, day) * 86400 +
                            hour * 3600 + minute * 60 + second);
  return true;
}

bool timeSynced() {
  return static_cast<int64_t>(time(nullptr)) >= MIN_VALID_EPOCH;
}

void buildTopics() {
  snprintf(telemetryTopic, sizeof(telemetryTopic), "%s/%s/%s/telemetry",
           SERA_TOPIC_PREFIX, SERA_SITE_ID, SERA_DEVICE_ID);
  snprintf(statusTopic, sizeof(statusTopic), "%s/%s/%s/status",
           SERA_TOPIC_PREFIX, SERA_SITE_ID, SERA_DEVICE_ID);
  snprintf(commandTopic, sizeof(commandTopic), "%s/%s/%s/command",
           SERA_TOPIC_PREFIX, SERA_SITE_ID, SERA_DEVICE_ID);
  snprintf(commandAckTopic, sizeof(commandAckTopic), "%s/%s/%s/command/ack",
           SERA_TOPIC_PREFIX, SERA_SITE_ID, SERA_DEVICE_ID);
}

// ------------------------------------------------------------------ mock sensor
//
// Ganti isi fungsi ini dengan pembacaan sensor sungguhan (ultrasonic/ToF/ADC).
// Selama belum ada sensor, nilai dibangkitkan dari posisi gate supaya loop
// telemetry -> plan -> command -> gate terlihat konsisten saat demo.

void readSensors(float& levelHead, float& flowHead, float& levelTail) {
  const float gate = gatePosPct / 100.0f;
  const float headNoise = random(-60, 61) / 10.0f;
  const float flowNoise = random(-35, 36) / 100.0f;
  const float tailNoise = random(-50, 51) / 10.0f;

  levelHead = 380.0f + 140.0f * gate + headNoise;
  flowHead = 8.6f * gate + flowNoise;
  levelTail = 250.0f + 70.0f * gate + tailNoise;
}

Sample takeSample() {
  Sample sample;
  sample.ts = time(nullptr);
  sample.seq = ++telemetrySeq;
  readSensors(sample.levelHead, sample.flowHead, sample.levelTail);
  return sample;
}

// ------------------------------------------------------------------ publish

bool publishTelemetry(const Sample& sample, const char* quality) {
  char ts[24];
  isoUtc(sample.ts, ts, sizeof(ts));

  char headText[16];
  char flowText[16];
  char tailText[16];
  dtostrf(sample.levelHead, 0, 1, headText);
  dtostrf(sample.flowHead, 0, 1, flowText);
  dtostrf(sample.levelTail, 0, 1, tailText);

  JsonDocument doc;
  doc["schema_version"] = SCHEMA_VERSION;
  doc["device_id"] = SERA_DEVICE_ID;
  doc["site_id"] = SERA_SITE_ID;
  doc["seq"] = sample.seq;
  doc["ts"] = ts;

  JsonArray readings = doc["readings"].to<JsonArray>();

  JsonObject head = readings.add<JsonObject>();
  head["sensor_id"] = SERA_SENSOR_LEVEL_HEAD;
  head["type"] = "WATER_LEVEL";
  head["value"] = serialized(headText);
  head["unit"] = "mm";
  head["quality"] = quality;

  JsonObject flow = readings.add<JsonObject>();
  flow["sensor_id"] = SERA_SENSOR_FLOW_HEAD;
  flow["type"] = "FLOW";
  flow["value"] = serialized(flowText);
  flow["unit"] = "L/s";
  flow["quality"] = quality;

  JsonObject tail = readings.add<JsonObject>();
  tail["sensor_id"] = SERA_SENSOR_LEVEL_TAIL;
  tail["type"] = "WATER_LEVEL";
  tail["value"] = serialized(tailText);
  tail["unit"] = "mm";
  tail["quality"] = quality;

  doc["rssi_dbm"] = WiFi.RSSI();
  doc["firmware"] = SERA_FIRMWARE_VERSION;

  char payload[MQTT_BUFFER_BYTES];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  if (length == 0 || length >= sizeof(payload)) {
    Serial.println("[telemetry] payload tidak muat di buffer MQTT");
    return false;
  }
  return mqtt.publish(telemetryTopic,
                      reinterpret_cast<const uint8_t*>(payload),
                      static_cast<unsigned int>(length));
}

void buildStatusPayload(const char* status, char* out, size_t size) {
  char ts[24];
  isoUtc(time(nullptr), ts, sizeof(ts));
  snprintf(out, size,
           "{\"schema_version\":%d,\"device_id\":\"%s\",\"site_id\":\"%s\","
           "\"status\":\"%s\",\"ts\":\"%s\"}",
           SCHEMA_VERSION, SERA_DEVICE_ID, SERA_SITE_ID, status, ts);
}

void publishStatus(const char* status) {
  char payload[192];
  buildStatusPayload(status, payload, sizeof(payload));
  mqtt.publish(statusTopic, reinterpret_cast<const uint8_t*>(payload),
               static_cast<unsigned int>(strlen(payload)), true);
}

bool publishAck(const char* commandId, const char* status, int positionPct,
                const char* detail) {
  char ts[24];
  isoUtc(time(nullptr), ts, sizeof(ts));

  JsonDocument doc;
  doc["schema_version"] = SCHEMA_VERSION;
  doc["command_id"] = commandId;
  doc["device_id"] = SERA_DEVICE_ID;
  doc["ts"] = ts;
  doc["status"] = status;
  if (positionPct < 0) {
    doc["position_pct"] = nullptr;
  } else {
    doc["position_pct"] = positionPct;
  }
  if (detail == nullptr) {
    doc["detail"] = nullptr;
  } else {
    doc["detail"] = detail;
  }

  char payload[MQTT_BUFFER_BYTES];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  if (length == 0 || length >= sizeof(payload)) {
    return false;
  }
  return mqtt.publish(commandAckTopic,
                      reinterpret_cast<const uint8_t*>(payload),
                      static_cast<unsigned int>(length));
}

// ------------------------------------------------------------------ buffer offline

void pushSample(const Sample& sample) {
  for (BufferedSample& slot : sampleBuffer) {
    if (!slot.used) {
      slot.sample = sample;
      slot.used = true;
      return;
    }
  }
  for (size_t i = 1; i < BUFFER_SLOTS; i += 1) {
    sampleBuffer[i - 1].sample = sampleBuffer[i].sample;
  }
  sampleBuffer[BUFFER_SLOTS - 1].sample = sample;
  droppedSamples += 1;
}

void flushSampleBuffer() {
  const time_t now = time(nullptr);
  for (BufferedSample& slot : sampleBuffer) {
    if (!slot.used) {
      continue;
    }
    slot.used = false;
    if (now - slot.sample.ts > SERA_MAX_SKEW_S) {
      // Backend akan menolaknya dengan alasan timestamp_skew; lebih baik dibuang.
      droppedSamples += 1;
      continue;
    }
    publishTelemetry(slot.sample, "STALE");
  }
}

// ------------------------------------------------------------------ command

void queueAck(const char* commandId, const char* status, const char* detail,
              bool waitForGate) {
  if (pendingAck.active) {
    Serial.println("[command] ACK sebelumnya belum terkirim, command baru diabaikan");
    return;
  }
  pendingAck.active = true;
  pendingAck.waitForGate = waitForGate;
  pendingAck.queuedAtMs = millis();
  strncpy(pendingAck.commandId, commandId, sizeof(pendingAck.commandId) - 1);
  pendingAck.commandId[sizeof(pendingAck.commandId) - 1] = '\0';
  strncpy(pendingAck.status, status, sizeof(pendingAck.status) - 1);
  pendingAck.status[sizeof(pendingAck.status) - 1] = '\0';
  strncpy(pendingAck.detail, detail, sizeof(pendingAck.detail) - 1);
  pendingAck.detail[sizeof(pendingAck.detail) - 1] = '\0';
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, commandTopic) != 0) {
    return;
  }
  static char text[MQTT_BUFFER_BYTES];
  if (length >= sizeof(text)) {
    Serial.println("[command] payload terlalu besar, diabaikan");
    return;
  }
  memcpy(text, payload, length);
  text[length] = '\0';

  JsonDocument doc;
  if (deserializeJson(doc, text) != DeserializationError::Ok) {
    Serial.println("[command] JSON tidak valid, diabaikan");
    return;
  }

  const char* commandId = doc["command_id"] | "";
  const char* action = doc["action"] | "";
  const char* expiresAtText = doc["expires_at"] | "";
  if (commandId[0] == '\0') {
    Serial.println("[command] tanpa command_id, diabaikan");
    return;
  }

  time_t expiresAt = 0;
  if (parseIsoUtc(expiresAtText, expiresAt) && expiresAt <= time(nullptr)) {
    Serial.println("[command] kadaluarsa, tidak dieksekusi");
    queueAck(commandId, "expired", "command expired before execution", false);
    return;
  }

  float target;
  if (strcmp(action, "open") == 0) {
    target = 100.0f;
  } else if (strcmp(action, "close") == 0) {
    target = 0.0f;
  } else if (strcmp(action, "set_position") == 0) {
    const int positionPct = doc["position_pct"] | -1;
    if (positionPct < 0 || positionPct > 100) {
      queueAck(commandId, "rejected", "invalid position_pct", false);
      return;
    }
    target = static_cast<float>(positionPct);
  } else {
    queueAck(commandId, "rejected", "unsupported action", false);
    return;
  }

  gateTargetPct = target;
  queueAck(commandId, "accepted", "executed", true);
  Serial.print("[command] action=");
  Serial.print(action);
  Serial.print(" -> target=");
  Serial.println(static_cast<int>(target));
}

// ------------------------------------------------------------------ gate mock
//
// Ganti dengan Servo/led aktuator sungguhan. Ramp dipertahankan supaya
// ACK baru dikirim setelah gate benar-benar mencapai posisi target.

void serviceGate(uint32_t deltaMs) {
  const float step = GATE_RAMP_PCT_PER_S * static_cast<float>(deltaMs) / 1000.0f;
  if (gatePosPct < gateTargetPct) {
    gatePosPct = min(gateTargetPct, gatePosPct + step);
  } else if (gatePosPct > gateTargetPct) {
    gatePosPct = max(gateTargetPct, gatePosPct - step);
  }
}

void servicePendingAck() {
  if (!pendingAck.active || !mqtt.connected()) {
    return;
  }
  const int positionPct = static_cast<int>(lroundf(gatePosPct));
  if (pendingAck.waitForGate) {
    const bool reached = fabsf(gatePosPct - gateTargetPct) <= GATE_TOLERANCE_PCT;
    const bool timedOut = millis() - pendingAck.queuedAtMs > GATE_TIMEOUT_MS;
    if (!reached && !timedOut) {
      return;
    }
    const char* detail = reached ? "executed" : "gate did not reach target";
    if (publishAck(pendingAck.commandId, pendingAck.status, positionPct, detail)) {
      pendingAck.active = false;
    }
    return;
  }
  if (publishAck(pendingAck.commandId, pendingAck.status, positionPct,
                 pendingAck.detail)) {
    pendingAck.active = false;
  }
}

// ------------------------------------------------------------------ jaringan

void serviceWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }
  if (wifiManager.getConfigPortalActive()) {
    return;
  }
  const uint32_t now = millis();
  if (now - lastWifiRetryMs < WIFI_RETRY_MS) {
    return;
  }
  lastWifiRetryMs = now;

  if (!wifiManager.getWiFiIsSaved()) {
    return;
  }
  Serial.println("[wifi] mencoba menyambung ulang...");
  WiFi.reconnect();
}

// Selama perangkat belum pernah tersambung (atau config belum lengkap),
// portal dibuka ulang berkala supaya bisa diperbaiki tanpa cabut-flash.
void servicePortal() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }
  if (wifiManager.getConfigPortalActive()) {
    return;
  }
  if (wifiManager.getWiFiIsSaved() && configLoaded) {
    return;
  }
  const uint32_t now = millis();
  if (now - lastPortalAttemptMs < PORTAL_REOPEN_MS) {
    return;
  }
  lastPortalAttemptMs = now;
  Serial.print("[cfg] membuka portal di AP ");
  Serial.println(apName);
  wifiManager.startConfigPortal(apName, SERA_AP_PASSWORD);
}

void serviceTime() {
  if (timeSynced() || WiFi.status() != WL_CONNECTED) {
    return;
  }
  const uint32_t now = millis();
  if (now - lastNtpAttemptMs < NTP_RETRY_MS) {
    return;
  }
  lastNtpAttemptMs = now;
  Serial.println("[ntp] sinkronisasi waktu UTC...");
  configTzTime("UTC0", "pool.ntp.org", "time.google.com");
}

bool connectMqtt() {
  char clientId[64];
  snprintf(clientId, sizeof(clientId), "%s-%s", SERA_TOPIC_PREFIX, SERA_DEVICE_ID);

  char willPayload[192];
  buildStatusPayload("offline", willPayload, sizeof(willPayload));

  const char* username = config.mqttUser[0] != '\0' ? config.mqttUser : nullptr;
  const char* password = config.mqttPass[0] != '\0' ? config.mqttPass : nullptr;

  if (!mqtt.connect(clientId, username, password, statusTopic, 1, true,
                    willPayload)) {
    Serial.print("[mqtt] gagal connect, state=");
    Serial.println(mqtt.state());
    return false;
  }
  mqtt.subscribe(commandTopic, 1);
  publishStatus("online");
  flushSampleBuffer();
  Serial.print("[mqtt] terhubung ke ");
  Serial.print(config.mqttHost);
  Serial.print(":");
  Serial.println(mqttPort());
  return true;
}

void serviceMqtt() {
  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }
  if (WiFi.status() != WL_CONNECTED || !timeSynced() || !configLoaded) {
    return;
  }
  const uint32_t now = millis();
  if (now < nextMqttAttemptMs) {
    return;
  }
  nextMqttAttemptMs = now + withJitter(mqttBackoffMs);
  if (connectMqtt()) {
    mqttBackoffMs = MQTT_BACKOFF_BASE_MS;
  } else {
    mqttBackoffMs = min<uint32_t>(mqttBackoffMs * 2, MQTT_BACKOFF_MAX_MS);
  }
}

// ------------------------------------------------------------------ periodic

void serviceTelemetry() {
  const uint32_t now = millis();
  if (now - lastTelemetryMs < SERA_TELEMETRY_INTERVAL_MS) {
    return;
  }
  lastTelemetryMs = now;
  const Sample sample = takeSample();
  if (!mqtt.connected()) {
    pushSample(sample);
    return;
  }
  if (!publishTelemetry(sample, "GOOD")) {
    pushSample(sample);
  }
}

void serviceStatus() {
  const uint32_t now = millis();
  if (now - lastStatusMs < STATUS_HEARTBEAT_MS) {
    return;
  }
  lastStatusMs = now;
  if (mqtt.connected()) {
    publishStatus("online");
  }
}

// ------------------------------------------------------------------ watchdog

void watchdogTask(void*) {
  uint32_t seen = heartbeat;
  uint32_t lastChangeMs = millis();
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(1000));
    if (heartbeat != seen) {
      seen = heartbeat;
      lastChangeMs = millis();
    } else if (millis() - lastChangeMs > WDT_STALL_MS) {
      Serial.println("[wdt] loop utama macet, reboot aman");
      Serial.flush();
      ESP.restart();
    }
  }
}

// ------------------------------------------------------------------ provisioning

bool resetButtonHeld() {
  pinMode(SERA_RESET_PIN, INPUT_PULLUP);
  if (digitalRead(SERA_RESET_PIN) != LOW) {
    return false;
  }
  Serial.println("[cfg] tombol BOOT ditahan, lepaskan untuk reset konfigurasi...");
  const uint32_t startMs = millis();
  while (millis() - startMs < SERA_RESET_HOLD_MS) {
    if (digitalRead(SERA_RESET_PIN) != LOW) {
      Serial.println("[cfg] dibatalkan");
      return false;
    }
    delay(50);
  }
  return true;
}

void setupProvisioning() {
  strncpy(apName, SERA_AP_PREFIX SERA_DEVICE_ID, sizeof(apName) - 1);
  apName[sizeof(apName) - 1] = '\0';

  strncpy(paramHostValue, config.mqttHost, FIELD_HOST - 1);
  paramHostValue[FIELD_HOST - 1] = '\0';
  strncpy(paramPortValue, config.mqttPort[0] != '\0' ? config.mqttPort : "1883", 7);
  paramPortValue[7] = '\0';
  strncpy(paramUserValue, config.mqttUser, FIELD_USER - 1);
  paramUserValue[FIELD_USER - 1] = '\0';
  strncpy(paramPassValue, config.mqttPass, FIELD_PASS - 1);
  paramPassValue[FIELD_PASS - 1] = '\0';

  wifiManager.setDebugOutput(false);
  wifiManager.setConfigPortalBlocking(false);
  wifiManager.setConfigPortalTimeout(SERA_PORTAL_TIMEOUT_S);
  wifiManager.setConnectTimeout(20);
  wifiManager.setSaveParamsCallback(onSaveParams);
  wifiManager.addParameter(&paramMqttHost);
  wifiManager.addParameter(&paramMqttPort);
  wifiManager.addParameter(&paramMqttUser);
  wifiManager.addParameter(&paramMqttPass);
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("SERA node firmware " SERA_FIRMWARE_VERSION " (mode mock)");

  loadConfig();
  if (resetButtonHeld()) {
    Serial.println("[cfg] menghapus kredensial Wi-Fi & konfigurasi MQTT");
    clearConfig();
    wifiManager.resetSettings();
    Serial.println("[cfg] selesai, portal akan dibuka");
  }

  buildTopics();
  Serial.print("[mqtt] telemetry=");
  Serial.println(telemetryTopic);
  if (configLoaded) {
    Serial.print("[cfg] broker tersimpan=");
    Serial.print(config.mqttHost);
    Serial.print(":");
    Serial.println(config.mqttPort);
  } else {
    Serial.println("[cfg] broker belum dikonfigurasi, portal akan dibuka");
  }

  randomSeed(esp_random());

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  setupProvisioning();
  wifiManager.autoConnect(apName, SERA_AP_PASSWORD);

  mqtt.setBufferSize(MQTT_BUFFER_BYTES);
  mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
  mqtt.setCallback(onMqttMessage);

  xTaskCreatePinnedToCore(watchdogTask, "sera-wdt", 2048, nullptr, 1, nullptr, 0);
}

void loop() {
  static uint32_t lastTickMs = millis();
  const uint32_t now = millis();
  const uint32_t deltaMs = now - lastTickMs;
  lastTickMs = now;

  wifiManager.process();

  servicePortal();
  serviceWifi();
  serviceTime();
  serviceMqtt();
  serviceGate(deltaMs);
  servicePendingAck();
  serviceTelemetry();
  serviceStatus();

  heartbeat += 1;
  delay(10);
}
