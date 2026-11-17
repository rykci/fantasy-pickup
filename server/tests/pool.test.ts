import { describe, expect, it } from 'vitest';
import { PoolUnavailableError, samplePool } from '../src/domain/pool.js';
import { seededRng } from './support/fixtures.js';

/** n player-seasons; every `perPlayer` consecutive ones belong to the same player. */
const universe = (n: number, perPlayer = 1) =>
  Array.from({ length: n }, (_, i) => ({ playerSeasonId: i + 1, playerId: 1000 + Math.floor(i / perPlayer) }));

describe('samplePool', () => {
  it('returns the requested number of distinct player-seasons from the universe', () => {
    const u = universe(500);
    const pool = samplePool(u, 24, false, seededRng(1));
    expect(pool).toHaveLength(24);
    expect(new Set(pool).size).toBe(24);
    for (const id of pool) expect(id).toBeGreaterThanOrEqual(1);
    for (const id of pool) expect(id).toBeLessThanOrEqual(500);
  });

  it('draws different pools with different rng states', () => {
    const u = universe(500);
    expect(samplePool(u, 24, false, seededRng(1))).not.toEqual(samplePool(u, 24, false, seededRng(2)));
  });

  it('can take the whole universe', () => {
    expect(samplePool(universe(10), 10, false, seededRng(3)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('allows several seasons of the same player by default', () => {
    // 20 seasons of 2 players: a pool of 10 must repeat players.
    const pool = samplePool(universe(20, 10), 10, false, seededRng(4));
    expect(pool).toHaveLength(10);
  });

  it('uniquePlayers: at most one season per player', () => {
    const u = universe(300, 5); // 60 players x 5 seasons
    for (let seed = 0; seed < 20; seed++) {
      const pool = samplePool(u, 40, true, seededRng(seed));
      const players = pool.map((id) => u[id - 1].playerId);
      expect(new Set(players).size).toBe(40);
    }
  });

  it('is roughly uniform', () => {
    const u = universe(10);
    const counts = new Array(11).fill(0);
    const rng = seededRng(9);
    for (let i = 0; i < 5000; i++) for (const id of samplePool(u, 3, false, rng)) counts[id]++;
    for (let id = 1; id <= 10; id++) expect(counts[id]).toBeGreaterThan(1300); // expected 1500
  });

  it('throws when the universe is too small', () => {
    expect(() => samplePool(universe(5), 6, false, seededRng())).toThrow(PoolUnavailableError);
    expect(() => samplePool(universe(20, 10), 3, true, seededRng())).toThrow(/2 different players/);
  });
});
