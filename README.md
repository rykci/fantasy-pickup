# 🏀 Fantasy Pickup Basketball

A one-off fantasy draft game. Two teams snake-draft from a random pool of real **NBA player-seasons from
1983-84 to 2022-23** (e.g. "1986-87 Michael Jordan"). When the game is created, every player-season in the pool
is secretly locked to **one random real game** from that season. Season averages guide the draft, but only the
locked games decide the result, scored head to head across **9 fantasy categories**.

Play **solo vs the CPU**, **pass-and-play** on one screen, or **online with a friend** on your own devices.

**Stack:** React + TypeScript + Vite · Node + TypeScript + Express + Prisma · PostgreSQL (Docker Compose locally,
Neon when hosted) · Python ingestion · hosted on Vercel (see [Deploying](#deploying-vercel--neon))

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
npm test           # 100 unit tests — no database needed
npm run test:db    # 14 integration tests against the docker Postgres (needs migrate + ingest)
```

---

## How to play a full game

1. **Home** — choose **Solo vs CPU**, **Online with a friend** (see [Online play](#online-play)) or
   **Pass-and-play**, optionally open **Game settings** (collapsed by default;
   its summary line shows the current choices), then **Start Game**:

   | Setting | Default | Range |
   |---|---|---|
   | Team size (= rounds) | 5 | 1–13 |
   | Pool size | 15 | 2 × team size – 200 |
   | One season per player | on | off: the pool may hold 1988 Jordan *and* 1996 Jordan |
   | Seasons | all (1983-84 to 2022-23) | any From/To range, or a preset: All · 80s · 90s · 2000s · 2010s+ |
   | **What you see while drafting** | | anything off is hidden until the reveal |
   | ↳ Season & team | off | off: just the player's name |
   | ↳ Chosen game date & opponent | off | on: a clue such as "Dec 25, 1996 vs BOS" (that game's stats stay secret) |
   | ↳ Season averages | off | on: all 9 categories plus VAL |

   At this moment the server draws the pool at random from the **top 100 player-seasons of every season in the range**
   (see [Data](#data)) and locks one random game from that season for each. Locked games are never shown or
   changed until the reveal. It also flips a coin for the first pick.
2. **Coin flip** — opening the draft plays the flip: a coin with each side's name spins and lands on the winner, who
   picks first. (The server already flipped it when the game was created; this plays it back. Shown once per game.)
3. **Draft** — the banner shows whose turn it is, the round and pick number. The strip under it shows the full
   snake order, starting with the flip winner: `A B · B A · A B · …` or `B A · A B · B A · …`.
   - Sort any column, search by name, team or season (e.g. `1996`).
   - **Ball knowledge:** the board shows only what the settings allow (default: just the name). Hidden
     fields aren't sent by the server at all until the reveal, so they can't be found in dev tools. Without
     averages the board is alphabetical, and same-name entries are in a per-game shuffled order, so the order
     doesn't give away the ranking or the season. The CPU always drafts by VAL.
   - **Season averages (if shown):** all 9 categories plus **VAL**, each player-season's 9-cat value *relative to
     this pool* (sum of z-scores; 0 = pool average).
   - **vs CPU:** you are Team A. If the CPU wins the flip, it has already made pick 1 when the draft opens. It picks
     as soon as it's on the clock, twice in a row when the snake order gives it two picks.
   - **2-Player:** after each pick the banner tells you to pass the device.
   - **Sound and motion:** each pick drops into its roster slot with a flash and a sound (a heavier one for your
     side, a lighter one for the other), the CPU's double picks land one after another, and the end of the draft
     plays a "rosters locked" sound. Online, a chime and a "🏀 Your pick!" tab title tell you it's your turn, and the
     last 5 seconds of your pick clock tick. 🔊 in the banner mutes everything (shared with the reveal).
4. After the last pick, click **Reveal the games →**.
5. **The reveal** happens on the results page itself. Both box scores start blank, and it goes round by round: each
   team's 1st pick rolls together, then each team's 2nd pick, and so on, so the scoreboard stays balanced. Both
   chosen games spin through dates and opponents from that season and land, then both players' stats fill in left
   to right, the same stat at the same time, with a sound for each. Team totals and a live 9-category scoreboard
   (pinned at the top) update as they land. If the last round decides something (final margin of 2 or less, or a
   lead change), its stats land more slowly and a "Final round" note shows the score going into it. When the last
   stat lands, the final result appears: a big banner with the score, the headline and all 9 category cards.
   - Plays on its own; every landed stat stays on screen. **Skip to result »** jumps to the end.
   - Sound effects are generated in the browser (Web Audio); toggle them with **Sound on/off**. The setting is
     remembered.
   - The games were all chosen before the draft. The roll only plays them back.
   - Once watched, a refresh goes straight to the results (remembered in this browser). **↺ Replay reveal** plays it
     again.
6. **Results** — each player's locked game (date, opponent, minutes, full line; green/red = well above/below their
   season average), team totals per category with the winner highlighted, and the final score, e.g. **5–4**.
   Below the teams, an **Undrafted** table shows every player nobody picked with their chosen game too (best
   season first), so you can see who you missed. They don't count for either team.
   - **⬇ Download image:** a PNG box score (score, 9 categories, both teams' chosen games).
   - **Copy as text:** the score, both rosters and each team's best line, for group chats.

The URL tracks the game (`?game=12`), so refreshing mid-draft keeps your place.

### Online play

1. **Create:** pick **Online with a friend**, enter your name, choose a **pick clock** (off, 30, 60 or 90 seconds)
   and any settings, then **Create game**. You get a **room code** (e.g. `KX7P`) and an invite link
   (`/?join=KX7P`) to send.
2. **Join:** your friend opens the link (or types the code under **Join a friend's game**) and enters a name.
   Both players show up in the lobby with a green dot while connected.
3. **Start:** the host presses **Start the game**. The coin flip plays on both screens at the same moment, then the
   draft opens. You can only pick on your turn; the other player's picks appear within about a second, with a
   note ("Sam drafted 1996-97 Gary Payton").
4. **Pick clock:** when it runs out, the best available player is picked for you (the CPU's logic). If someone
   leaves, the game waits for them; with a clock on, their picks keep being made automatically.
5. **Reveal:** when the last pick is in, both players go to the results and the reveal starts at the same moment
   on both screens (joining late picks up where it is). The headline is from your side: "You win!" or "Sam wins".
6. **Rematch:** either player clicks **Rematch**; the other gets a pop-up, "Ricky wants a rematch", with
   **Accept** or **Decline**. When both say yes, the new game starts right away (same players and settings, a new
   pool and a new coin flip; no lobby). After a no, asking again shows the pop-up again. Going **Home** counts as no.

How it works:
- **No accounts.** Creating or joining gives your browser a random seat token (kept per tab and per browser, so
  reopening the link puts you back in your seat). The server stores only its SHA-256 hash, and every pick checks
  that the token holds the team on the clock. Switching devices mid-game isn't supported.
- **No always-on server.** On Vercel the API runs as short-lived functions, so there are no WebSockets: each player's
  browser asks for the game state about once a second (every 4 s while the tab is hidden). The pick clock is
  enforced whenever anyone asks: every overdue turn is filled in, each new clock starting at the previous deadline.
- **Synced moments.** The server stores timestamps (coin flip, first turn, reveal start) and every response carries
  the server's time, so each browser schedules them on its own clock and both screens line up.
- **Expiry.** Lobby or drafting games with no join, start or pick for 24 hours expire.

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
| `POST` | `/api/games` | `{ "mode": "vs_cpu" \| "pass_and_play", "poolSize"?: 15, "rosterSize"?: 5, "uniquePlayers"?: true, "fromSeason"?: 1983, "toSeason"?: 2022, "showSeasonTeam"?: false, "showGameDate"?: false, "showAverages"?: false }` | Draws the pool, locks a random game for each player-season. Returns the game state. |
| `GET` | `/api/games/:id` | — | `serverNow`; for online games `online` (room code, `you`, seats with names and connected flags, pick clock, `flipAt`, `turnStartedAt`, `turnDeadline`, `revealStartedAt`, `rematch` (each player's answer: `true`/`false`/`null`), `rematchGameId`, `expired`). Status, settings, `firstTeam` (the coin-flip winner), current turn, draft order, rosters, available player-seasons (`season`/`team`, `gameClue`, `averages`/`value` are `null` unless the settings show them; all shown after the reveal), and picks. **Never includes locked games.** |
| `POST` | `/api/games/:id/picks` | `{ "playerSeasonId": 1234, "team"?: "A" \| "B" }` | Validates the turn, that the player-season is available and in the pool, and that the draft isn't finished. In `vs_cpu`, `team` defaults to `A` and the CPU's picks are returned in `autoPicks`. Online: needs your token, and only works on your turn. |
| `POST` | `/api/online/games` | `{ "name": "Ricky", "pickSeconds"?: 30 \| 60 \| 90 \| null, …settings }` | Creates an online game in the lobby. Returns `{ gameId, token, team: "A", state }`: keep the token, it's your seat. |
| `POST` | `/api/online/join` | `{ "code": "KX7P", "name": "Sam" }` | Takes Team B. `404` unknown code, `409` full or already started, `410` expired. Returns `{ gameId, token, team: "B", state }`. |
| `POST` | `/api/games/:id/start` | — (host's token) | Host only, once Team B has joined. Schedules the coin flip and the first turn. |
| `POST` | `/api/games/:id/rematch` | `{ accept? }` (default `true`; a player's token) | After an online game: your answer to "rematch?". Yes after the other's no asks them again. When both said yes, a new game starts at once (same players and settings, new pool and flip). Returns `{ gameId }`: the new game, or `null` until both agree. |
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
| `games` | `id`, `mode` (`vs_cpu`, `pass_and_play`, `online`), `status` (`lobby` (online only) → `drafting → draft_complete → revealed`), `pool_size`, `roster_size`, `unique_players`, `from_season`, `to_season` (starting years, 1995 = 1995-96), `show_season_team`, `show_game_date`, `show_averages`, `first_team` (coin flip), `winner`, `score_a`, `score_b`, timestamps · online: `room_code` (unique), `pick_seconds`, `started_at`, `turn_started_at`, `reveal_started_at`, `rematch_game_id`, `last_activity_at` |
| `game_seats` | PK `(game_id, team)`, `name` (1–20 chars), `token_hash` (SHA-256 of the seat token), `joined_at`, `last_seen_at`, `rematch` (answer after a finished game: `true`/`false`/`NULL`) |
| `game_players` | PK `(game_id, player_season_id)`, `locked_game_log_id` |
| `draft_picks` | `id`, `game_id`, `team`, `pick_number`, `player_season_id`, `picked_at` · unique `(game_id, pick_number)` and `(game_id, player_season_id)` |

Integrity is enforced in Postgres as well as in the app (`server/prisma/migrations/*/migration.sql`):

- **Online games:** only online games have a room code and use the lobby (`CHECK`), one seat per team (PK), and
  picks are only accepted while the game is `drafting` (pick trigger).
- **Locked games can't change.** A `BEFORE UPDATE` trigger on `game_players` rejects any change to
  `locked_game_log_id`. A second trigger rejects edits to a `game_logs` row once it's locked into any game.
- **A locked log belongs to its player-season.** Composite FK `(locked_game_log_id, player_season_id) → game_logs(id, player_season_id)`.
- **Valid settings.** `CHECK`: `roster_size` 1–13, `2 × roster_size ≤ pool_size ≤ 200`, `from_season ≤ to_season`.
- **Snake order lives in the schema.** A trigger checks each pick's `team` against `pick_number` and the game's
  `first_team`, and rejects `pick_number` beyond `2 × roster_size`. Another trigger stops `first_team` changing
  once picks exist.
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

Seasons **1983-84 to 2025-26**, from two sources:

- **Up to Apr 5, 2023:** the Kaggle dataset
  [NBA Player Box Score Data](https://www.kaggle.com/datasets/loganlauton/nba-player-box-score-data) by loganlauton
  (scraped from stats.nba.com with `nba_api`): one row per player per regular-season game, Oct 1946 – Apr 5, 2023.
  Download it and put `NBA Player Box Score Stats(1950 - 2022).csv` at the repo root (or pass `--csv`). It's
  ~160 MB, so it isn't checked in.
- **After that:** ESPN's public API, via `ingestion/espn_fetch.py` (stdlib only, ~35 min the first time). For each
  day it reads the scoreboard, then each regular-season game's box score, at 2 requests a second. Box scores are
  cached in `ingestion/data/` (git-ignored), so re-runs resume. It writes `ingestion/data/espn_box_scores.csv`,
  which `ingest.py` reads automatically.
  - Regular season = ESPN season type 2 and game type `STD`: no All-Star game, no NBA Cup final (it doesn't count in
    regular-season stats), no play-in. Cup group games, quarterfinals and semifinals count, as in the NBA's stats.
  - stats.nba.com itself doesn't respond from many home networks, which is why ESPN is used for the newer seasons.
  - ESPN players are matched to the existing players by name, ignoring accents, punctuation and Jr./III, preferring
    an exact match (so KJ Martin doesn't merge with his father). Nicknames are in `ESPN_ALIASES` in `ingest.py`; the
    script lists ESPN players it couldn't match so new aliases are easy to spot.

```bash
python3 ingestion/espn_fetch.py            # 2022-23 (from Apr 6, 2023) to 2025-26; --seasons 2026 for a later one
python ingestion/ingest.py                  # Kaggle + ESPN into the local database
```

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

- **2026-27 isn't loaded** while it's in progress (partial-season averages and ranks would keep moving). Once it
  ends: `python3 ingestion/espn_fetch.py --seasons 2026`, re-run `ingest.py`, and raise `SEASONS.last` in
  `server/src/domain/draft.ts` and `client/src/api.ts`.
- ESPN's API is unofficial: it could change without notice. The cache keeps what's already been fetched.
- **Player identity is by name** (the source has no player ids):
  - Different players with the same name *in the same season* are split by team: "Eddie Johnson (KCK)" vs
    "Eddie Johnson (ATL)". Rows that still collide (two Charles Joneses on WAS, 1988-89) are dropped.
  - Fathers and sons with the same name across eras (Gerald Henderson, Mike Dunleavy, Patrick Ewing) count as one
    person. This only matters for the "one season per player" setting.
- A traded player's team in a game is the team they played for in their chosen game. (`player_seasons.team` stores
  the team of their last game that season, but the app doesn't show it.)

`ingestion/tools/build_seed_from_espn.py`, `ingestion/players.csv` and `ingestion/seed/` are the v1 (2024-25, 24
players) data, unused since v1.1.

---

## Deploying (Vercel + Neon)

The free demo setup: Vercel serves the React app and runs the Express API as a Vercel Function
(`api/index.js` → `server/src/vercel.ts`); the database is Postgres on Neon's free tier (0.5 GB; the data is
~126 MB). `vercel.json` holds the install, build and routing settings. Every push to `main` redeploys.

1. **Neon:** create a project at [neon.tech](https://neon.tech) (Postgres 16 or 17). From **Connect**, copy two
   connection strings: the **pooled** one (host contains `-pooler`) and the **direct** one (untick
   "Connection pooling").
2. **Load the data** (once, from this machine, with the local Docker database running):
   ```bash
   NEON_DIRECT_URL='postgresql://…direct…' ./scripts/load-neon.sh
   ```
   It creates the tables (`prisma migrate deploy`) and copies players, player-seasons and game logs. Later schema
   changes: `cd server && DATABASE_URL='…direct…' npx prisma migrate deploy`.
   **Adding seasons later** (after `espn_fetch.py` and a local `ingest.py`): this writes only 2022-23 onward and never
   changes or removes a game log, so games already played keep their chosen games:
   ```bash
   NEON_DIRECT_URL='postgresql://…direct…' ./scripts/add-seasons-neon.sh      # FROM_SEASON=2026 for just one season
   ```
3. **Vercel:** **Add New → Project**, import the GitHub repo, keep the root directory, and add one environment
   variable before deploying:
   - `DATABASE_URL` = the **pooled** Neon string with `&pgbouncer=true&connect_timeout=15` added to the end.

   Deploy. The site is at `https://<project>.vercel.app`; `/api/health` should return `{"ok":true}`.

Free-tier notes: Neon pauses the database when idle, so the first request after a quiet spell takes about a second
longer. Vercel's Hobby plan is for non-commercial use, which suits a demo with friends.

---

## Scope (v1.4)

No accounts, matchmaking with strangers, spectators, chat, trades or bench.

The UI calls each player-season's secret game its **chosen game**; the code and schema call it the *locked* game.

**v1.2:** the box-score reveal (pick by pick, stat by stat), sound, and share as image / text.
**v1.3:** online with a friend (room codes and invite links, pick clock, synced coin flip and reveal, rematch),
hosted on Vercel + Neon.
**v1.4:** season range setting, rematch by invitation (accept / decline, starts straight away), illustrated
"How it works" (also in the lobby for invited friends), seasons through 2025-26 from ESPN.
**Before a public launch:** hosting for real load (a WebSocket server or a push service instead of polling, a paid
database), more players, matchmaking, accounts.
**Later:** draft signposts / category badges, tiered pool sampling, a "Legends" mode, UI polish.
