#!/usr/bin/env bash
set -uo pipefail

API_BASE="${SERA_API_BASE:-http://localhost:3000/v1}"
SOLVER_BASE="${SERA_SOLVER_BASE:-http://localhost:8000}"
MQTT_HOST="${SERA_MQTT_HOST:-127.0.0.1}"
MQTT_PORT="${SERA_MQTT_PORT:-1883}"
MQTT_SITE="${SERA_MQTT_SITE:-demo-01}"
MQTT_DEVICE="${SERA_MQTT_DEVICE:-esp32-01}"
ADMIN_EMAIL="${SERA_ADMIN_EMAIL:-admin@sera.local}"
ADMIN_PASSWORD="${SERA_ADMIN_PASSWORD:-sera-demo-admin}"
OPERATOR_EMAIL="${SERA_OPERATOR_EMAIL:-operator@sera.local}"
OPERATOR_PASSWORD="${SERA_OPERATOR_PASSWORD:-sera-demo-operator}"

PASS=0
FAIL=0
SKIP=0
PLAN_ID=""
COMMAND_ID=""
TMP_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

pass() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }
skip() { SKIP=$((SKIP + 1)); printf '  SKIP  %s\n' "$1"; }
step() { printf '\n== %s\n' "$1"; }
detail() { printf '        %s\n' "$1"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required command: %s\n' "$1" >&2
    exit 2
  fi
}

wait_http() {
  local url="$1" tries="$2" attempt=0
  while [ "$attempt" -lt "$tries" ]; do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

login() {
  curl -sS --max-time 5 -X POST -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    "$API_BASE/auth/login" | jq -r '.access_token // empty'
}

req() {
  local method="$1" token="$2" path="$3" body="$4" out="$5"
  if [ -n "$body" ]; then
    curl -sS --max-time 30 -o "$out" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
      -d "$body" "$API_BASE$path"
  else
    curl -sS --max-time 30 -o "$out" -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer $token" "$API_BASE$path"
  fi
}

expect_read() {
  local label="$1" path="$2" token="$3" code
  code=$(req GET "$token" "$path" "" "$TMP_DIR/read.json")
  if [ "$code" = "200" ]; then
    pass "$label"
  else
    fail "$label (http $code)"
  fi
}

publish() {
  mosquitto_pub -h "$MQTT_HOST" -p "$MQTT_PORT" -q 1 -t "$1" -m "$2"
}

run_telemetry_step() {
  step "telemetry ingest"
  if ! command -v mosquitto_pub >/dev/null 2>&1; then
    skip "telemetry ingest (mosquitto_pub not installed)"
    return
  fi
  local ts seq payload code fresh
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  seq=$(date +%s)
  payload=$(jq -n --arg ts "$ts" --argjson seq "$seq" \
    --arg device "$MQTT_DEVICE" --arg site "$MQTT_SITE" '{
      schema_version: 1, device_id: $device, site_id: $site, seq: $seq, ts: $ts,
      readings: [
        { sensor_id: "lvl-head-01", type: "WATER_LEVEL", value: 418.2, unit: "mm", quality: "GOOD" },
        { sensor_id: "flow-head-01", type: "FLOW", value: 8.4, unit: "L/s", quality: "GOOD" }
      ],
      firmware: "0.3.1"
    }')
  if ! publish "sera/$MQTT_SITE/$MQTT_DEVICE/telemetry" "$payload"; then
    fail "telemetry publish"
    return
  fi
  sleep 1
  code=$(req GET "$OPERATOR_TOKEN" "/telemetry/latest?network_id=$NETWORK_ID" "" "$TMP_DIR/latest.json")
  fresh=$(jq '[.items[] | select(.ts != null)] | length' "$TMP_DIR/latest.json" 2>/dev/null || printf '0')
  if [ "$code" = "200" ] && [ "$fresh" -ge 1 ]; then
    pass "telemetry reached the api ($fresh fresh sensors)"
  else
    fail "telemetry reached the api (http $code fresh $fresh)"
  fi
}

run_plan_step() {
  step "plan loop"
  local code
  code=$(req POST "$OPERATOR_TOKEN" "/plans" \
    "{\"network_id\":\"$NETWORK_ID\",\"profile\":\"BALANCED\",\"horizon_h\":6}" \
    "$TMP_DIR/plan.json")
  case "$code" in
    200 | 201)
      PLAN_ID=$(jq -r '.id // empty' "$TMP_DIR/plan.json")
      pass "plan propose"
      ;;
    502 | 503)
      skip "plan propose (solver plan endpoint not ready, http $code)"
      return
      ;;
    *)
      fail "plan propose (http $code)"
      detail "$(head -c 180 "$TMP_DIR/plan.json")"
      return
      ;;
  esac

  code=$(req POST "$OPERATOR_TOKEN" "/plans/$PLAN_ID/decision" '{"action":"approve"}' "$TMP_DIR/decision.json")
  local decided
  decided=$(jq -r '.status // empty' "$TMP_DIR/decision.json")
  if [ "$code" = "200" ] && [ "$decided" = "APPROVED" ]; then
    pass "plan approve"
  else
    fail "plan approve (http $code status $decided)"
  fi

  code=$(req POST "$OPERATOR_TOKEN" "/plans/$PLAN_ID/execute" "" "$TMP_DIR/execute.json")
  if [ "$code" = "200" ]; then
    pass "plan execute"
  else
    fail "plan execute (http $code)"
    detail "$(head -c 180 "$TMP_DIR/execute.json")"
  fi

  code=$(req GET "$OPERATOR_TOKEN" "/plans/$PLAN_ID/commands" "" "$TMP_DIR/commands.json")
  local total
  total=$(jq -r '.summary.total // 0' "$TMP_DIR/commands.json")
  if [ "$code" = "200" ] && [ "$total" -ge 1 ]; then
    pass "command log ($total commands)"
    COMMAND_ID=$(jq -r '.items[0].command_id // empty' "$TMP_DIR/commands.json")
  else
    fail "command log (http $code total $total)"
  fi
}

run_ack_step() {
  step "command acknowledgement"
  if [ -z "$COMMAND_ID" ]; then
    skip "ack flow (no command available)"
    return
  fi
  if ! command -v mosquitto_pub >/dev/null 2>&1; then
    skip "ack flow (mosquitto_pub not installed)"
    return
  fi
  local action pos ts payload code acked
  action=$(jq -r --arg id "$COMMAND_ID" '.items[] | select(.command_id == $id) | .action // empty' "$TMP_DIR/commands.json")
  case "$action" in
    close) pos=0 ;;
    *) pos=100 ;;
  esac
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  payload=$(jq -n --arg id "$COMMAND_ID" --arg device "$MQTT_DEVICE" --arg ts "$ts" --argjson pos "$pos" '{
    schema_version: 1, command_id: $id, device_id: $device, ts: $ts,
    status: "accepted", position_pct: $pos, detail: null
  }')
  if ! publish "sera/$MQTT_SITE/$MQTT_DEVICE/command/ack" "$payload"; then
    fail "ack publish"
    return
  fi
  sleep 1
  code=$(req GET "$OPERATOR_TOKEN" "/plans/$PLAN_ID/commands" "" "$TMP_DIR/commands2.json")
  acked=$(jq -r --arg id "$COMMAND_ID" '.items[] | select(.command_id == $id) | .status' "$TMP_DIR/commands2.json" 2>/dev/null || printf '')
  if [ "$code" = "200" ] && [ "$acked" = "accepted" ]; then
    pass "ack recorded"
  else
    fail "ack recorded (http $code status $acked)"
  fi
}

run_ledger_step() {
  step "ledger settlement"
  local code rows
  code=$(req POST "$ADMIN_TOKEN" "/ledger/settle" "{\"network_id\":\"$NETWORK_ID\"}" "$TMP_DIR/settle.json")
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    rows=$(jq -r '.rows_written // 0' "$TMP_DIR/settle.json")
    pass "ledger settle (rows $rows)"
  else
    fail "ledger settle (http $code)"
  fi
  expect_read "ledger current" "/ledger/current?network_id=$NETWORK_ID" "$OPERATOR_TOKEN"
}

run_feeds_step() {
  step "ops feeds"
  expect_read "events feed" "/events?type=alert&limit=5" "$OPERATOR_TOKEN"
  expect_read "events stats" "/events/stats" "$OPERATOR_TOKEN"
  local code
  code=$(req GET "$ADMIN_TOKEN" "/audit/facets" "" "$TMP_DIR/facets.json")
  if [ "$code" = "200" ]; then
    pass "audit facets"
  else
    fail "audit facets (http $code)"
  fi
}

run_experiment_step() {
  step "experiments"

  local code payload
  local experiment_id="E1_smoke_$(date +%s)"

  payload=$(jq -n \
    --arg network "$NETWORK_ID" \
    --arg experiment_id "$experiment_id" '{
      name: $experiment_id,
      network_id: $network,
      config_yaml: (
        "experiment_id: " + $experiment_id +
        "\nseed_base: 1042\n" +
        "methods: [sera]\n" +
        "scenarios: [nominal]\n" +
        "block_counts: [6]\n" +
        "topologies: [CHAIN]\n" +
        "k_factors: [1.0]\n" +
        "sensor_sets: [[b1]]\n" +
        "replicates: 1\n"
      )
    }')

  code=$(req POST "$ADMIN_TOKEN" "/experiments" \
    "$payload" "$TMP_DIR/experiment.json")

  case "$code" in
    200 | 201) pass "experiment start" ;;
    502 | 503) skip "experiment start (solver experiments endpoint not ready, http $code)" ;;
    *) fail "experiment start (http $code)" ;;
  esac
}

run_rbac_step() {
  step "rbac"
  local code
  code=$(req POST "$OPERATOR_TOKEN" "/users" \
    '{"email":"smoke@sera.local","full_name":"Smoke","role":"VIEWER","initial_password":"RahasiaKuat123"}' \
    "$TMP_DIR/rbac.json")
  if [ "$code" = "403" ]; then
    pass "operator cannot create users"
  else
    fail "operator cannot create users (http $code)"
  fi
}

main() {
  printf 'SERA backend e2e smoke\n'
  printf 'api=%s solver=%s mqtt=%s:%s\n' "$API_BASE" "$SOLVER_BASE" "$MQTT_HOST" "$MQTT_PORT"

  require_cmd curl
  require_cmd jq

  step "health"
  if ! wait_http "${API_BASE%/v1}/health" 15; then
    fail "api health"
    printf '\napi is not reachable; aborting\n'
    exit 1
  fi
  pass "api health"
  if wait_http "$SOLVER_BASE/health" 3; then
    pass "solver health"
  else
    skip "solver health (solver down)"
  fi

  step "auth"
  ADMIN_TOKEN=$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  OPERATOR_TOKEN=$(login "$OPERATOR_EMAIL" "$OPERATOR_PASSWORD")
  if [ -n "$ADMIN_TOKEN" ]; then pass "admin login"; else fail "admin login"; fi
  if [ -n "$OPERATOR_TOKEN" ]; then pass "operator login"; else fail "operator login"; fi
  if [ -z "$ADMIN_TOKEN" ] || [ -z "$OPERATOR_TOKEN" ]; then
    printf '\nlogin failed; run the seed first (npm run seed -w @sera/api)\n'
    exit 1
  fi

  step "catalog"
  local code
  code=$(req GET "$ADMIN_TOKEN" "/networks?limit=1" "" "$TMP_DIR/networks.json")
  NETWORK_ID=$(jq -r '.items[0].id // empty' "$TMP_DIR/networks.json")
  if [ "$code" = "200" ] && [ -n "$NETWORK_ID" ]; then
    pass "network catalog"
    detail "network: $NETWORK_ID"
  else
    fail "network catalog (http $code)"
    printf '\nno network available; run the seed first\n'
    exit 1
  fi
  expect_read "sensor catalog" "/sensors?network_id=$NETWORK_ID" "$ADMIN_TOKEN"
  expect_read "estimate snapshot" "/estimates/latest?network_id=$NETWORK_ID" "$OPERATOR_TOKEN"

  run_telemetry_step
  run_plan_step
  run_ack_step
  run_ledger_step
  run_feeds_step
  run_experiment_step
  run_rbac_step

  printf '\npass=%d fail=%d skip=%d\n' "$PASS" "$FAIL" "$SKIP"
  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
}

main "$@"
