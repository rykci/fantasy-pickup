#!/usr/bin/env python3
"""
Rebuild the checked-in fallback seed CSVs from ESPN's public game-log JSON.

Why this exists: stats.nba.com (what nba_api talks to) frequently times out or
blocks non-browser / cloud traffic. ingest.py tries nba_api first and falls back
to the CSVs in ../seed/. This script is how those CSVs were produced: they
contain every real 2024-25 regular-season game each of the 24 players played.

You normally never need to run this. Usage:
    python ingestion/tools/build_seed_from_espn.py

Notes:
- game_id values in the seed are ESPN event ids prefixed with "espn-" (NBA game
  ids are not available from this source). Logs are de-duplicated on
  (player_id, game_date), so mixing sources never creates duplicates.
- Dates are converted from UTC tip-off to US/Eastern calendar dates, matching
  how the NBA reports game dates.
- Uses only the Python standard library.
"""
import csv
import json
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
INGESTION_DIR = HERE.parent
SEED_DIR = INGESTION_DIR / "seed"
MANIFEST = INGESTION_DIR / "players.csv"

GAMELOG_URL = (
    "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/"
    "athletes/{espn_id}/gamelog?season=2025"
)
EASTERN = ZoneInfo("America/New_York")

# ESPN uses a few non-standard team abbreviations.
ESPN_TO_NBA_ABBR = {
    "GS": "GSW",
    "NY": "NYK",
    "SA": "SAS",
    "NO": "NOP",
    "UTAH": "UTA",
    "WSH": "WAS",
}


def nba_abbr(espn_abbr: str) -> str:
    return ESPN_TO_NBA_ABBR.get(espn_abbr, espn_abbr)


def fetch_json(url: str, retries: int = 3) -> dict:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fantasy-pickup-seed-builder"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.load(resp)
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last}")


def counts_as_regular_season(meta: dict) -> bool:
    """ESPN's "Regular Season" bucket also contains games the NBA does not count
    toward regular-season stats: All-Star weekend games and the NBA Cup final."""
    if meta.get("team", {}).get("isAllStar") or meta.get("opponent", {}).get("isAllStar"):
        return False
    note = (meta.get("eventNote") or "").lower()
    if "all-star" in note or "nba cup championship" in note:
        return False
    return True


def regular_season_rows(nba_id: int, espn_id: str) -> list:
    data = fetch_json(GAMELOG_URL.format(espn_id=espn_id))
    names = data["names"]
    idx = {name: i for i, name in enumerate(names)}
    events_meta = data["events"]

    rows = []
    for season_type in data["seasonTypes"]:
        if season_type.get("displayName") != "2024-25 Regular Season":
            continue
        for category in season_type.get("categories", []):
            for ev in category.get("events", []):
                meta = events_meta[ev["eventId"]]
                if not counts_as_regular_season(meta):
                    continue
                stats = ev["stats"]
                minutes = int(float(stats[idx["minutes"]] or 0))
                if minutes <= 0:
                    continue  # DNP
                tipoff = datetime.fromisoformat(meta["gameDate"].replace("Z", "+00:00"))
                game_date = tipoff.astimezone(EASTERN).date().isoformat()
                fg3m = int(stats[idx["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]].split("-")[0])
                rows.append(
                    {
                        "player_id": nba_id,
                        "game_id": f"espn-{ev['eventId']}",
                        "game_date": game_date,
                        "team": nba_abbr(meta["team"]["abbreviation"]),
                        "opponent": nba_abbr(meta["opponent"]["abbreviation"]),
                        "is_home": "1" if meta.get("atVs") == "vs" else "0",
                        "minutes": minutes,
                        "pts": int(stats[idx["points"]]),
                        "reb": int(stats[idx["totalRebounds"]]),
                        "ast": int(stats[idx["assists"]]),
                        "stl": int(stats[idx["steals"]]),
                        "blk": int(stats[idx["blocks"]]),
                        "fg3m": fg3m,
                    }
                )
    rows.sort(key=lambda r: r["game_date"])
    return rows


def main() -> None:
    with MANIFEST.open() as f:
        players = list(csv.DictReader(f))

    all_logs = []
    averages = []
    for p in players:
        nba_id = int(p["nba_id"])
        logs = regular_season_rows(nba_id, p["espn_id"])
        if not logs:
            raise SystemExit(f"{p['name']}: no 2024-25 regular-season games found")
        if len(logs) < 20:
            # e.g. Joel Embiid only played 19 games in 2024-25. Keep the real data.
            print(f"note: {p['name']} only played {len(logs)} regular-season games")
        n = len(logs)
        averages.append(
            {
                "player_id": nba_id,
                "team": logs[-1]["team"],  # team at end of regular season
                "games_played": n,
                **{k: round(sum(r[k] for r in logs) / n, 2) for k in ("pts", "reb", "ast", "stl", "blk", "fg3m")},
            }
        )
        all_logs.extend(logs)
        print(f"{p['name']:<28} {n:>3} games  last team {logs[-1]['team']}")
        time.sleep(0.3)

    SEED_DIR.mkdir(exist_ok=True)
    log_fields = ["player_id", "game_id", "game_date", "team", "opponent", "is_home", "minutes",
                  "pts", "reb", "ast", "stl", "blk", "fg3m"]
    with (SEED_DIR / "game_logs_2024_25.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=log_fields)
        w.writeheader()
        w.writerows(all_logs)

    avg_fields = ["player_id", "team", "games_played", "pts", "reb", "ast", "stl", "blk", "fg3m"]
    with (SEED_DIR / "season_averages_2024_25.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=avg_fields)
        w.writeheader()
        w.writerows(averages)

    print(f"\nWrote {len(all_logs)} game logs for {len(players)} players to {SEED_DIR}")


if __name__ == "__main__":
    main()
