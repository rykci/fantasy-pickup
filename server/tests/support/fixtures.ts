import { STAT_KEYS, type LockedLine, type PoolPlayer, type Rng, type StatLine } from '../../src/domain/types.js';

/** Deterministic PRNG (mulberry32) so tests are reproducible. */
export function seededRng(seed = 42): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stat line; anything not given is 0. */
export function line(stats: Partial<StatLine> = {}): StatLine {
  return { ...(Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as StatLine), ...stats };
}

export interface UniverseOptions {
  /** Consecutive player-seasons that belong to the same player (default 1 = all different players). */
  seasonsPerPlayer?: number;
}

/**
 * `size` player-seasons (ids 100, 101, ...) whose 9-cat value strictly decreases
 * with the index (only PTS differs), each with 10 complete game logs.
 */
export function makeUniverse(size = 24, { seasonsPerPlayer = 1 }: UniverseOptions = {}) {
  const players: PoolPlayer[] = [];
  const logs: LockedLine[] = [];
  let logId = 1000;
  for (let i = 0; i < size; i++) {
    const id = 100 + i;
    players.push({
      id,
      playerId: 5000 + Math.floor(i / seasonsPerPlayer),
      name: `Player ${i + 1}`,
      season: `${1990 + (i % 30)}-${String((91 + (i % 30)) % 100).padStart(2, '0')}`,
      team: 'TST',
      averages: {
        gamesPlayed: 10,
        minutes: 34,
        ...line({ pts: 30 - i, reb: 8, ast: 5, stl: 1, blk: 0.5, fg3m: 2, fgm: 9, fga: 19, ftm: 4, fta: 5, tov: 2 }),
      },
    });
    for (let g = 0; g < 10; g++) {
      logs.push({
        playerSeasonId: id,
        gameLogId: logId++,
        gameId: `G${id}-${g}`,
        gameDate: `1995-01-${String(g + 1).padStart(2, '0')}`,
        team: 'TST',
        opponent: 'OPP',
        isHome: g % 2 === 0,
        minutes: 34,
        ...line({
          pts: 20 + g,
          reb: 5 + (g % 4),
          ast: 3 + (g % 5),
          stl: g % 3,
          blk: g % 2,
          fg3m: g % 4,
          fgm: 7 + (g % 4),
          fga: 15 + (g % 3),
          ftm: 3 + (g % 2),
          fta: 4 + (g % 2),
          tov: 1 + (g % 3),
        }),
      });
    }
  }
  return { players, logs };
}
