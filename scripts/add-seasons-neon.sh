#!/usr/bin/env bash
# Adds newer seasons (from ESPN) to the hosted database, without touching older ones.
# Run after ingestion/espn_fetch.py and a local `python ingestion/ingest.py` you're happy with.
#
#   NEON_DIRECT_URL='postgresql://…' ./scripts/add-seasons-neon.sh            # 2022-23 onward
#   NEON_DIRECT_URL='postgresql://…' FROM_SEASON=2025 ./scripts/add-seasons-neon.sh
#
# Same rules as the local load: player-seasons are upserted, game logs are only ever inserted
# (ON CONFLICT DO NOTHING), so games already played on the site keep their locked games.
# The URL is only passed to Prisma and the ingest script; it isn't printed or saved.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${NEON_DIRECT_URL:-}" ]]; then
  echo "Set NEON_DIRECT_URL to Neon's direct connection string first." >&2
  exit 1
fi
if [[ "$NEON_DIRECT_URL" == *-pooler* ]]; then
  echo "That's the pooled URL. Use the direct one (no \"-pooler\" in the host) for this step." >&2
  exit 1
fi
FROM_SEASON="${FROM_SEASON:-2022}"
PY=.venv/bin/python
[[ -x "$PY" ]] || { echo "Set up the Python venv first (README: Quick start, step 3)." >&2; exit 1; }

echo "1/2  Making sure the tables are up to date…"
(cd server && DATABASE_URL="$NEON_DIRECT_URL" npx prisma migrate deploy >/dev/null)

echo "2/2  Writing seasons from $FROM_SEASON on (a minute or two)…"
"$PY" ingestion/ingest.py --write-from-season "$FROM_SEASON" --database-url "$NEON_DIRECT_URL" | tail -1
echo "Done."
