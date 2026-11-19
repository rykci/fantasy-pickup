-- "Hide stats during the draft": only name, season and team are shown until the reveal.
-- New games default to hidden; games created before this keep showing stats as they did.
ALTER TABLE "games" ADD COLUMN "hide_stats" BOOLEAN NOT NULL DEFAULT true;
UPDATE "games" SET "hide_stats" = false;
