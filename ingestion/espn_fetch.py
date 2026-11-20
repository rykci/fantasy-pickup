#!/usr/bin/env python3
"""
Fetch regular-season player box scores from ESPN's public API (for seasons the
Kaggle CSV doesn't cover: it ends 2023-04-05).

    python ingestion/espn_fetch.py                      # 2022-23 (from Apr 6, 2023) to 2025-26
    python ingestion/espn_fetch.py --seasons 2025       # just 2025-26

Writes ingestion/data/espn_box_scores.csv, which ingest.py reads alongside the
Kaggle CSV. Stdlib only.

How: for every date of each season, the scoreboard lists that day's games; each
regular-season game's summary has both teams' box scores. About 1,400 requests
a season, at 2 per second (--delay). Each game's box score is cached
(ingestion/data/espn_cache/, compact JSON), so re-running resumes where it left
off and only re-fetches the scoreboards.

What counts as a regular-season game: ESPN season type 2 and competition type
"STD". That leaves out the All-Star game ("ALLSTAR"), the NBA Cup final ("CC",
which doesn't count in regular-season stats) and the play-in (season type 5).
Cup group, quarterfinal and semifinal games are "STD" and do count, as in the
NBA's own stats.

Notes:
- Game ids are ESPN event ids prefixed with "espn-" (NBA ids aren't available here).
- Dates are the US/Eastern calendar date of tip-off, as the NBA reports them.
- ESPN's team abbreviations are mapped to the NBA's (GS -> GSW, ...).
- Players who didn't play (DNP) have no row.
"""
import argparse
import csv
import gzip
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE / "data"
CACHE_DIR = DATA_DIR / "espn_cache"
OUT_CSV = DATA_DIR / "espn_box_scores.csv"

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={day}"
SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={event}"
EASTERN = ZoneInfo("America/New_York")
# The Kaggle CSV's last day; ESPN fills 2022-23 from the day after.
KAGGLE_LAST_DAY = date(2023, 4, 5)

ESPN_TO_NBA = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS"}
NBA_TEAMS = {
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM",
    "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
}

COLUMNS = [
    "season_start", "game_id", "game_date", "espn_player_id", "player_name", "team", "opponent", "is_home",
    "minutes", "pts", "reb", "ast", "stl", "blk", "fg3m", "fgm", "fga", "ftm", "fta", "tov",
]


def team(abbr: str) -> str:
    return ESPN_TO_NBA.get(abbr, abbr)


class Fetcher:
    def __init__(self, delay: float):
        self.delay = delay
        self.last = 0.0
        self.requests = 0

    def get(self, url: str, retries: int = 4) -> dict:
        for attempt in range(retries):
            wait = self.delay - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            self.requests += 1
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "fantasy-pickup-ingest", "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    body = resp.read()
                    if resp.headers.get("Content-Encoding") == "gzip" or body[:2] == b"\x1f\x8b":
                        body = gzip.decompress(body)  # ESPN sometimes gzips even when not asked
                    return json.loads(body)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as e:
                if attempt == retries - 1:
                    raise
                print(f"    retrying after {type(e).__name__}: {e}", file=sys.stderr)
                time.sleep(2 * (attempt + 1))
        raise RuntimeError("unreachable")


def season_days(start: int):
    """Every date that can hold a regular-season game of the season starting in `start`."""
    first = KAGGLE_LAST_DAY + timedelta(days=1) if start == 2022 else date(start, 10, 1)
    last = date(start + 1, 4, 30)
    d = first
    while d <= last:
        yield d
        d += timedelta(days=1)


def regular_season_events(scoreboard: dict) -> list:
    out = []
    for e in scoreboard.get("events", []):
        comp = e["competitions"][0]
        if e.get("season", {}).get("type") != 2 or comp.get("type", {}).get("abbreviation") != "STD":
            continue
        if not comp.get("status", {}).get("type", {}).get("completed"):
            continue
        if {team(c["team"]["abbreviation"]) for c in comp["competitors"]} - NBA_TEAMS:
            continue
        out.append(e["id"])
    return out


def compact_box_score(event_id: str, summary: dict) -> dict:
    """Just what we need from a game summary: date, teams, and each player's line."""
    comp = summary["header"]["competitions"][0]
    tipoff = datetime.fromisoformat(comp["date"].replace("Z", "+00:00"))
    sides = {c["team"]["abbreviation"]: c["homeAway"] for c in comp["competitors"]}
    players = []
    for side in summary["boxscore"]["players"]:
        abbr = side["team"]["abbreviation"]
        stats = side["statistics"][0]
        names = stats["names"]
        for a in stats["athletes"]:
            if a.get("didNotPlay") or not a.get("stats") or "id" not in a.get("athlete", {}):
                continue  # DNPs, and placeholder rows ESPN sometimes adds without a player id
            players.append({
                "id": a["athlete"]["id"],
                "name": a["athlete"]["displayName"],
                "team": abbr,
                "stats": dict(zip(names, a["stats"])),
            })
    return {
        "id": event_id,
        "date": tipoff.astimezone(EASTERN).date().isoformat(),
        "sides": sides,
        "players": players,
    }


def made_attempted(value: str):
    made, att = value.split("-")
    return int(made), int(att)


def rows_for(game: dict, season_start: int, stats: dict) -> list:
    teams = list(game["sides"])
    rows = []
    for p in game["players"]:
        s = p["stats"]
        try:
            fgm, fga = made_attempted(s["FG"])
            fg3m, _ = made_attempted(s["3PT"])
            ftm, fta = made_attempted(s["FT"])
            line = {k: int(s[c]) for k, c in
                    (("minutes", "MIN"), ("pts", "PTS"), ("reb", "REB"), ("ast", "AST"),
                     ("stl", "STL"), ("blk", "BLK"), ("tov", "TO"))}
        except (KeyError, ValueError):
            stats["skipped_unreadable"] += 1  # e.g. "--" for a player who checked in for no time
            continue
        opponent = next(t for t in teams if t != p["team"])
        rows.append({
            "season_start": season_start,
            "game_id": f"espn-{game['id']}",
            "game_date": game["date"],
            "espn_player_id": p["id"],
            "player_name": p["name"],
            "team": team(p["team"]),
            "opponent": team(opponent),
            "is_home": int(game["sides"][p["team"]] == "home"),
            **line, "fg3m": fg3m, "fgm": fgm, "fga": fga, "ftm": ftm, "fta": fta,
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seasons", type=int, nargs="+", default=[2022, 2023, 2024, 2025],
                        help="season start years (2025 = 2025-26); 2022 means only after the Kaggle CSV ends")
    parser.add_argument("--delay", type=float, default=0.5, help="seconds between requests")
    args = parser.parse_args()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fetch = Fetcher(args.delay)
    all_rows = []
    stats = {"skipped_unreadable": 0}
    for start in args.seasons:
        label = f"{start}-{(start + 1) % 100:02d}"
        events = []
        seen = set()
        for day in season_days(start):
            for event_id in regular_season_events(fetch.get(SCOREBOARD.format(day=day.strftime("%Y%m%d")))):
                if event_id not in seen:  # a postponed game can show on two dates
                    seen.add(event_id)
                    events.append(event_id)
        print(f"{label}: {len(events)} regular-season games")
        for i, event_id in enumerate(events, 1):
            cached = CACHE_DIR / f"{event_id}.json"
            if cached.exists():
                game = json.loads(cached.read_text())
            else:
                game = compact_box_score(event_id, fetch.get(SUMMARY.format(event=event_id)))
                cached.write_text(json.dumps(game, separators=(",", ":")))
            all_rows.extend(rows_for(game, start, stats))
            if i % 100 == 0:
                print(f"  {i}/{len(events)} box scores ({fetch.requests} requests so far)")

    DATA_DIR.mkdir(exist_ok=True)
    with OUT_CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(all_rows)
    print(f"Wrote {len(all_rows):,} player rows to {OUT_CSV.relative_to(HERE.parent)} "
          f"({fetch.requests:,} requests; {stats['skipped_unreadable']} unreadable rows skipped).")


if __name__ == "__main__":
    main()
