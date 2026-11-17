import type { LockRecord, Rng } from './types.js';

export interface PlayerSeasonLogIds {
  playerSeasonId: number;
  gameLogIds: readonly number[];
}

/**
 * Pick one random game log per player-season, uniformly. Called exactly once,
 * when a game is created; the result is persisted and never recomputed.
 */
export function lockRandomGames(players: readonly PlayerSeasonLogIds[], rng: Rng): LockRecord[] {
  return players.map(({ playerSeasonId, gameLogIds }) => {
    if (gameLogIds.length === 0) {
      throw new Error(`Player-season ${playerSeasonId} has no game logs to lock`);
    }
    const index = Math.min(Math.floor(rng() * gameLogIds.length), gameLogIds.length - 1);
    return { playerSeasonId, lockedGameLogId: gameLogIds[index] };
  });
}
