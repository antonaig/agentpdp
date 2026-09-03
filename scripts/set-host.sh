#!/usr/bin/env bash
# AgentPDP — add a real hostname to Caddy (automatic Let's Encrypt) AFTER its DNS points here.
#
#   scripts/set-host.sh pdp.aigency.ai                # DNS precheck, add host, validate, reload, wait for TLS
#   scripts/set-host.sh pdp.aigency.ai --set-origin   # ...and set PUBLIC_ORIGIN=https://pdp.aigency.ai in
#                                                     #    /opt/agentpdp/env + restart agentpdp
#   scripts/set-host.sh pdp.aigency.ai --force        # skip the DNS precheck (cert issuance will fail-loop
#                                                     #    if DNS is wrong — only if you know why)
#
# Founder step first:   A  <hostname>  ->  188.166.163.33
# The hostname lands in /etc/caddy/sites.d/<hostname>.caddy (imported by /etc/caddy/Caddyfile);
# the sslip.io hostname keeps working alongside it.
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-188.166.163.33}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/anton_mini_deploy}"
APP_DIR=/opt/agentpdp

die() { echo "ERROR: $*" >&2; exit 1; }
usage() { sed -n '2,12p' "$0" >&2; exit 2; }

NEW_HOST="${1:-}"; [[ -n "$NEW_HOST" ]] || usage
shift
SET_ORIGIN=0; FORCE=0
for a in "$@"; do
  case "$a" in
    --set-origin) SET_ORIGIN=1 ;;
    --force) FORCE=1 ;;
    *) usage ;;
  esac
done
NEW_HOST="$(tr 'A-Z' 'a-z' <<<"$NEW_HOST")"
[[ "$NEW_HOST" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "'$NEW_HOST' is not a valid hostname"
[[ -r "$DEPLOY_SSH_KEY" ]] || die "ssh key $DEPLOY_SSH_KEY not readable"
trap 'echo "SET-HOST FAILED (line $LINENO)" >&2' ERR
SSH=(ssh -i "$DEPLOY_SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 "$DEPLOY_USER@$DEPLOY_HOST")

"${SSH[@]}" bash -s -- "$NEW_HOST" "$DEPLOY_HOST" "$SET_ORIGIN" "$FORCE" "$APP_DIR" <<'REMOTE'
set -euo pipefail
NEW_HOST="$1"; DEPLOY_HOST="$2"; SET_ORIGIN="$3"; FORCE="$4"; APP_DIR="$5"
trap 'echo "REMOTE STEP FAILED at line $LINENO" >&2' ERR

echo "==> DNS precheck: $NEW_HOST"
RESOLVED="$(getent ahostsv4 "$NEW_HOST" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
if grep -qw "$DEPLOY_HOST" <<<"$RESOLVED"; then
  echo "resolves to $DEPLOY_HOST"
elif [[ "$FORCE" == 1 ]]; then
  echo "WARNING: $NEW_HOST resolves to '${RESOLVED:-nothing}' not $DEPLOY_HOST — continuing because --force" >&2
else
  echo "ERROR: $NEW_HOST resolves to '${RESOLVED:-nothing}', not $DEPLOY_HOST." >&2
  echo "       Add the record   A  $NEW_HOST  ->  $DEPLOY_HOST   wait for it to propagate, re-run." >&2
  echo "       (Adding it now would make Caddy fail-loop on certificate issuance.)" >&2
  exit 1
fi

echo "==> Caddy: /etc/caddy/sites.d/$NEW_HOST.caddy"
install -d -m 0755 /etc/caddy/sites.d
F="/etc/caddy/sites.d/$NEW_HOST.caddy"
EXISTED=0; [[ -f "$F" ]] && EXISTED=1
[[ $EXISTED == 1 ]] && cp -a "$F" "$F.bak"
printf '%s {\n\timport agentpdp\n}\n' "$NEW_HOST" > "$F.tmp"
mv -f "$F.tmp" "$F"
if ! sudo -u caddy -H caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -3; then
  echo "caddy validate FAILED — reverting $F" >&2
  if [[ $EXISTED == 1 ]]; then mv -f "$F.bak" "$F"; else rm -f "$F"; fi
  exit 1
fi
rm -f "$F.bak"
chown -R caddy:caddy /var/log/caddy
systemctl reload caddy
echo "caddy reloaded ($(systemctl is-active caddy)); hostnames: 188-166-163-33.sslip.io $(ls /etc/caddy/sites.d/*.caddy 2>/dev/null | xargs -n1 basename | sed 's/\.caddy$//' | tr '\n' ' ')"

echo "==> Waiting for TLS on https://$NEW_HOST/healthz (up to ~90s)"
ok=0
for _ in $(seq 1 30); do
  if out="$(curl -fsS --max-time 10 "https://$NEW_HOST/healthz" 2>/dev/null)"; then ok=1; echo "$out"; break; fi
  sleep 3
done
if [[ $ok != 1 ]]; then
  echo "WARNING: no valid TLS answer yet. Caddy retries ACME on its own; watch: journalctl -u caddy -f" >&2
  journalctl -u caddy -n 15 --no-pager 2>/dev/null | grep -iE 'certificate|acme|error' >&2 || true
fi

if [[ "$SET_ORIGIN" == 1 ]]; then
  echo "==> PUBLIC_ORIGIN=https://$NEW_HOST in $APP_DIR/env + restart agentpdp"
  if grep -qE '^PUBLIC_ORIGIN=' "$APP_DIR/env"; then
    sed -i "s#^PUBLIC_ORIGIN=.*#PUBLIC_ORIGIN=https://$NEW_HOST#" "$APP_DIR/env"
  else
    echo "PUBLIC_ORIGIN=https://$NEW_HOST" >> "$APP_DIR/env"
  fi
  systemctl restart agentpdp
  PORT="$(grep -E '^PORT=' "$APP_DIR/env" | tail -1 | cut -d= -f2- || true)"; PORT="${PORT:-8787}"
  for _ in $(seq 1 30); do curl -fsS --max-time 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS --max-time 2 "http://127.0.0.1:$PORT/healthz" >/dev/null || { journalctl -u agentpdp -n 30 --no-pager >&2; exit 1; }
  echo "agentpdp restarted, healthy"
else
  echo
  echo "REMINDER: PUBLIC_ORIGIN in $APP_DIR/env is still $(grep -E '^PUBLIC_ORIGIN=' "$APP_DIR/env" | cut -d= -f2-)."
  echo "          Set it to https://$NEW_HOST and 'systemctl restart agentpdp' — or re-run with --set-origin."
fi
REMOTE
