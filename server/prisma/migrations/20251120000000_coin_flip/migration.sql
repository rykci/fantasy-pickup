-- Coin flip: either team can pick first. Existing games keep Team A first.
ALTER TABLE "games" ADD COLUMN "first_team" "team_side" NOT NULL DEFAULT 'A';

-- The snake order now depends on the game's first_team, so the fixed CHECK becomes part of the pick trigger.
ALTER TABLE "draft_picks" DROP CONSTRAINT "draft_picks_snake_order";

CREATE OR REPLACE FUNCTION "check_pick_within_roster"() RETURNS trigger AS $$
DECLARE
  max_pick INTEGER;
  first "team_side";
  expected "team_side";
BEGIN
  SELECT 2 * "roster_size", "first_team" INTO max_pick, first FROM "games" WHERE "id" = NEW."game_id";
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

-- The coin flip can't change once the draft has started.
CREATE FUNCTION "forbid_first_team_change"() RETURNS trigger AS $$
BEGIN
  IF NEW."first_team" <> OLD."first_team" AND EXISTS (SELECT 1 FROM "draft_picks" WHERE "game_id" = OLD."id") THEN
    RAISE EXCEPTION 'first_team of game % is fixed once picks exist', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "games_first_team_fixed"
  BEFORE UPDATE OF "first_team" ON "games"
  FOR EACH ROW EXECUTE FUNCTION "forbid_first_team_change"();
