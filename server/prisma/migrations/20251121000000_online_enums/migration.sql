-- Online mode. New enum values get their own migration: Postgres can't use a new enum value
-- in the same transaction that adds it.
ALTER TYPE "game_mode" ADD VALUE 'online';
ALTER TYPE "game_status" ADD VALUE 'lobby' BEFORE 'drafting';
