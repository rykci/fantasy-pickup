-- Rematch: each player's answer after a finished online game.
-- true = wants a rematch, false = said no (or left), NULL = hasn't answered.
ALTER TABLE "game_seats" ADD COLUMN "rematch" BOOLEAN;
