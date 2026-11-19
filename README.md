# 🏀 Fantasy Pickup Basketball

A one-off fantasy draft game. Two teams snake-draft from a random pool of real **NBA player-seasons from
1983-84 to 2022-23** (e.g. "1986-87 Michael Jordan"). When the game is created, every player-season in the pool
is secretly locked to **one random real game** from that season. Season averages guide the draft, but only the
locked games decide the result, scored head to head across **9 fantasy categories**.

**Stack:** React + TypeScript + Vite · Node + TypeScript + Express + Prisma · PostgreSQL (Docker Compose) · Python ingestion

---

## Quick start

Prereqs: **Docker**, **Node 20+**, **Python 3.9+**, and the box-score CSV (see [Data](#data)) at the repo root.

```bash
# 0. Config
cp .env.example .env

# 1. Database
docker compose up -d                  # Postgres 16 on localhost:5432

# 2. Server deps + schema
cd server
npm install
npm run db:migrate                    # applies prisma/migrations
cd ..

# 3. Load the player-seasons and game logs (~30 s)
python3 -m venv .venv
source .venv/bin/activate
pip install -r ingestion/requirements.txt
python ingestion/ingest.py            # --dry-run to preview without touching the DB

# 4. Run (two terminals)
cd server && npm run dev              # API  -> http://localhost:4000
cd client && npm install && npm run dev   # UI -> http://localhost:5173
```

Open **http://localhost:5173**.

> Upgrading from v1: `npm run db:migrate` applies the v1.1 migration, which **removes all v1 data** (the 24-player
> 2024-25 seed and any v1 games: they have no FGM/FGA/FTM/FTA/TOV). Then run step 3.

### Tests

```bash
cd server
npm test           # 77 unit tests — no database needed
npm run test:db    # 11 integration tests against the docker Postgres (needs migrate + ingest)
```

---

## How to play a full game

1. **Home** — choose **Solo vs CPU** or **2-Player**, optionally open **Game settings** (collapsed by default;
   its summary line shows the current choices), then **Start Game**:

   | Setting | Default | Range |
   |---|---|---|
   | Team size (= rounds) | 5 | 1–13 |
   | Pool size | 15 | 2 × team size – 200 |
   | One season per player | off | off: the pool may hold 1988 Jordan *and* 1996 Jordan |
   | **What you see while drafting** | | anything off is hidden until the reveal |
   | ↳ Season & team | on | off: just the player's name |
   | ↳ Chosen game date & opponent | off | on: a clue such as "Dec 25, 1996 vs BOS" (that game's stats stay secret) |
   | ↳ Season averages | off | on: all 9 categories plus VAL |

   At this moment the server draws the pool at random from the **top 100 player-seasons of every season**
   (see [Data](#data)) and locks one random game from that season for each. Locked games are never shown or
   changed until the reveal.
2. **Draft** — the banner shows whose turn it is, the round and pick number. The strip under it shows the full
   snake order: `A B · B A · A B · …`.
   - Sort any column, search by name, team or season (e.g. `1996`).
   - **Ball knowledge:** the board shows only what the settings allow (default: name, season, team). Hidden
     fields aren't sent by the server at all until the reveal, so they can't be found in dev tools. Without
     averages the board is alphabetical, and same-name entries are in a per-game shuffled order, so the order
     doesn't give away the ranking or the season. The CPU always drafts by VAL.
   - **Season averages (if shown):** all 9 categories plus **VAL**, each player-season's 9-cat value *relative to
     this pool* (sum of z-scores; 0 = pool average).
   - **vs CPU:** you are Team A and pick first. The CPU picks right after you, twice in a row when the snake order
     gives it two picks.
   - **2-Player:** after each pick the banner tells you to pass the device.
3. After the last pick, click **Reveal the games →**.
4. **Results** — each player's locked game (date, opponent, minutes, full line; green/red = well above/below their
   season average), team totals per category with the winner highlighted, and the final score, e.g. **5–4**.
   Below the teams, an **Undrafted** table shows every player nobody picked with their chosen game too (best
   season first), so you can see who you missed. They don't count for either team.

The URL tracks the game (`?game=12`), so refreshing mid-draft keeps your place.

### Scoring rules (9-cat)

| Category | Team value | Winner |
|---|---|---|
| PTS, REB, AST, STL, BLK, 3PM | total | higher |
| FG% | team FGM ÷ team FGA | higher |
| FT% | team FTM ÷ team FTA | higher |
| TO | total turnovers | **lower** |

- Equal values are a tie, and nobody gets the point. Percentages are compared exactly (no rounding).
- A team with **no attempts** has no FG%/FT% and loses that category (if neither team has any, it's a tie).
- The team that wins **more categories** wins the game.
- If category wins are level, **total PTS** breaks the tie. If PTS are level too, it's a **draw**.

**VAL (draft screen):** for each category, a z-score against the other player-seasons in this pool, from season
averages: PTS REB AST STL BLK 3PM directly; FG% and FT% as volume-weighted impact
(`makes − pool% × attempts` per game); TO negated. VAL is the sum. The **CPU** uses it too: best available VAL for
the first 60% of rounds (rounded up), then VAL ± up to 1.0 of random noise so its late picks are less predictable.

---

## API

All JSON. The draft rules are enforced on the server, so the UI cannot bypass them.

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/api/games` | `{ "mode": "vs_cpu" \| "pass_and_play", "poolSize"?: 15, "rosterSize"?: 5, "uniquePlayers"?: false, "showSeasonTeam"?: true, "showGameDate"?: false, "showAverages"?: false }` | Draws the pool, locks a random game for each player-season. Returns the game state. |
| `GET` | `/api/games/:id` | — | Status, settings, current turn, draft order, rosters, available player-seasons (`season`/`team`, `gameClue`, `averages`/`value` are `null` unless the settings show them; all shown after the reveal), and picks. **Never includes locked games.** |
| `POST` | `/api/games/:id/picks` | `{ "playerSeasonId": 1234, "team"?: "A" \| "B" }` | Validates the turn, that the player-season is available and in the pool, and that the draft isn't finished. In `vs_cpu`, `team` defaults to `A` and the CPU's picks are returned in `autoPicks`. |
| `POST` | `/api/games/:id/reveal` | — | `409` until the last pick. Returns locked lines, team totals, category winners, score, winner, `decidedBy`, and `undrafted` (every pool player nobody picked, with their locked game). Idempotent. |

Errors look like `{ "error": { "code": "NOT_YOUR_TURN", "message": "..." } }`.
Codes: `VALIDATION_ERROR` / `INVALID_SETTINGS` / `POOL_TOO_LARGE` / `PLAYER_NOT_IN_POOL` (400), `NOT_FOUND` (404),
`NOT_YOUR_TURN` / `PLAYER_ALREADY_DRAFTED` / `DRAFT_COMPLETE` / `DRAFT_NOT_COMPLETE` (409), `POOL_NOT_SEEDED` (503).

```bash
curl -s -X POST localhost:4000/api/games -H 'content-type: application/json' -d '{"mode":"vs_cpu","rosterSize":8,"poolSize":30}'
curl -s -X POST localhost:4000/api/games/1/picks -H 'content-type: application/json' -d '{"playerSeasonId":1234}'
curl -s -X POST localhost:4000/api/games/1/reveal
```

---

## Database design

```
players ──< player_seasons ──< game_logs           (one row per complete game of a qualified player-season)
                  │
                  └──< game_players >── games       (the pool for a game + its LOCKED game log)
                             └──< draft_picks       (composite FK: you can only draft from that game's pool)
```

| Table | Key columns |
|---|---|
| `players` | `id`, `name` (unique; see identity notes below) |
| `player_seasons` | `id`, `player_id`, `season` ("1986-87"), `team`, `games_played`, per-game `minutes pts reb ast stl blk fg3m fgm fga ftm fta tov`, `value`, `season_rank` · unique `(player_id, season)` |
| `game_logs` | `id`, `player_season_id`, `game_id`, `game_date`, `team`, `opponent`, `is_home`, `minutes`, the 11 box-score stats · unique `(player_season_id, game_id)` |
| `games` | `id`, `mode`, `status` (`drafting → draft_complete → revealed`), `pool_size`, `roster_size`, `unique_players`, `show_season_team`, `show_game_date`, `show_averages`, `winner`, `score_a`, `score_b`, timestamps |
| `game_players` | PK `(game_id, player_season_id)`, `locked_game_log_id` |
| `draft_picks` | `id`, `game_id`, `team`, `pick_number`, `player_season_id`, `picked_at` · unique `(game_id, pick_number)` and `(game_id, player_season_id)` |

Integrity is enforced in Postgres as well as in the app (`server/prisma/migrations/*/migration.sql`):

- **Locked games can't change.** A `BEFORE UPDATE` trigger on `game_players` rejects any change to
  `locked_game_log_id`. A second trigger rejects edits to a `game_logs` row once it's locked into any game.
- **A locked log belongs to its player-season.** Composite FK `(locked_game_log_id, player_season_id) → game_logs(id, player_season_id)`.
- **Valid settings.** `CHECK`: `roster_size` 1–13, `2 × roster_size ≤ pool_size ≤ 200`.
- **Snake order lives in the schema.** A `CHECK` ties `team` to `pick_number`; a trigger rejects `pick_number`
  beyond `2 × roster_size` for that game.
- **Box scores are consistent.** `CHECK`: all stats ≥ 0, `FGA ≥ FGM ≥ 3PM`, `FTA ≥ FTM`.
- **No double drafting:** unique `(game_id, player_season_id)`, and each pick must come from that game's pool.
- **Concurrency:** each pick runs in a transaction that holds `SELECT … FOR UPDATE` on the game row, so two
  simultaneous requests can't both take the same slot. This is covered by a test.

Code layout (server):

```
src/domain/      pure logic: draft order + settings, pool sampling, 9-cat scoring, VAL + CPU, random lock
src/services/    GameService: orchestrates a game over a GameRepository
src/repo/        GameRepository interface + Prisma implementation
src/app.ts       Express routes, zod validation, error mapping
tests/           unit tests (in-memory repository) + *.db.test.ts integration tests
```

---

## Data

**Source:** the Kaggle dataset
[NBA Player Box Score Data](https://www.kaggle.com/datasets/loganlauton/nba-player-box-score-data) by loganlauton
(scraped from stats.nba.com with `nba_api`): one row per player per regular-season game, Oct 1946 – **Apr 5, 2023**.
Download it and put `NBA Player Box Score Stats(1950 - 2022).csv` at the repo root (or pass `--csv`). It's ~160 MB,
so it isn't checked in.

`ingestion/ingest.py` (stdlib + `psycopg2`, ~30 s):

1. **Seasons 1983-84 onward** (`--first-season`). The season comes from the `Game_ID`; the CSV's `Season` column is the
   calendar year. Before 1983-84, 23–56% of rows are missing STL, BLK or TOV.
2. **Complete games only.** Rows missing any 9-cat input, with 0 minutes, or internally inconsistent (e.g. 3PM > FGM)
   are dropped, so every locked game can be scored on all 9 categories.
3. **Qualified player-seasons only:** ≥ 50% of that season's games (`--min-games-pct`; a share, so lockout and COVID
   seasons work) and ≥ 20 MPG (`--min-mpg`). About 150–235 per season, 8,048 in total, with ~570k game logs.
4. **Ranked within the season** by 9-cat value (sum of z-scores vs. the other qualified players that season; FG%/FT%
   volume-weighted, TO negated). The API draws pools from the **top 100 per season**
   (`UNIVERSE_TOP_N_PER_SEASON` in `server/src/domain/pool.ts`), about 4,000 player-seasons. Changing that number
   needs no re-ingest.

**Idempotent:** players and player-seasons are upserted, game logs use `ON CONFLICT DO NOTHING`, so re-running never
modifies a log that might be locked into a game. Re-running with different thresholds re-ranks everything;
player-seasons that no longer qualify keep their row with `season_rank = NULL`.

Spot checks: Jordan 1986-87 → 82 GP, 37.1 PPG; Jordan 1995-96 → 30.4; Curry 2015-16 → 79 GP, 30.1 (all match the
official numbers).

### Known limitations

- **No 2023-24 or 2024-25**, and the last 4 days of 2022-23 are missing (the source ends 2023-04-05). Filling the gap
  is a separate task.
- **Player identity is by name** (the source has no player ids):
  - Different players with the same name *in the same season* are split by team: "Eddie Johnson (KCK)" vs
    "Eddie Johnson (ATL)". Rows that still collide (two Charles Joneses on WAS, 1988-89) are dropped.
  - Fathers and sons with the same name across eras (Gerald Henderson, Mike Dunleavy, Patrick Ewing) count as one
    person. This only matters for the "one season per player" setting.
- A traded player's `team` is the team of their last game that season. The locked game shows the actual team.

`ingestion/tools/build_seed_from_espn.py`, `ingestion/players.csv` and `ingestion/seed/` are the v1 (2024-25, ESPN)
data. They are unused by v1.1 and kept as a starting point for filling 2023-25.

---

## Scope (v1.1)

No auth, accounts, online multiplayer, trades or bench.

The UI calls each player-season's secret game its **chosen game**; the code and schema call it the *locked* game.

**Next version:** a more suspenseful locked-game reveal (today it's a basic fade-in).
**Later:** draft signposts / category badges, tiered pool sampling, a "Legends" mode, era filters, UI polish.
