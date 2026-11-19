-- Online games: room code, pick clock, synced start / reveal, rematch, expiry.
ALTER TABLE "games"
  ADD COLUMN "room_code" TEXT,
  ADD COLUMN "pick_seconds" INTEGER,
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "turn_started_at" TIMESTAMP(3),
  ADD COLUMN "reveal_started_at" TIMESTAMP(3),
  ADD COLUMN "rematch_game_id" INTEGER,
  ADD COLUMN "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "games_room_code_key" ON "games"("room_code");

ALTER TABLE "games" ADD CONSTRAINT "games_rematch_game_id_fkey"
  FOREIGN KEY ("rematch_game_id") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Online games (and only they) have a room code; only they use the lobby.
ALTER TABLE "games" ADD CONSTRAINT "games_online_fields"
  CHECK (("mode" = 'online') = ("room_code" IS NOT NULL)
         AND ("status" <> 'lobby' OR "mode" = 'online'));

ALTER TABLE "games" ADD CONSTRAINT "games_pick_seconds_valid"
  CHECK ("pick_seconds" IS NULL OR "pick_seconds" BETWEEN 10 AND 600);

-- One seat per team. Only a hash of each player's token is stored.
CREATE TABLE "game_seats" (
    "game_id" INTEGER NOT NULL,
    "team" "team_side" NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_seats_pkey" PRIMARY KEY ("game_id", "team"),
    CONSTRAINT "game_seats_name_length" CHECK (char_length("name") BETWEEN 1 AND 20)
);

ALTER TABLE "game_seats" ADD CONSTRAINT "game_seats_game_id_fkey"
  FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Picks only while drafting (not in the lobby, not after the draft).
CREATE OR REPLACE FUNCTION "check_pick_within_roster"() RETURNS trigger AS $$
DECLARE
  max_pick INTEGER;
  first "team_side";
  expected "team_side";
  game_status "game_status";
BEGIN
  SELECT 2 * "roster_size", "first_team", "status" INTO max_pick, first, game_status
    FROM "games" WHERE "id" = NEW."game_id";
  IF game_status <> 'drafting' THEN
    RAISE EXCEPTION 'game % is not drafting (status %)', NEW."game_id", game_status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."pick_number" > max_pick THEN
    RAISE EXCEPTION 'pick % is past the end of the draft for game % (% picks)', NEW."pick_number", NEW."game_id", max_pick
      USING ERRCODE = 'check_violation';
  END IF;
  -- Snake: the first team picks first in odd rounds and second in even rounds.
  --   first = A:  1:A 2:B | 3:B 4:A | ...   (mirrors teamForPick in server/src/domain/draft.ts)
  IF ((((NEW."pick_number" - 1) / 2) + ((NEW."pick_number" - 1) % 2)) % 2) = 0 THEN
    expected := first;
  ELSE
    expected := CASE first WHEN 'A' THEN 'B'::"team_side" ELSE 'A'::"team_side" END;
  END IF;
  IF NEW."team" <> expected THEN
    RAISE EXCEPTION 'pick % of game % belongs to team %, not %', NEW."pick_number", NEW."game_id", expected, NEW."team"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
