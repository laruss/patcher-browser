#!/bin/sh

set -eu

usage() {
  cat >&2 <<'EOF'
Usage: install.sh --join-code <code> --host-id <host-id> --server <url> [--host-daemon-port <port>]

The first three options are required.
By default, the installer assigns this enrolled daemon its own local API port.
EOF
  exit 2
}

join_code=
host_id=
server_url=
requested_host_daemon_port=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --join-code|--host-id|--server|--host-daemon-port)
      [ "$#" -ge 2 ] || usage
      [ -n "$2" ] || usage
      case "$1" in
        --join-code) join_code=$2 ;;
        --host-id) host_id=$2 ;;
        --server) server_url=$2 ;;
        --host-daemon-port) requested_host_daemon_port=$2 ;;
      esac
      shift 2
      ;;
    -h|--help) usage ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
done

[ -n "$join_code" ] || usage
[ -n "$host_id" ] || usage
[ -n "$server_url" ] || usage

case "$(uname -s)" in
  Darwin) platform=darwin ;;
  Linux) platform=linux ;;
  *)
    echo "patcher machine installation supports macOS and Linux only." >&2
    exit 1
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "patcher-app requires Node.js 22.19 or newer (22.19, 24, and 26 are tested), but node is not on PATH." >&2
  exit 1
fi
node_version=$(node -p 'process.versions.node')
# Open-ended floor rather than an allow-list of tested majors: Pi only requires
# >=22.19, and a closed list turns every future release line into a hard
# install failure on the day it ships.
node_supported=$(node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  const supported = major > 22 || (major === 22 && minor >= 19);
  process.exit(supported ? 0 : 1);
' && echo yes || echo no)
if [ "$node_supported" != yes ]; then
  echo "Node.js $node_version is too old; patcher-app requires Node.js 22.19 or newer (22.19, 24, and 26 are tested)." >&2
  exit 1
fi
node_bin=$(command -v node)

require_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "patcher-app installation requires npm." >&2
    exit 1
  fi
}

server_host=$(node -e '
  const url = new URL(process.argv[1]);
  process.stdout.write(url.host.replace(/[^a-zA-Z0-9.-]/gu, "-"));
' "$server_url") || {
  echo "Could not parse the server URL $server_url." >&2
  exit 1
}
service_slug=$(printf '%s' "$server_host" | tr '.' '-')

# Each server gets its own data dir and daemon instance, so one machine can
# serve several Patcher servers and a full local Patcher install keeps ~/.patcher to itself.
data_dir=${PATCHER_DATA_DIR:-"$HOME/.patcher-machines/$server_host"}
mkdir -p "$data_dir"
mkdir -p "$data_dir/logs"
canonical_data_dir=$(node -e '
  const fs = require("node:fs");
  process.stdout.write(fs.realpathSync(process.argv[1]));
' "$data_dir")
port_registry_dir="$HOME/.patcher-machines/host-daemon-ports"
mkdir -p "$port_registry_dir"

valid_port() {
  node -e '
    const rawPort = process.argv[1];
    const port = Number(rawPort);
    process.exit(String(port) === rawPort && Number.isInteger(port) && port >= 1 && port <= 65535 ? 0 : 1);
  ' "$1"
}

port_is_available() {
  node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.once("error", () => process.exit(1));
    server.listen({ host: "127.0.0.1", port: Number(process.argv[1]), exclusive: true }, () => {
      server.close((error) => process.exit(error ? 1 : 0));
    });
  ' "$1" >/dev/null 2>&1
}

daemon_status_matches() {
  node -e '
    const [port, expectedHostId, expectedServerUrl, requireConnected] = process.argv.slice(1);
    const normalize = (value) => {
      const url = new URL(String(value));
      if (url.hostname === "localhost") url.hostname = "127.0.0.1";
      return url.href.replace(/\/$/u, "");
    };
    void (async () => {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(750),
      });
      if (!response.ok) process.exit(1);
      const status = await response.json();
      const matches =
        status &&
        typeof status === "object" &&
        status.hostId === expectedHostId &&
        normalize(status.serverUrl) === normalize(expectedServerUrl) &&
        (requireConnected !== "yes" || status.connected === true);
      process.exit(matches ? 0 : 1);
    })().catch(() => process.exit(1));
  ' "$1" "$host_id" "$server_url" "$2" >/dev/null 2>&1
}

wait_for_daemon_connection() {
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if daemon_status_matches "$host_daemon_port" yes; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

reservation_owner() {
  sed -n '1p' "$port_registry_dir/$1/data-dir" 2>/dev/null || true
}

claim_port_for_data_dir() {
  claim_port=$1
  claim_data_dir=$2
  claim_dir="$port_registry_dir/$claim_port"
  if mkdir "$claim_dir" 2>/dev/null; then
    claim_owner_temp="$claim_dir/data-dir.$$.tmp"
    (umask 077 && printf '%s\n' "$claim_data_dir" >"$claim_owner_temp")
    mv "$claim_owner_temp" "$claim_dir/data-dir"
    return 0
  fi
  [ "$(reservation_owner "$claim_port")" = "$claim_data_dir" ]
}

release_port_for_data_dir() {
  release_port=$1
  release_data_dir=$2
  release_dir="$port_registry_dir/$release_port"
  if [ "$(reservation_owner "$release_port")" = "$release_data_dir" ]; then
    rm -f "$release_dir/data-dir"
    rmdir "$release_dir" 2>/dev/null || true
  fi
}

# Migrate reservations from installs created before the global registry. Each
# per-port mkdir is the allocation lock: concurrent installers cannot claim the
# same port even after its availability probe closes.
#
# The scan covers this fork's own enrollments only. A pre-rename enrollment holds
# its claim under the old machines directory, which is invisible here, so a
# stopped daemon's port can be handed out twice and both units then fight over it
# on restart. That is the cost of moving the directory, which is the point of the
# rename; the fix if it bites is to pass --host-daemon-port explicitly.
register_existing_default_ports() {
  for existing_data_dir in "$HOME/.patcher-machines"/*; do
    [ -d "$existing_data_dir" ] || continue
    existing_port_file="$existing_data_dir/host-daemon-port"
    [ -f "$existing_port_file" ] || continue
    existing_port=$(sed -n '1p' "$existing_port_file")
    valid_port "$existing_port" || continue
    existing_canonical_data_dir=$(node -e '
      const fs = require("node:fs");
      process.stdout.write(fs.realpathSync(process.argv[1]));
    ' "$existing_data_dir")
    claim_port_for_data_dir "$existing_port" "$existing_canonical_data_dir" || true
  done
}

# The scan starts above the packaged prod pair (38986/38987) so an enrolled
# daemon can never claim a port a full local Patcher install needs. The claim is
# durable — it outlives the probe — so landing on a prod port while the local
# server happens to be down would pin it permanently.
find_and_claim_available_host_daemon_port() {
  candidate_port=38988
  while [ "$candidate_port" -le 65535 ]; do
    if claim_port_for_data_dir "$candidate_port" "$canonical_data_dir"; then
      if port_is_available "$candidate_port"; then
        printf '%s\n' "$candidate_port"
        return 0
      fi
      release_port_for_data_dir "$candidate_port" "$canonical_data_dir"
    fi
    candidate_port=$((candidate_port + 1))
  done
  echo "Could not find an available host-daemon port." >&2
  return 1
}

register_existing_default_ports
host_daemon_port_file="$data_dir/host-daemon-port"
previous_host_daemon_port=
if [ -f "$host_daemon_port_file" ]; then
  previous_host_daemon_port=$(sed -n '1p' "$host_daemon_port_file")
fi
host_daemon_port=
if [ -n "$requested_host_daemon_port" ]; then
  if ! valid_port "$requested_host_daemon_port"; then
    echo "--host-daemon-port must be an integer between 1 and 65535." >&2
    exit 2
  fi
  if ! claim_port_for_data_dir "$requested_host_daemon_port" "$canonical_data_dir"; then
    echo "Host daemon local API port $requested_host_daemon_port is reserved by another Patcher enrollment." >&2
    echo "Choose another value for --host-daemon-port and rerun this command." >&2
    exit 1
  fi
  if ! port_is_available "$requested_host_daemon_port" && \
     ! daemon_status_matches "$requested_host_daemon_port" no; then
    release_port_for_data_dir "$requested_host_daemon_port" "$canonical_data_dir"
    echo "Host daemon local API port $requested_host_daemon_port is already in use." >&2
    echo "Choose another value for --host-daemon-port and rerun this command." >&2
    exit 1
  fi
  host_daemon_port=$requested_host_daemon_port
elif [ -f "$host_daemon_port_file" ]; then
  stored_host_daemon_port=$(sed -n '1p' "$host_daemon_port_file")
  if valid_port "$stored_host_daemon_port" && \
     claim_port_for_data_dir "$stored_host_daemon_port" "$canonical_data_dir" && \
     { port_is_available "$stored_host_daemon_port" || daemon_status_matches "$stored_host_daemon_port" no; }; then
    host_daemon_port=$stored_host_daemon_port
  else
    if valid_port "$stored_host_daemon_port"; then
      release_port_for_data_dir "$stored_host_daemon_port" "$canonical_data_dir"
    fi
    echo "Stored host-daemon port $stored_host_daemon_port is unavailable; assigning a new port." >&2
  fi
fi

if [ -z "$host_daemon_port" ]; then
  host_daemon_port=$(find_and_claim_available_host_daemon_port)
fi
host_daemon_port_temp="$host_daemon_port_file.$$.tmp"
(umask 077 && printf '%s\n' "$host_daemon_port" >"$host_daemon_port_temp")
mv "$host_daemon_port_temp" "$host_daemon_port_file"
if valid_port "$previous_host_daemon_port" && [ "$previous_host_daemon_port" != "$host_daemon_port" ]; then
  release_port_for_data_dir "$previous_host_daemon_port" "$canonical_data_dir"
fi
echo "Using local host-daemon port $host_daemon_port."

# The server's own build is always installed when it offers one: version
# strings cannot distinguish unpublished builds, so an existing patcher-app is
# trusted only when the server provides no package (404) or is unreachable.
package_url="${server_url%/}/install/patcher-app.tgz"
package_dir=$(mktemp -d "${TMPDIR:-/tmp}/patcher-app.XXXXXX")
package_file="$package_dir/patcher-app.tgz"
package_status=$(curl -sS -L -o "$package_file" -w '%{http_code}' "$package_url" 2>/dev/null) || package_status=000

patcher_app=
if [ "$package_status" -ge 200 ] && [ "$package_status" -lt 300 ]; then
  require_npm
  echo "Installing the server's patcher-app build..."
  if ! npm install -g "$package_file"; then
    rm -rf "$package_dir"
    echo "Could not install patcher-app globally. Fix npm global-install permissions, then rerun this command." >&2
    exit 1
  fi
elif command -v patcher-app >/dev/null 2>&1; then
  patcher_app=$(command -v patcher-app)
  if [ "$package_status" = 404 ]; then
    echo "The server does not provide its patcher-app package; using patcher-app at $patcher_app"
  else
    echo "Warning: could not download the server's patcher-app package (HTTP $package_status); using patcher-app at $patcher_app" >&2
  fi
elif [ "$package_status" = 404 ]; then
  require_npm
  echo "The server does not provide its patcher-app package; installing patcher-app from the npm registry..."
  if ! npm install -g patcher-app; then
    rm -rf "$package_dir"
    echo "Could not install patcher-app globally. Fix npm global-install permissions, then rerun this command." >&2
    exit 1
  fi
else
  rm -rf "$package_dir"
  echo "Could not download the server's patcher-app package from $package_url (HTTP $package_status)." >&2
  exit 1
fi
rm -rf "$package_dir"

if [ -z "$patcher_app" ]; then
  if ! command -v patcher-app >/dev/null 2>&1; then
    echo "npm installed patcher-app, but its global bin directory is not on PATH." >&2
    echo "Add npm's global bin directory to PATH, then rerun this command." >&2
    exit 1
  fi
  patcher_app=$(command -v patcher-app)
fi

auth_matches_host() {
  node -e '
    const fs = require("node:fs");
    const [dataDir, expectedHost] = process.argv.slice(1);
    const auth = JSON.parse(fs.readFileSync(`${dataDir}/auth.json`, "utf8"));
    process.exit(auth.hostId === expectedHost ? 0 : 1);
  ' "$data_dir" "$host_id" 2>/dev/null
}

already_joined=no
if [ -f "$data_dir/auth.json" ]; then
  if ! auth_matches_host; then
    echo "$data_dir already holds credentials for a different host, not $host_id." >&2
    echo "If this machine was removed from the server, delete $data_dir and rerun this command." >&2
    exit 1
  fi
  if [ -f "$data_dir/config.json" ] && node -e '
    const fs = require("node:fs");
    const [dataDir, expectedServer] = process.argv.slice(1);
    const config = JSON.parse(fs.readFileSync(`${dataDir}/config.json`, "utf8"));
    const normalize = (value) => String(value).replace(/\/+$/, "");
    process.exit(normalize(config.serverUrl) === normalize(expectedServer) ? 0 : 1);
  ' "$data_dir" "$server_url" 2>/dev/null; then
    already_joined=yes
    echo "This machine is already joined to $server_url as $host_id."
  fi
fi

join_pid=
if [ "$already_joined" = no ]; then
  join_log="$data_dir/install-join.log"
  echo "Joining $server_url as $host_id..."
  PATCHER_DATA_DIR="$data_dir" nohup "$patcher_app" host-daemon join \
    --auto-update \
    --host-daemon-port "$host_daemon_port" \
    --join-code "$join_code" \
    --host-id "$host_id" \
    --server-url "$server_url" >"$join_log" 2>&1 &
  join_pid=$!
  echo "$join_pid" >"$data_dir/install-daemon.pid"

  joined=no
  attempts=0
  while [ "$attempts" -lt 60 ]; do
    if [ -f "$data_dir/auth.json" ] && auth_matches_host && \
       daemon_status_matches "$host_daemon_port" yes; then
      joined=yes
      break
    fi
    if ! kill -0 "$join_pid" 2>/dev/null; then
      wait "$join_pid" || true
      echo "Patcher host daemon exited before it connected to $server_url. See $join_log" >&2
      exit 1
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  if [ "$joined" != yes ]; then
    kill "$join_pid" 2>/dev/null || true
    wait "$join_pid" 2>/dev/null || true
    echo "Timed out waiting for host daemon $host_id to connect to $server_url. See $join_log" >&2
    exit 1
  fi
  echo "Joined successfully."
fi

# Tests and source-development smoke runs can leave the enrolled daemon in the
# foreground-supervised process without modifying the user's service manager.
if [ "${PATCHER_INSTALL_SKIP_SERVICE:-0}" = 1 ]; then
  if [ -n "$join_pid" ]; then
    echo "Service installation skipped; daemon PID $join_pid is still running."
  else
    echo "Service installation skipped."
  fi
  exit 0
fi

if [ -n "$join_pid" ]; then
  kill "$join_pid" 2>/dev/null || true
  wait "$join_pid" 2>/dev/null || true
fi
rm -f "$data_dir/install-daemon.pid"

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\\\&apos;/g"
}

systemd_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/%/%%/g'
}

if [ "$platform" = darwin ]; then
  service_dir="$HOME/Library/LaunchAgents"
  service_label="app.patcher.host-daemon.$service_slug"
  service_file="$service_dir/$service_label.plist"
  mkdir -p "$service_dir"
  escaped_node_bin=$(xml_escape "$node_bin")
  escaped_patcher_app=$(xml_escape "$patcher_app")
  escaped_server=$(xml_escape "$server_url")
  escaped_data_dir=$(xml_escape "$data_dir")
  cat >"$service_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$service_label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$escaped_node_bin</string>
    <string>$escaped_patcher_app</string>
    <string>host-daemon</string>
    <string>--auto-update</string>
    <string>--host-daemon-port</string>
    <string>$host_daemon_port</string>
    <string>--server-url</string>
    <string>$escaped_server</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATCHER_DATA_DIR</key><string>$escaped_data_dir</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$escaped_data_dir/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>$escaped_data_dir/logs/launchd.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)" "$service_file" >/dev/null 2>&1 || true
  if ! launchctl_error=$(launchctl bootstrap "gui/$(id -u)" "$service_file" 2>&1); then
    echo "Could not register the Patcher host-daemon launch agent $service_label." >&2
    [ -z "$launchctl_error" ] || echo "launchctl: $launchctl_error" >&2
    exit 1
  fi
  if ! launchctl_error=$(launchctl kickstart -k "gui/$(id -u)/$service_label" 2>&1); then
    echo "The Patcher host-daemon launch agent was registered, but the daemon did not start." >&2
    [ -z "$launchctl_error" ] || echo "launchctl: $launchctl_error" >&2
    echo "See $data_dir/logs/launchd.log for the daemon error." >&2
    exit 1
  fi
  if ! wait_for_daemon_connection; then
    echo "The Patcher host-daemon launch agent started but did not connect to $server_url." >&2
    echo "See $data_dir/logs/launchd.log for the daemon error." >&2
    exit 1
  fi
  echo "Installed and started launch agent: $service_file"
  echo "Host daemon local API: http://127.0.0.1:$host_daemon_port"
  echo "Uninstall: launchctl bootout gui/$(id -u) '$service_file' && rm '$service_file'"
else
  service_dir="$HOME/.config/systemd/user"
  service_name="patcher-host-daemon-$service_slug"
  service_file="$service_dir/$service_name.service"
  mkdir -p "$service_dir"
  escaped_node_bin=$(systemd_escape "$node_bin")
  escaped_patcher_app=$(systemd_escape "$patcher_app")
  escaped_server=$(systemd_escape "$server_url")
  escaped_data_dir=$(systemd_escape "$data_dir")
  cat >"$service_file" <<EOF
[Unit]
Description=Patcher host daemon for $server_host
After=network-online.target
Wants=network-online.target

[Service]
ExecStart="$escaped_node_bin" "$escaped_patcher_app" host-daemon --auto-update --host-daemon-port "$host_daemon_port" --server-url "$escaped_server"
Environment="PATCHER_DATA_DIR=$escaped_data_dir"
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  if ! systemctl_error=$(systemctl --user enable "$service_name.service" 2>&1); then
    echo "The Patcher host-daemon systemd service could not be enabled." >&2
    [ -z "$systemctl_error" ] || echo "systemctl: $systemctl_error" >&2
    echo "Inspect it with: journalctl --user -u $service_name.service" >&2
    exit 1
  fi
  if ! systemctl_error=$(systemctl --user restart "$service_name.service" 2>&1); then
    echo "The Patcher host-daemon systemd service was enabled, but it could not be restarted." >&2
    [ -z "$systemctl_error" ] || echo "systemctl: $systemctl_error" >&2
    echo "Inspect it with: journalctl --user -u $service_name.service" >&2
    exit 1
  fi
  if ! wait_for_daemon_connection; then
    echo "The Patcher host-daemon systemd service started but did not connect to $server_url." >&2
    echo "Inspect it with: journalctl --user -u $service_name.service" >&2
    exit 1
  fi
  echo "Installed and started systemd user service: $service_file"
  echo "Host daemon local API: http://127.0.0.1:$host_daemon_port"
  echo "It starts with your systemd user session."
  echo "Uninstall: systemctl --user disable --now $service_name.service && rm '$service_file' && systemctl --user daemon-reload"
fi
