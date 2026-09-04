# AgentPDP — Deploy

Single DigitalOcean droplet (`agentpdp-1`, Ubuntu 24.04, `188.166.163.33`). Caddy terminates TLS and reverse-proxies to the Node app on `127.0.0.1:8787`, which serves the API and the built SPA. Everything here runs from the mini over `ssh -i ~/.ssh/anton_mini_deploy root@188.166.163.33`.

**Live:** https://188-166-163-33.sslip.io (sslip.io = public wildcard DNS for the IP; Let's Encrypt cert issued automatically)

## Commands (run from the repo root on the mini)

| What | Command |
|---|---|
| Deploy current working tree | `scripts/deploy.sh` (`SKIP_INSTALL=1` skips the local `npm ci`; `SKIP_BUILD=1` ships the existing `dist/` as-is — escape hatch only) |
| Roll back to the previous release | `scripts/rollback.sh` (or `scripts/rollback.sh <releaseName>`) |
| One-time / repair server setup (idempotent) | `scripts/server-setup.sh` |
| Add a real hostname | `scripts/set-host.sh <hostname> [--set-origin]` |
| Tail app logs | `ssh -i ~/.ssh/anton_mini_deploy root@188.166.163.33 journalctl -u agentpdp -f` |
| Tail Caddy (TLS/ACME) logs | `ssh -i ~/.ssh/anton_mini_deploy root@188.166.163.33 journalctl -u caddy -f` |
| Access log (JSON) | `ssh ... tail -f /var/log/caddy/agentpdp-access.log` |
| Service status | `ssh ... systemctl status agentpdp caddy` |

`deploy.sh` does: `npm ci && npm run build` locally → rsync `dist/ package.json package-lock.json` to `/opt/agentpdp/releases/<UTC ts>/` → `npm ci --omit=dev` there → `chown -R agentpdp` → atomic switch of the `/opt/agentpdp/current` symlink → `systemctl restart agentpdp` → waits up to 30 s for `http://127.0.0.1:8787/healthz` → keeps the last 3 releases → checks the public `/healthz`. On a failed health check it prints `systemctl status` + the last 50 journal lines and exits non-zero; the previous release stays on disk — run `scripts/rollback.sh`.

`rollback.sh` switches `current` to the newest release older than the current one (or the named one), restarts, health-checks.

## Giving it a real hostname (founder + one command)

1. Founder adds a DNS record at the registrar/DNS provider:

   ```
   A  <hostname>  →  188.166.163.33        e.g.  A  pdp.aigency.ai  →  188.166.163.33
   ```

2. Once it resolves (`dig +short <hostname>` shows the IP), from the mini:

   ```
   scripts/set-host.sh <hostname> --set-origin
   ```

   This checks DNS from the droplet (refuses if it does not point at us — a hostname without DNS would make Caddy fail-loop on certificate issuance), writes `/etc/caddy/sites.d/<hostname>.caddy`, runs `caddy validate`, reloads Caddy, waits for the Let's Encrypt cert, and with `--set-origin` also rewrites `PUBLIC_ORIGIN=https://<hostname>` in `/opt/agentpdp/env` and restarts the app. The sslip.io hostname keeps working alongside.

   Without `--set-origin`: **`PUBLIC_ORIGIN` in `/opt/agentpdp/env` must be updated by hand whenever the hostname changes, then `systemctl restart agentpdp`** — the app uses it in links it hands to agents.

## Environment (`/opt/agentpdp/env`, mode 600, owner `agentpdp`)

Written once from `infra/env.template` by `server-setup.sh`; never overwritten. Edit on the server, then `systemctl restart agentpdp`. Keys:

- `PORT` — app listen port (Caddy proxies to it; 8787)
- `PUBLIC_ORIGIN` — public origin used in links returned to agents
- `HEADLESS_FALLBACK` — enable the headless-Chromium extraction fallback (1)
- `PLAYWRIGHT_BROWSERS_PATH` — where `server-setup.sh` installed Chromium (`/opt/agentpdp/pw-browsers`)
- `GROQ_MODEL` — model for `ask_about_product`
- `GROQ_API_KEY` — **empty by default; filled in by hand on the server**. Never in the repo.

## Layout on the droplet

```
/opt/agentpdp/
  current -> releases/<ts>      # what systemd runs (WorkingDirectory; app resolves ./dist/web from cwd)
  releases/<UTC ts>/            # dist/, package*.json, node_modules (prod only); last 3 kept
  shared/                       # HOME of the agentpdp user (npm + Chromium caches)
  pw-browsers/                  # Playwright 1.52 Chromium for the extractor fallback
  env                           # runtime env (see above)
/etc/systemd/system/agentpdp.service   # from infra/agentpdp.service
/etc/caddy/Caddyfile                   # from infra/Caddyfile (sslip.io host + `agentpdp` snippet)
/etc/caddy/sites.d/<hostname>.caddy    # written by scripts/set-host.sh
/var/log/caddy/agentpdp-access.log     # JSON access log, rolled at 50 MiB, 5 kept
/root/agentpdp-infra/                  # rsync'd copy of infra/ used by server-setup.sh
```

Service: runs as the dedicated system user `agentpdp` (nologin), `Restart=always`, `RestartSec=2`, `LimitNOFILE=65536`, journald logging, hardened (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict` with `ReadWritePaths=/opt/agentpdp`, kernel/cgroup/hostname protections). Deliberately not set: `MemoryDenyWriteExecute` (kills the V8 JIT) and `RestrictNamespaces` (headless Chromium). Playwright launches Chromium with `--no-sandbox` by default, so `NoNewPrivileges` is safe.

Caddy: `encode zstd gzip`, HSTS, `nosniff`, `X-Frame-Options: DENY` (the demo is not meant to be framed; relax to `SAMEORIGIN` if a merchant embed is ever wanted), `Referrer-Policy`, `Permissions-Policy`, `Server` header stripped. No CSP yet — the SPA ships inline assets; add later if wanted.

## Playwright version pin

`server-setup.sh` installs the Chromium build for **playwright 1.52** (`PW_VERSION` env to override). If `package.json` bumps `playwright`/`@playwright/test` to a new minor, re-run `PW_VERSION=<x.y> scripts/server-setup.sh` so the binaries match, otherwise the fallback fails with "Executable doesn't exist".

## Troubleshooting

- `npm run build` fails on type errors in files you do not own → the deploy is blocked by design. If the emitted JS in `dist/` still runs (`PORT=8799 node dist/server/server/index.js` + `curl localhost:8799/healthz`), `SKIP_BUILD=1 scripts/deploy.sh` ships it; get the owners to fix the types.
- Runtime `import("playwright")` fails on the droplet → `playwright` must be in `dependencies` (not only `@playwright/test` in devDependencies); the release is installed with `npm ci --omit=dev`.

- `deploy.sh` fails at preflight → `scripts/server-setup.sh` has not been run on this droplet.
- Health check fails → output already contains the journal tail. Common cause: the server throws on boot; fix, redeploy, or `scripts/rollback.sh`.
- Public `/healthz` warns but local is fine → Caddy/TLS: `journalctl -u caddy -n 50`. First cert issuance takes ~5–20 s after the first reload.
- `caddy validate` after a manual edit: `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, then `systemctl reload caddy`.
- Never point a hostname at Caddy before its DNS resolves to `188.166.163.33`.
- The app binds `*:8787` (Hono default); only ufw (22/80/443 allowed, default deny) keeps it off the internet. Do not open 8787 in ufw.
