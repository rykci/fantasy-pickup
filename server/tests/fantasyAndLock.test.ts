import { describe, expect, it } from 'vitest';
import { cpuChoosePlayer, cpuRandomizes, poolValues } from '../src/domain/fantasy.js';
import { lockRandomGames } from '../src/domain/lock.js';
import type { PoolPlayer, StatLine } from '../src/domain/types.js';
import { line, makeUniverse, seededRng } from './support/fixtures.js';

const avg = { pts: 20, reb: 6, ast: 4, stl: 1, blk: 0.5, fg3m: 1.5, fgm: 8, fga: 17, ftm: 3, fta: 4, tov: 2 };
const p = (id: number, stats: Partial<StatLine> = {}): PoolPlayer => ({
  id,
  playerId: id,
  name: `P${id}`,
  season: '1995-96',
  team: 'T',
  averages: { gamesPlayed: 70, minutes: 34, ...line({ ...avg, ...stats }) },
});

describe('poolValues (9-cat value relative to the pool)', () => {
  it('sums to ~0 across the pool and ranks better players higher', () => {
    const { players } = makeUniverse(10);
    const v = poolValues(players);
    expect([...v.values()].reduce((s, x) => s + x, 0)).toBeCloseTo(0);
    const ids = players.map((x) => x.id);
    for (let i = 1; i < ids.length; i++) expect(v.get(ids[i - 1])!).toBeGreaterThan(v.get(ids[i])!);
  });

  it('rewards fewer turnovers and better shooting on volume', () => {
    const v = poolValues([p(1), p(2, { tov: 4 }), p(3, { fgm: 10 })]);
    expect(v.get(2)!).toBeLessThan(v.get(1)!);
    expect(v.get(3)!).toBeGreaterThan(v.get(1)!);
  });

  it('is 0 for everyone when nobody differs, and handles a pool of one', () => {
    expect([...poolValues([p(1), p(2)]).values()]).toEqual([0, 0]);
    expect(poolValues([p(1)]).get(1)).toBe(0);
    expect(poolValues([]).size).toBe(0);
  });
});

describe('cpuChoosePlayer', () => {
  const close = [p(1), p(2), p(3), p(4)];
  const values = new Map([
    [1, 3],
    [2, 2.8],
    [3, 2.6],
    [4, -5],
  ]);

  it('randomizes only after the first 60% of rounds (rounded up)', () => {
    expect([1, 2, 3, 4, 5].map((r) => cpuRandomizes(r, 5))).toEqual([false, false, false, true, true]);
    expect(cpuRandomizes(1, 1)).toBe(false);
    expect([7, 8].map((r) => cpuRandomizes(r, 13))).toEqual([false, false]);
    expect(cpuRandomizes(9, 13)).toBe(true);
  });

  it('takes the best value in greedy rounds regardless of rng', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const round of [1, 2, 3]) expect(cpuChoosePlayer(close, values, round, 5, seededRng(seed)).id).toBe(1);
    }
  });

  it('adds some randomness among close players in late rounds, never a clearly worse one', () => {
    const chosen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) chosen.add(cpuChoosePlayer(close, values, 5, 5, seededRng(seed)).id);
    expect(chosen.size).toBeGreaterThan(1);
    expect(chosen.has(4)).toBe(false);
  });
});

describe('lockRandomGames', () => {
  it('locks exactly one of each player-season’s own game logs', () => {
    const locks = lockRandomGames(
      [
        { playerSeasonId: 1, gameLogIds: [10, 11, 12] },
        { playerSeasonId: 2, gameLogIds: [20] },
      ],
      seededRng(7),
    );
    expect(locks).toHaveLength(2);
    expect([10, 11, 12]).toContain(locks[0].lockedGameLogId);
    expect(locks[1]).toEqual({ playerSeasonId: 2, lockedGameLogId: 20 });
  });

  it('handles rng edge values', () => {
    const one = [{ playerSeasonId: 1, gameLogIds: [5, 6] }];
    expect(lockRandomGames(one, () => 0)[0].lockedGameLogId).toBe(5);
    expect(lockRandomGames(one, () => 0.999999)[0].lockedGameLogId).toBe(6);
  });

  it('throws if a player-season has no logs', () => {
    expect(() => lockRandomGames([{ playerSeasonId: 1, gameLogIds: [] }], Math.random)).toThrow();
  });
});
