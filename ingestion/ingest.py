#!/usr/bin/env python3
"""
Load historical NBA player box scores into Postgres (v1.1).

    python ingestion/ingest.py                         # default CSV at the repo root
    python ingestion/ingest.py --csv path/to/file.csv
    python ingestion/ingest.py --dry-run               # parse + rank, print a summary, no DB

Source: the Kaggle dataset "NBA Player Box Score Stats (1950 - 2022)" by
loganlauton (scraped from stats.nba.com with nba_api). One row per player per
regular-season game, up to 2023-04-05. It has player names but no player ids.

What gets loaded:
  * Only regular-season games from --first-season (default 1983, i.e. 1983-84)
    onward. Earlier seasons are missing STL/BLK/TOV in 20-55% of rows.
  * Only *complete* games: rows with any of the 9-cat inputs missing, or 0
    minutes, are dropped, so every locked game can be scored on all 9 categories.
  * Only *qualified* player-seasons: >= --min-games-pct of their season's
    schedule and >= --min-mpg minutes per game. Each one gets a 9-cat value
    (sum of z-scores vs. the other qualified players that season) and a rank.
    The API decides how many per season are draftable (top N by rank).

Player identity: the source has no ids, so players are keyed by name. When two
different players with the same name appear in the same game (e.g. Eddie
Johnson KCK/SAC and Eddie Johnson ATL/SEA in the mid-80s), that season's rows
are split by team and the name gets the team appended: "Eddie Johnson (SAC)".
Rows that still collide (two Charles Joneses on WAS in 1988-89) are dropped.

Idempotent: players / player-seasons are upserted; game logs are inserted with
ON CONFLICT DO NOTHING, so existing rows (possibly locked into a game) are never
modified or deleted. Re-running with different thresholds re-ranks everything:
player-seasons that no longer qualify keep their row but get season_rank NULL.

Requires the schema to exist already (run `npm run db:migrate` in /server first).
"""
import argparse
import csv
import os
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
DEFAULT_CSV = REPO_ROOT / "NBA Player Box Score Stats(1950 - 2022).csv"

# Box-score columns we need (all must be present for a game to count).
STAT_COLS = {
    "minutes": "MIN",
    "pts": "PTS",
    "reb": "REB",
    "ast": "AST",
    "stl": "STL",
    "blk": "BLK",
    "fg3m": "FG3M",
    "fgm": "FGM",
    "fga": "FGA",
    "ftm": "FTM",
    "fta": "FTA",
    "tov": "TOV",
}
STAT_KEYS = tuple(STAT_COLS)  # order used for averages / DB columns
COUNTING = ("pts", "reb", "ast", "stl", "blk", "fg3m")


# --------------------------------------------------------------------------- env

def load_dotenv(path: Path) -> None:
    """Tiny .env reader so we don't need python-dotenv."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def psycopg_dsn(prisma_url: str) -> str:
    """Prisma URLs carry ?schema=public which libpq rejects; drop the query string."""
    parts = urlsplit(prisma_url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


# ------------------------------------------------------------------------- parse

def season_start_year(game_id: str) -> int:
    """NBA game ids are 00TYYNNNNN: T = type (2 = regular season), YY = season start year."""
    yy = int(game_id[3:5])
    return 1900 + yy if yy >= 46 else 2000 + yy


def season_label(start: int) -> str:
    return f"{start}-{(start + 1) % 100:02d}"


def to_int(value: str):
    """'12', '12.0' -> 12; '' -> None."""
    value = value.strip()
    if not value:
        return None
    return int(round(float(value)))


def read_rows(csv_path: Path, first_season: int):
    """
    Returns (rows, team_games, stats) where rows are complete regular-season games:
      (season, name, team, game_id, date, opponent, is_home, *STAT_KEYS values)
    and team_games[season][team] = set of game ids (for schedule length).
    """
    rows = []
    team_games = defaultdict(lambda: defaultdict(set))
    stats = defaultdict(int)
    with csv_path.open(newline="") as f:
        for r in csv.DictReader(f):
            game_id = r["Game_ID"].strip().zfill(10)
            if game_id[2] != "2":
                stats["not_regular_season"] += 1
                continue
            start = season_start_year(game_id)
            if start < first_season:
                continue
            team = r["Team"].strip()
            team_games[start][team].add(game_id)

            values = [to_int(r[col]) for col in STAT_COLS.values()]
            if any(v is None for v in values):
                stats["dropped_incomplete"] += 1
                continue
            if values[0] <= 0:
                stats["dropped_zero_minutes"] += 1
                continue
            s = dict(zip(STAT_KEYS, values))
            if not (s["fga"] >= s["fgm"] >= s["fg3m"] and s["fta"] >= s["ftm"]):
                stats["dropped_inconsistent"] += 1  # e.g. 3PM > FGM: a bad source row
                continue

            matchup = r["MATCHUP"].strip()  # "CHI vs. BOS" (home) or "CHI @ BOS" (away)
            date = datetime.strptime(r["GAME_DATE"].strip().title(), "%b %d, %Y").date()
            rows.append(
                (start, r["PLAYER_NAME"].strip(), team, game_id, date,
                 matchup.split(" ")[-1], " vs. " in matchup, *values)
            )
    stats["complete_rows"] = len(rows)
    return rows, team_games, stats


def assign_identities(rows: list, stats: dict) -> list:
    """
    Same-name players in the same game -> split that season by team ("Name (TEAM)").
    Rows that still collide on (name, game) are dropped. Returns rows with the
    name replaced by the display name.
    """
    count = defaultdict(int)
    for row in rows:
        count[(row[1], row[3])] += 1
    colliding = {(row[0], row[1]) for row in rows if count[(row[1], row[3])] > 1}

    renamed = []
    for row in rows:
        if (row[0], row[1]) in colliding:
            row = (row[0], f"{row[1]} ({row[2]})", *row[2:])
        renamed.append(row)

    count = defaultdict(int)
    for row in renamed:
        count[(row[1], row[3])] += 1
    out = [row for row in renamed if count[(row[1], row[3])] == 1]
    stats["split_names"] = len({f"{s}:{n}" for s, n in colliding})
    stats["dropped_ambiguous"] = len(renamed) - len(out)
    return out


# ---------------------------------------------------------------------- ranking

def zscores(values: list) -> list:
    mean = statistics.fmean(values)
    sd = statistics.pstdev(values)
    return [0.0 if sd == 0 else (v - mean) / sd for v in values]


def build_player_seasons(rows: list, team_games: dict, min_games_pct: float, min_mpg: float) -> list:
    """
    Aggregates rows into player-seasons, keeps the qualified ones and ranks them
    within their season by 9-cat value:
      PTS REB AST STL BLK 3PM: z-score of the per-game average
      FG% / FT%: z-score of volume-weighted impact = makes - league% * attempts (per game)
      TO: negative z-score (fewer is better)
    """
    by_ps = defaultdict(list)
    for row in rows:
        by_ps[(row[0], row[1])].append(row)

    seasons = defaultdict(list)
    for (start, name), games in by_ps.items():
        games.sort(key=lambda g: g[4])
        n = len(games)
        avg = {k: sum(g[7 + i] for g in games) / n for i, k in enumerate(STAT_KEYS)}
        schedule = max(len(ids) for ids in team_games[start].values())
        if n < min_games_pct * schedule or avg["minutes"] < min_mpg:
            continue
        seasons[start].append({
            "season": season_label(start),
            "name": name,
            "team": games[-1][2],
            "games_played": n,
            "averages": avg,
            "games": games,
        })

    out = []
    for start in sorted(seasons):
        group = seasons[start]
        fg_lg = sum(p["averages"]["fgm"] for p in group) / sum(p["averages"]["fga"] for p in group)
        ft_lg = sum(p["averages"]["ftm"] for p in group) / sum(p["averages"]["fta"] for p in group)
        columns = [zscores([p["averages"][k] for p in group]) for k in COUNTING]
        columns.append(zscores([p["averages"]["fgm"] - fg_lg * p["averages"]["fga"] for p in group]))
        columns.append(zscores([p["averages"]["ftm"] - ft_lg * p["averages"]["fta"] for p in group]))
        columns.append([-z for z in zscores([p["averages"]["tov"] for p in group])])
        for i, p in enumerate(group):
            p["value"] = sum(col[i] for col in columns)
        group.sort(key=lambda p: p["value"], reverse=True)
        for rank, p in enumerate(group, start=1):
            p["season_rank"] = rank
        out.extend(group)
    return out


# ------------------------------------------------------------------------- load

def load_into_db(dsn: str, player_seasons: list) -> None:
    import psycopg2
    from psycopg2.extras import execute_values

    conn = psycopg2.connect(dsn)
    try:
        with conn, conn.cursor() as cur:  # one transaction: all or nothing
            cur.execute("UPDATE player_seasons SET season_rank = NULL")

            names = sorted({p["name"] for p in player_seasons})
            player_ids = dict(
                (name, pid)
                for pid, name in execute_values(
                    cur,
                    """
                    INSERT INTO players (name) VALUES %s
                    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id, name
                    """,
                    [(n,) for n in names],
                    page_size=5000,
                    fetch=True,
                )
            )

            ps_cols = ", ".join(STAT_KEYS)
            ps_updates = ", ".join(f"{k} = EXCLUDED.{k}" for k in STAT_KEYS)
            ps_ids = {}
            for ps_id, player_id, season in execute_values(
                cur,
                f"""
                INSERT INTO player_seasons
                  (player_id, season, team, games_played, {ps_cols}, value, season_rank)
                VALUES %s
                ON CONFLICT (player_id, season) DO UPDATE SET
                  team = EXCLUDED.team, games_played = EXCLUDED.games_played, {ps_updates},
                  value = EXCLUDED.value, season_rank = EXCLUDED.season_rank
                RETURNING id, player_id, season
                """,
                [
                    (player_ids[p["name"]], p["season"], p["team"], p["games_played"],
                     *(round(p["averages"][k], 3) for k in STAT_KEYS),
                     round(p["value"], 4), p["season_rank"])
                    for p in player_seasons
                ],
                page_size=5000,
                fetch=True,
            ):
                ps_ids[(player_id, season)] = ps_id

            cur.execute("SELECT count(*) FROM game_logs")
            before = cur.fetchone()[0]
            log_rows = []
            for p in player_seasons:
                ps_id = ps_ids[(player_ids[p["name"]], p["season"])]
                for g in p["games"]:
                    # g = (season, name, team, game_id, date, opponent, is_home, *stats)
                    log_rows.append((ps_id, g[3], g[4], g[2], g[5], g[6], *g[7:]))
            execute_values(
                cur,
                f"""
                INSERT INTO game_logs
                  (player_season_id, game_id, game_date, team, opponent, is_home, {ps_cols})
                VALUES %s
                ON CONFLICT (player_season_id, game_id) DO NOTHING
                """,
                log_rows,
                page_size=5000,
            )
            cur.execute("SELECT count(*) FROM game_logs")
            after = cur.fetchone()[0]
        print(
            f"Loaded {len(player_ids)} players, {len(player_seasons)} ranked player-seasons, "
            f"{after - before} new game logs ({after} total)."
        )
    finally:
        conn.close()


# ------------------------------------------------------------------------ main

def print_summary(stats: dict, player_seasons: list) -> None:
    for k, v in sorted(stats.items()):
        print(f"  {k:<24} {v:>9,}")
    by_season = defaultdict(list)
    for p in player_seasons:
        by_season[p["season"]].append(p)
    print(f"\n  {'season':<8} {'qualified':>9}  top 3 by 9-cat value")
    for season in sorted(by_season):
        group = by_season[season]
        top = ", ".join(p["name"] for p in group[:3])
        print(f"  {season:<8} {len(group):>9}  {top}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="box score CSV")
    parser.add_argument("--first-season", type=int, default=1983, help="first season start year (1983 = 1983-84)")
    parser.add_argument("--min-games-pct", type=float, default=0.5, help="min share of the season's games played")
    parser.add_argument("--min-mpg", type=float, default=20.0, help="min minutes per game")
    parser.add_argument("--dry-run", action="store_true", help="parse and rank only; don't touch the database")
    parser.add_argument("--database-url", default=None)
    args = parser.parse_args()

    if not args.csv.exists():
        sys.exit(f"CSV not found: {args.csv}")

    print(f"Reading {args.csv.name} (seasons {season_label(args.first_season)} onward) ...")
    rows, team_games, stats = read_rows(args.csv, args.first_season)
    rows = assign_identities(rows, stats)
    player_seasons = build_player_seasons(rows, team_games, args.min_games_pct, args.min_mpg)
    stats["qualified_player_seasons"] = len(player_seasons)
    stats["game_logs_to_load"] = sum(len(p["games"]) for p in player_seasons)
    print_summary(stats, player_seasons)

    if args.dry_run:
        return
    load_dotenv(REPO_ROOT / ".env")
    url = args.database_url or os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL not set (copy .env.example to .env at the repo root)")
    load_into_db(psycopg_dsn(url), player_seasons)


if __name__ == "__main__":
    main()
