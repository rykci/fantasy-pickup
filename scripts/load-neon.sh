#!/usr/bin/env bash
# One-time setup of the hosted database: creates the tables on Neon and copies the player data
# (players, player_seasons, game_logs, ~126 MB) from your local Docker database.
#
#   NEON_DIRECT_URL='postgresql://…' ./scripts/load-neon.sh
#
# Use Neon's *direct* connection string (the host without "-pooler"). The URL is only passed
# to Prisma and psql; it isn't printed or saved.
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

echo "1/3  Creating tables on Neon…"
(cd server && DATABASE_URL="$NEON_DIRECT_URL" npx prisma migrate deploy)

existing=$(docker exec -i -e URL="$NEON_DIRECT_URL" fantasy-pickup-db sh -c 'psql "$URL" -tAc "select count(*) from game_logs"')
if [[ "$existing" != "0" ]]; then
  echo "Neon already has $existing game logs. Nothing copied." >&2
  exit 0
fi

echo "2/3  Copying players, player-seasons and game logs (a few minutes)…"
docker exec fantasy-pickup-db pg_dump -U fantasy -d fantasy_pickup --data-only \
    -t players -t player_seasons -t game_logs \
  | docker exec -i -e URL="$NEON_DIRECT_URL" fantasy-pickup-db sh -c 'psql "$URL" -q -v ON_ERROR_STOP=1' >/dev/null

echo "3/3  Checking…"
docker exec -i -e URL="$NEON_DIRECT_URL" fantasy-pickup-db sh -c \
  'psql "$URL" -tAc "select (select count(*) from players) || '"'"' players, '"'"' || (select count(*) from player_seasons) || '"'"' player-seasons, '"'"' || (select count(*) from game_logs) || '"'"' game logs'"'"'"'
echo "Done."
