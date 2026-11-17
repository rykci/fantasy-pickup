import type { Rng } from './types.js';

/** How many player-seasons per NBA season are draftable (best by 9-cat value). */
export const UNIVERSE_TOP_N_PER_SEASON = 100;

export interface PoolCandidate {
  playerSeasonId: number;
  playerId: number;
}

export class PoolUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolUnavailableError';
  }
}

/**
 * Uniformly random sample of `size` player-seasons from the universe.
 * With uniquePlayers, at most one season per player (the first one drawn).
 * Returns player-season ids. Pure apart from the injected rng.
 */
export function samplePool(
  candidates: readonly PoolCandidate[],
  size: number,
  uniquePlayers: boolean,
  rng: Rng,
): number[] {
  const order = candidates.slice();
  const chosen: number[] = [];
  const seenPlayers = new Set<number>();
  // Lazy Fisher-Yates: shuffle only as far as needed.
  for (let i = 0; i < order.length && chosen.length < size; i++) {
    const j = i + Math.min(Math.floor(rng() * (order.length - i)), order.length - i - 1);
    [order[i], order[j]] = [order[j], order[i]];
    const c = order[i];
    if (uniquePlayers) {
      if (seenPlayers.has(c.playerId)) continue;
      seenPlayers.add(c.playerId);
    }
    chosen.push(c.playerSeasonId);
  }
  if (chosen.length < size) {
    throw new PoolUnavailableError(
      `Only ${chosen.length} ${uniquePlayers ? 'different players' : 'player-seasons'} are available; asked for ${size}.`,
    );
  }
  return chosen;
}
