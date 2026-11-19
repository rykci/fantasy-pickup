-- Replace the single "hide stats" switch with three independent draft-board options.
ALTER TABLE "games" ADD COLUMN "show_season_team" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "show_game_date" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "show_averages" BOOLEAN NOT NULL DEFAULT false;

-- Existing games keep what they showed: season/team always, averages unless they were hidden.
UPDATE "games" SET "show_averages" = NOT "hide_stats";

ALTER TABLE "games" DROP COLUMN "hide_stats";
