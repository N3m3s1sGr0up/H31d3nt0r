#!/usr/bin/env bash
# Operator-local launcher. Node loads .env.local via loadConfig() — no bash source.
set -euo pipefail
umask 0077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env.local"
if [[ ! -r "$ENV_FILE" ]]; then
  echo "start.sh: missing $ENV_FILE — copy .env.local.example and set CURSOR_API_KEY + BRIDGE_API_KEY" >&2
  exit 1
fi

# Defense-in-depth: refuse to start if secrets file is world-readable.
# GNU stat (-c, Linux) is tried first; BSD/macOS stat (-f) is the fallback.
mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")"
if [[ "$mode" != "600" && "$mode" != "400" ]]; then
  echo "start.sh: $ENV_FILE must be mode 600 (run: chmod 600 .env.local)" >&2
  exit 1
fi

export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

if [[ ! -f "$ROOT/dist/index.js" ]]; then
  echo "start.sh: dist/index.js missing — run: npm run build" >&2
  exit 1
fi

read_env_kv() {
  local key="$1"
  local default="${2:-}"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    printf '%s' "$default"
    return
  fi
  printf '%s' "${line#*=}"
}

HOST="$(read_env_kv HOST "127.0.0.1")"
PORT="$(read_env_kv PORT "8787")"
BASE_URL="http://${HOST}:${PORT}"

OS="$(uname -s)"

SYSTEMD_USER_UNIT="h31d3nt0r.service"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SYSTEMD_USER_DST="${SYSTEMD_USER_DIR}/${SYSTEMD_USER_UNIT}"
SYSTEMD_USER_SRC="$ROOT/systemd/h31d3nt0r.user.service"

listener_pid() {
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true
}

is_h31d3nt0r_pid() {
  local pid="$1"
  local cmd
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$cmd" == *"dist/index.js"* ]]
}

systemd_user_available() {
  [[ "$OS" == "Linux" ]] && command -v systemctl >/dev/null 2>&1
}

systemd_unit_installed() {
  [[ -f "$SYSTEMD_USER_DST" ]]
}

systemd_unit_active() {
  systemctl --user is-active --quiet "$SYSTEMD_USER_UNIT" 2>/dev/null
}

# Poll /health until ready (node binds ~1-2s after exec). Returns 0 once up.
wait_for_health() {
  local tries="${1:-20}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

LAUNCHD_LABEL="com.h31d3nt0r"
LAUNCHD_DOMAIN="gui/$(id -u)"
LAUNCHD_TARGET="${LAUNCHD_DOMAIN}/${LAUNCHD_LABEL}"
LAUNCHD_PLIST_SRC="$ROOT/launchd/com.h31d3nt0r.plist"
LAUNCHD_PLIST_DST="${HOME}/Library/LaunchAgents/com.h31d3nt0r.plist"

launchd_loaded() {
  launchctl print "$LAUNCHD_TARGET" &>/dev/null
}

cmd_install_autoboot_macos() {
  if [[ ! -f "$LAUNCHD_PLIST_SRC" ]]; then
    echo "start.sh: missing $LAUNCHD_PLIST_SRC" >&2
    exit 1
  fi
  local node_bin
  node_bin="$(command -v node)"
  if [[ -z "$node_bin" ]]; then
    echo "start.sh: node not found on PATH" >&2
    exit 1
  fi
  mkdir -p "$ROOT/logs"
  mkdir -p "${HOME}/Library/LaunchAgents"
  sed \
    -e "s|__INSTALL_ROOT__|${ROOT}|g" \
    -e "s|__NODE__|${node_bin}|g" \
    "$LAUNCHD_PLIST_SRC" >"$LAUNCHD_PLIST_DST"
  if launchd_loaded; then
    launchctl bootout "$LAUNCHD_DOMAIN" "$LAUNCHD_PLIST_DST" 2>/dev/null || true
  fi
  local pid
  pid="$(listener_pid)"
  if [[ -n "$pid" ]] && is_h31d3nt0r_pid "$pid"; then
    echo "h31d3nt0r: stopping manual instance (pid ${pid}) before launchd takeover"
    kill -TERM "$pid" || true
    sleep 1
  fi
  launchctl bootstrap "$LAUNCHD_DOMAIN" "$LAUNCHD_PLIST_DST"
  sleep 1
  echo "h31d3nt0r: autoboot installed — starts at login via launchd"
  echo "  Plist: $LAUNCHD_PLIST_DST"
  echo "  Logs:  $ROOT/logs/launchd.{stdout,stderr}.log"
  cmd_status || true
}

cmd_install_autoboot_linux() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "start.sh: systemctl not found — this host does not use systemd" >&2
    exit 1
  fi
  if [[ ! -f "$SYSTEMD_USER_SRC" ]]; then
    echo "start.sh: missing $SYSTEMD_USER_SRC" >&2
    exit 1
  fi
  local node_bin
  node_bin="$(command -v node)"
  if [[ -z "$node_bin" ]]; then
    echo "start.sh: node not found on PATH" >&2
    exit 1
  fi
  mkdir -p "$ROOT/logs" "$SYSTEMD_USER_DIR"
  sed \
    -e "s|__INSTALL_ROOT__|${ROOT}|g" \
    -e "s|__NODE__|${node_bin}|g" \
    "$SYSTEMD_USER_SRC" >"$SYSTEMD_USER_DST"
  # Free the port if a manual instance is holding it before systemd takes over.
  local pid
  pid="$(listener_pid)"
  if [[ -n "$pid" ]] && is_h31d3nt0r_pid "$pid"; then
    echo "h31d3nt0r: stopping manual instance (pid ${pid}) before systemd takeover"
    kill -TERM "$pid" 2>/dev/null || true
    sleep 1
  fi
  systemctl --user daemon-reload
  systemctl --user enable --now "$SYSTEMD_USER_UNIT"
  # Linger keeps the user manager (and this service) running without an active
  # login session — required to survive logout and to start at boot.
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$(id -un)" 2>/dev/null || \
      echo "start.sh: could not enable linger — run: sudo loginctl enable-linger $(id -un)" >&2
  fi
  wait_for_health || true
  echo "h31d3nt0r: autoboot installed — starts at boot via systemd user service"
  echo "  Unit:  $SYSTEMD_USER_DST"
  echo "  Logs:  journalctl --user -u $SYSTEMD_USER_UNIT -f"
  cmd_status || true
}

cmd_install_autoboot() {
  case "$OS" in
    Darwin) cmd_install_autoboot_macos ;;
    Linux) cmd_install_autoboot_linux ;;
    *)
      echo "start.sh: install-autoboot not supported on $OS" >&2
      exit 1
      ;;
  esac
}

cmd_uninstall_autoboot_macos() {
  if launchd_loaded; then
    launchctl bootout "$LAUNCHD_DOMAIN" "$LAUNCHD_PLIST_DST" 2>/dev/null || \
      launchctl bootout "$LAUNCHD_TARGET" 2>/dev/null || true
  fi
  if [[ -f "$LAUNCHD_PLIST_DST" ]]; then
    rm -f "$LAUNCHD_PLIST_DST"
  fi
  echo "h31d3nt0r: autoboot removed — will not start at login"
}

cmd_uninstall_autoboot_linux() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "start.sh: systemctl not found — nothing to remove" >&2
    exit 1
  fi
  if systemd_unit_installed; then
    systemctl --user disable --now "$SYSTEMD_USER_UNIT" 2>/dev/null || true
    rm -f "$SYSTEMD_USER_DST"
    systemctl --user daemon-reload
  fi
  echo "h31d3nt0r: autoboot removed — will not start at boot"
  echo "  Note: user linger is left enabled (disable with: loginctl disable-linger $(id -un))"
}

cmd_uninstall_autoboot() {
  case "$OS" in
    Darwin) cmd_uninstall_autoboot_macos ;;
    Linux) cmd_uninstall_autoboot_linux ;;
    *)
      echo "start.sh: uninstall-autoboot not supported on $OS" >&2
      exit 1
      ;;
  esac
}

cmd_status() {
  local pid
  pid="$(listener_pid)"
  if [[ -z "$pid" ]]; then
    echo "h31d3nt0r: not listening on ${HOST}:${PORT}"
    exit 1
  fi
  echo "h31d3nt0r: listening on ${HOST}:${PORT} (pid ${pid})"
  local health
  if health="$(curl -sf "${BASE_URL}/health" 2>/dev/null)"; then
    if command -v jq >/dev/null 2>&1; then
      printf '%s\n' "$health" | jq .
    else
      printf '%s\n' "$health"
    fi
    return 0
  fi
  echo "start.sh: port ${PORT} is in use but /health did not respond" >&2
  exit 1
}

cmd_stop() {
  if systemd_user_available && systemd_unit_active; then
    echo "h31d3nt0r: stopping systemd user service (stays enabled for next boot)"
    systemctl --user stop "$SYSTEMD_USER_UNIT" || true
    sleep 0.5
    if [[ -z "$(listener_pid)" ]]; then
      echo "h31d3nt0r: stopped"
      exit 0
    fi
  fi
  if launchd_loaded; then
    echo "h31d3nt0r: stopping launchd job (until next login or ./start.sh start)"
    launchctl bootout "$LAUNCHD_DOMAIN" "$LAUNCHD_PLIST_DST" 2>/dev/null || \
      launchctl bootout "$LAUNCHD_TARGET" 2>/dev/null || true
    sleep 0.5
    if [[ -z "$(listener_pid)" ]]; then
      echo "h31d3nt0r: stopped"
      exit 0
    fi
  fi
  local pid
  pid="$(listener_pid)"
  if [[ -z "$pid" ]]; then
    echo "h31d3nt0r: not listening on ${HOST}:${PORT}"
    exit 0
  fi
  if ! is_h31d3nt0r_pid "$pid"; then
    echo "start.sh: port ${PORT} is held by pid ${pid}, which does not look like h31d3nt0r (dist/index.js)" >&2
    echo "start.sh: refusing to stop — free the port manually if needed" >&2
    exit 1
  fi
  echo "h31d3nt0r: stopping pid ${pid} on ${HOST}:${PORT}"
  kill -TERM "$pid"
  for _ in $(seq 1 20); do
    if [[ -z "$(listener_pid)" ]]; then
      echo "h31d3nt0r: stopped"
      exit 0
    fi
    sleep 0.25
  done
  echo "start.sh: pid ${pid} did not exit after SIGTERM" >&2
  exit 1
}

cmd_start() {
  local pid
  pid="$(listener_pid)"
  if [[ -n "$pid" ]]; then
    if curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
      echo "h31d3nt0r: already running on ${HOST}:${PORT} (pid ${pid})"
      echo "  Check: ./start.sh status"
      echo "  Restart: ./start.sh stop && ./start.sh"
      exit 0
    fi
    echo "start.sh: port ${PORT} is in use but /health failed — check ./start.sh status" >&2
    exit 1
  fi
  if systemd_user_available && systemd_unit_installed; then
    echo "h31d3nt0r: starting via systemd user service (autoboot unit present)"
    systemctl --user start "$SYSTEMD_USER_UNIT"
    wait_for_health || true
    cmd_status
    exit $?
  fi
  if [[ -f "$LAUNCHD_PLIST_DST" ]] && ! launchd_loaded; then
    echo "h31d3nt0r: starting via launchd (autoboot plist present)"
    launchctl bootstrap "$LAUNCHD_DOMAIN" "$LAUNCHD_PLIST_DST"
    sleep 1
    cmd_status
    exit $?
  fi
  exec npm start
}

case "${1:-start}" in
  status) cmd_status ;;
  stop) cmd_stop ;;
  install-autoboot) cmd_install_autoboot ;;
  uninstall-autoboot) cmd_uninstall_autoboot ;;
  start|"") cmd_start ;;
  *)
    echo "start.sh: unknown command '$1' (use: start, status, stop, install-autoboot, uninstall-autoboot)" >&2
    exit 1
    ;;
esac
