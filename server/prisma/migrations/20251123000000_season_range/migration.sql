-- Season range: the pool is drawn from these seasons, by starting year (1995 = 1995-96), inclusive.
-- Existing games used every season, which the defaults record.
ALTER TABLE "games" ADD COLUMN "from_season" INTEGER NOT NULL DEFAULT 1983;
ALTER TABLE "games" ADD COLUMN "to_season" INTEGER NOT NULL DEFAULT 2022;
ALTER TABLE "games" ADD CONSTRAINT "games_season_range_valid" CHECK ("from_season" <= "to_season");
