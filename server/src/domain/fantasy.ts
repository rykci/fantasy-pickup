import type { PoolPlayer, Rng, SeasonAverages } from './types.js';

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const COUNTING = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m'] as const;

function zscores(values: number[]): number[] {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return values.map((v) => (sd === 0 ? 0 : (v - mean) / sd));
}

/**
 * 9-cat value of each player-season *relative to this pool*: the sum of z-scores
 * across the pool for PTS REB AST STL BLK 3PM, volume-weighted FG% and FT%
 * (makes - pool% x attempts) and negative TO. 0 = an average player in this pool.
 * Season averages only; the locked games play no part. Keyed by player-season id.
 */
export function poolValues(players: readonly PoolPlayer[]): Map<number, number> {
  const out = new Map<number, number>();
  if (players.length === 0) return out;
  const avgs: SeasonAverages[] = players.map((p) => p.averages);
  const sum = (k: keyof SeasonAverages) => avgs.reduce((s, a) => s + a[k], 0);
  const fgPool = sum('fga') > 0 ? sum('fgm') / sum('fga') : 0;
  const ftPool = sum('fta') > 0 ? sum('ftm') / sum('fta') : 0;

  const columns = [
    ...COUNTING.map((k) => zscores(avgs.map((a) => a[k]))),
    zscores(avgs.map((a) => a.fgm - fgPool * a.fga)),
    zscores(avgs.map((a) => a.ftm - ftPool * a.fta)),
    zscores(avgs.map((a) => a.tov)).map((z) => -z),
  ];
  players.forEach((p, i) => out.set(p.id, columns.reduce((s, col) => s + col[i], 0)));
  return out;
}

/** The CPU drafts the best available value for the first 60% of rounds (rounded up)... */
export const CPU_GREEDY_SHARE = 0.6;
/** ...then adds up to +/- this much (in z-score units) of noise so late picks are less predictable. */
export const CPU_JITTER = 1;

export function cpuRandomizes(round: number, rosterSize: number): boolean {
  return round > Math.ceil(rosterSize * CPU_GREEDY_SHARE);
}

export function cpuChoosePlayer(
  available: readonly PoolPlayer[],
  values: ReadonlyMap<number, number>,
  round: number,
  rosterSize: number,
  rng: Rng,
): PoolPlayer {
  if (available.length === 0) throw new Error('CPU has no players to choose from');
  const randomize = cpuRandomizes(round, rosterSize);
  let best = available[0];
  let bestValue = -Infinity;
  for (const p of available) {
    const base = values.get(p.id) ?? 0;
    const value = randomize ? base + (rng() * 2 - 1) * CPU_JITTER : base;
    if (value > bestValue) {
      best = p;
      bestValue = value;
    }
  }
  return best;
}
