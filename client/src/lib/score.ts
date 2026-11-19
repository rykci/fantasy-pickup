import type { CategoryResult, StatLine, Team } from '../api';

// Mirrors server/src/domain/scoring.ts, for the live scoreboard during the reveal
// (partial totals, while stats are still landing). The final result always comes from the server.

const KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'fgm', 'fga', 'ftm', 'fta', 'tov'] as const;

export const emptyTotals = (): StatLine =>
  Object.fromEntries(KEYS.map((k) => [k, 0])) as unknown as StatLine;

export function addTo(t: StatLine, line: Partial<StatLine>): void {
  for (const k of KEYS) t[k] += line[k] ?? 0;
}

const DEFS: { key: CategoryResult['key']; label: string; pct?: [keyof StatLine, keyof StatLine]; lower?: boolean }[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'fg3m', label: '3PM' },
  { key: 'fgPct', label: 'FG%', pct: ['fgm', 'fga'] },
  { key: 'ftPct', label: 'FT%', pct: ['ftm', 'fta'] },
  { key: 'tov', label: 'TO', lower: true },
];

export function scoreCategories(a: StatLine, b: StatLine): { categories: CategoryResult[]; score: Record<Team, number> } {
  const categories = DEFS.map((d): CategoryResult => {
    let c: number;
    let A: number | null;
    let B: number | null;
    if (d.pct) {
      const [m, n] = d.pct;
      c = a[n] === 0 || b[n] === 0 ? Math.sign(a[n]) - Math.sign(b[n]) : a[m] * b[n] - b[m] * a[n];
      A = a[n] ? a[m] / a[n] : null;
      B = b[n] ? b[m] / b[n] : null;
    } else {
      const k = d.key as keyof StatLine;
      c = d.lower ? b[k] - a[k] : a[k] - b[k];
      A = a[k];
      B = b[k];
    }
    return { key: d.key, label: d.label, A, B, lowerIsBetter: !!d.lower, winner: c > 0 ? 'A' : c < 0 ? 'B' : 'tie' };
  });
  return {
    categories,
    score: {
      A: categories.filter((c) => c.winner === 'A').length,
      B: categories.filter((c) => c.winner === 'B').length,
    },
  };
}
