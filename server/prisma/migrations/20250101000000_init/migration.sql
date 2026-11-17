-- CreateEnum
CREATE TYPE "game_mode" AS ENUM ('vs_cpu', 'pass_and_play');

-- CreateEnum
CREATE TYPE "game_status" AS ENUM ('drafting', 'draft_complete', 'revealed');

-- CreateEnum
CREATE TYPE "team_side" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "game_winner" AS ENUM ('A', 'B', 'draw');

-- CreateTable
CREATE TABLE "players" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "position" TEXT NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_season_averages" (
    "player_id" INTEGER NOT NULL,
    "season" TEXT NOT NULL DEFAULT '2024-25',
    "games_played" INTEGER NOT NULL,
    "pts" DOUBLE PRECISION NOT NULL,
    "reb" DOUBLE PRECISION NOT NULL,
    "ast" DOUBLE PRECISION NOT NULL,
    "stl" DOUBLE PRECISION NOT NULL,
    "blk" DOUBLE PRECISION NOT NULL,
    "fg3m" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "player_season_averages_pkey" PRIMARY KEY ("player_id")
);

-- CreateTable
CREATE TABLE "game_logs" (
    "id" SERIAL NOT NULL,
    "player_id" INTEGER NOT NULL,
    "game_id" TEXT NOT NULL,
    "game_date" DATE NOT NULL,
    "team" TEXT NOT NULL,
    "opponent" TEXT NOT NULL,
    "is_home" BOOLEAN NOT NULL,
    "minutes" INTEGER NOT NULL,
    "pts" INTEGER NOT NULL,
    "reb" INTEGER NOT NULL,
    "ast" INTEGER NOT NULL,
    "stl" INTEGER NOT NULL,
    "blk" INTEGER NOT NULL,
    "fg3m" INTEGER NOT NULL,

    CONSTRAINT "game_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" SERIAL NOT NULL,
    "mode" "game_mode" NOT NULL,
    "status" "game_status" NOT NULL DEFAULT 'drafting',
    "winner" "game_winner",
    "score_a" INTEGER,
    "score_b" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealed_at" TIMESTAMP(3),

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_players" (
    "game_id" INTEGER NOT NULL,
    "player_id" INTEGER NOT NULL,
    "locked_game_log_id" INTEGER NOT NULL,

    CONSTRAINT "game_players_pkey" PRIMARY KEY ("game_id","player_id")
);

-- CreateTable
CREATE TABLE "draft_picks" (
    "id" SERIAL NOT NULL,
    "game_id" INTEGER NOT NULL,
    "team" "team_side" NOT NULL,
    "pick_number" INTEGER NOT NULL,
    "player_id" INTEGER NOT NULL,
    "picked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_picks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_logs_player_id_game_date_key" ON "game_logs"("player_id", "game_date");

-- CreateIndex
CREATE UNIQUE INDEX "game_logs_id_player_id_key" ON "game_logs"("id", "player_id");

-- CreateIndex
CREATE INDEX "games_created_at_idx" ON "games"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "draft_picks_game_id_pick_number_key" ON "draft_picks"("game_id", "pick_number");

-- CreateIndex
CREATE UNIQUE INDEX "draft_picks_game_id_player_id_key" ON "draft_picks"("game_id", "player_id");

-- AddForeignKey
ALTER TABLE "player_season_averages" ADD CONSTRAINT "player_season_averages_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_logs" ADD CONSTRAINT "game_logs_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_locked_game_log_id_player_id_fkey" FOREIGN KEY ("locked_game_log_id", "player_id") REFERENCES "game_logs"("id", "player_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_game_id_player_id_fkey" FOREIGN KEY ("game_id", "player_id") REFERENCES "game_players"("game_id", "player_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants (Prisma can't express these in schema.prisma)
-- ---------------------------------------------------------------------------

-- A draft has exactly 10 picks.
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_pick_number_range"
  CHECK ("pick_number" BETWEEN 1 AND 10);

-- Snake order, enforced by the database as defence in depth:
--   round r = (pick-1)/2 (0-based), slot s = (pick-1)%2
--   Team A picks when (r + s) is even  ->  A B | B A | A B | B A | A B
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_snake_order"
  CHECK (((((("pick_number" - 1) / 2) + (("pick_number" - 1) % 2)) % 2) = 0) = ("team" = 'A'));

-- Box-score stats are non-negative.
ALTER TABLE "game_logs" ADD CONSTRAINT "game_logs_stats_non_negative"
  CHECK ("minutes" >= 0 AND "pts" >= 0 AND "reb" >= 0 AND "ast" >= 0
         AND "stl" >= 0 AND "blk" >= 0 AND "fg3m" >= 0);

-- Lookup: "which logs are locked into games" (used by the trigger below).
CREATE INDEX "game_players_locked_game_log_id_idx" ON "game_players"("locked_game_log_id");

-- The locked game for a player in a game is chosen once, at game creation,
-- and can never be changed afterwards.
CREATE FUNCTION "forbid_locked_game_change"() RETURNS trigger AS $$
BEGIN
  IF NEW."locked_game_log_id" IS DISTINCT FROM OLD."locked_game_log_id"
     OR NEW."player_id" IS DISTINCT FROM OLD."player_id"
     OR NEW."game_id" IS DISTINCT FROM OLD."game_id" THEN
    RAISE EXCEPTION 'locked game for player % in game % is immutable', OLD."player_id", OLD."game_id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "game_players_lock_immutable"
  BEFORE UPDATE ON "game_players"
  FOR EACH ROW EXECUTE FUNCTION "forbid_locked_game_change"();

-- A game log that has been locked into any game can't have its stats edited either.
CREATE FUNCTION "forbid_locked_log_edit"() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*)
     AND EXISTS (SELECT 1 FROM "game_players" WHERE "locked_game_log_id" = OLD."id") THEN
    RAISE EXCEPTION 'game log % is locked into a game and is immutable', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "game_logs_locked_immutable"
  BEFORE UPDATE ON "game_logs"
  FOR EACH ROW EXECUTE FUNCTION "forbid_locked_log_edit"();
