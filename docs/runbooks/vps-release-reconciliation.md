# VPS Release Reconciliation Runbook

## Purpose

Reconcile the AdMatix VPS checkout with GitHub `main` without touching unrelated live services.

Known audit state when this runbook was first written:

- `/opt/admatix` is clean but behind at `a330276463f092ace687bf39df7579778c9b047a`.
- GitHub `main` was `bfaefd864cf132d1f7314a312ba1111e6bdabac1`; re-query `origin/main` before every sync.
- `/opt/chappieforge-cockpit/repo` is dirty and must not be pulled, reset, or redeployed as part of AdMatix sync.
- `/opt/agentforge` has running Postgres/Redis containers, but recorded Docker Compose metadata points at a missing compose path.
- Caddy already serves `https://admatix.tech`, `https://admatix.tech/login/`, and the protected Cockpit route.

This runbook is for release-engineer execution after local and CI checks are green.

## Do Not Touch

Do not change, restart, clean, or reset:

- `/opt/chappieforge-cockpit/repo`
- `/opt/agentforge` Docker Compose state
- Caddy config, TLS certificates, `admatix.tech`, or `/login`
- `/etc/systemd/system/`, `/etc/cron.d/`, `/etc/logrotate.d/`
- Ad platform credentials or live write scopes

Do not run these during reconciliation:

```bash
git reset --hard
git clean -fd
docker compose up
docker compose down
systemctl restart caddy
scripts/install_system_files.sh
```

## Read-Only Preflight

Run on the VPS:

```bash
set -eu

date -Is
hostname
whoami

git -C /opt/admatix status --short --branch
git -C /opt/admatix rev-parse HEAD
git -C /opt/admatix rev-parse --abbrev-ref HEAD
git -C /opt/admatix remote -v
git -C /opt/admatix ls-remote origin refs/heads/main
```

Example pre-sync shape:

```text
/opt/admatix HEAD: a330276463f092ace687bf39df7579778c9b047a
origin/main: <freshly queried current main>
branch: main
working tree: clean
```

Check secrets file presence without printing values:

```bash
test -f /opt/admatix/.build/secrets.env
sed -E 's/=.*$/=<redacted>/' /opt/admatix/.build/secrets.env
```

Verify unrelated live state is still only being inspected:

```bash
git -C /opt/chappieforge-cockpit/repo status --short --branch || true
test -f /opt/agentforge/docker-compose.yml && echo "agentforge compose exists" || echo "agentforge compose missing"
systemctl is-active caddy || true
curl -fsSIL https://admatix.tech/ | head
curl -fsSIL https://admatix.tech/login/ | head
curl -fsSIL https://cockpit.76.13.118.9.sslip.io/api/v1/healthz | head || true
```

## Rollback Checkpoint

Before changing `/opt/admatix`, record the exact current state:

```bash
cd /opt/admatix

TS="$(date -u +%Y%m%dT%H%M%SZ)"
PRE_SYNC_HEAD="$(git rev-parse HEAD)"

echo "$PRE_SYNC_HEAD" > ".build/pre-sync-head-$TS.txt"
git branch "rollback/vps-admatix-pre-sync-$TS" "$PRE_SYNC_HEAD"

git status --short --branch
```

The checkpoint is valid only if:

- The working tree is clean before sync.
- The rollback branch points to the pre-sync commit.
- `.build/secrets.env` exists and was not modified.

## Safe Sync

Only sync `/opt/admatix`:

```bash
cd /opt/admatix

git fetch origin main
git pull --ff-only origin main
git rev-parse HEAD
```

Expected final HEAD:

```text
same SHA reported by git ls-remote origin refs/heads/main
```

Install and verify:

```bash
corepack enable || true
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm scan-secrets
pnpm seed-fixtures
pnpm run doctor
```

If `pnpm` is missing or shimmed incorrectly:

```bash
npm install -g pnpm@9.12.0
pnpm --version
```

## Post-Sync Health Checks

```bash
git -C /opt/admatix status --short --branch
git -C /opt/admatix rev-parse HEAD

curl -fsSIL https://admatix.tech/ | head
curl -fsSIL https://admatix.tech/artifacts | head
curl -fsSIL https://admatix.tech/login/ | head

systemctl is-active caddy || true
```

If an AdMatix-specific service exists, inspect it without restarting unrelated services:

```bash
systemctl status admatix --no-pager || true
journalctl -u admatix -n 80 --no-pager || true
```

## Rollback

Rollback only `/opt/admatix`, and only if the release-engineer has confirmed the synced checkout caused a regression:

```bash
cd /opt/admatix

git status --short --branch
git checkout main
git reset --hard "$PRE_SYNC_HEAD"

pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm run doctor
```

Only restart an AdMatix-specific service if one exists and release-engineer confirms it is part of this release:

```bash
systemctl restart admatix
systemctl status admatix --no-pager
```

Do not restart Caddy, Chappie, AgentForge, or Docker Compose as part of this rollback.
