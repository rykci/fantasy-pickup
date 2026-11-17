import { STAT_KEYS, type StatLine, type Team, type Winner } from './types.js';

export type CategoryKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m' | 'fgPct' | 'ftPct' | 'tov';

export interface CategoryDef {
  key: CategoryKey;
  label: string;
  /** TO: the lower total wins. */
  lowerIsBetter?: boolean;
  /** FG% / FT%: computed from team makes / attempts. */
  pct?: { made: 'fgm' | 'ftm'; att: 'fga' | 'fta' };
}

/** Standard 9-cat. */
export const CATEGORIES: readonly CategoryDef[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'fg3m', label: '3PM' },
  { key: 'fgPct', label: 'FG%', pct: { made: 'fgm', att: 'fga' } },
  { key: 'ftPct', label: 'FT%', pct: { made: 'ftm', att: 'fta' } },
  { key: 'tov', label: 'TO', lowerIsBetter: true },
];

/** Summed box-score stats for a team. */
export type TeamTotals = StatLine;

export interface CategoryResult {
  key: CategoryKey;
  label: string;
  /** Team value: a total, or a percentage as a 0-1 fraction (null = no attempts). */
  A: number | null;
  B: number | null;
  lowerIsBetter: boolean;
  winner: Team | 'tie';
}

export interface MatchupResult {
  categories: CategoryResult[];
  /** Categories won (ties count for nobody). */
  score: { A: number; B: number };
  winner: Winner;
  /** How the winner was decided. */
  decidedBy: 'categories' | 'points_tiebreak' | 'draw';
}

export function teamTotals(lines: readonly StatLine[]): TeamTotals {
  const t = Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as TeamTotals;
  for (const l of lines) for (const k of STAT_KEYS) t[k] += l[k];
  return t;
}

export function pct(made: number, att: number): number | null {
  return att > 0 ? made / att : null;
}

/** >0 if A is better, <0 if B is better, 0 for a tie. */
function compare(def: CategoryDef, a: TeamTotals, b: TeamTotals): number {
  if (def.pct) {
    const { made, att } = def.pct;
    // A team with no attempts has no percentage and loses the category (both none: tie).
    if (a[att] === 0 || b[att] === 0) return Math.sign(a[att]) - Math.sign(b[att]);
    // Cross-multiply instead of dividing, so equal percentages tie exactly.
    return a[made] * b[att] - b[made] * a[att];
  }
  const key = def.key as keyof TeamTotals;
  return def.lowerIsBetter ? b[key] - a[key] : a[key] - b[key];
}

function display(def: CategoryDef, t: TeamTotals): number | null {
  if (def.pct) return pct(t[def.pct.made], t[def.pct.att]);
  return t[def.key as keyof TeamTotals];
}

/**
 * Head-to-head 9-cat scoring.
 *  - Each category goes to the better team total (equal = tie, no point). TO: fewer wins.
 *    FG% and FT% are team makes / team attempts.
 *  - Team with more categories wins (e.g. 5-4, 4-3 with two ties).
 *  - If category wins are level, higher total PTS wins. If PTS are also level, it's a draw.
 */
export function scoreMatchup(a: TeamTotals, b: TeamTotals): MatchupResult {
  const categories: CategoryResult[] = CATEGORIES.map((def) => {
    const c = compare(def, a, b);
    return {
      key: def.key,
      label: def.label,
      A: display(def, a),
      B: display(def, b),
      lowerIsBetter: !!def.lowerIsBetter,
      winner: c > 0 ? 'A' : c < 0 ? 'B' : 'tie',
    };
  });
  const score = {
    A: categories.filter((c) => c.winner === 'A').length,
    B: categories.filter((c) => c.winner === 'B').length,
  };

  if (score.A !== score.B) {
    return { categories, score, winner: score.A > score.B ? 'A' : 'B', decidedBy: 'categories' };
  }
  if (a.pts !== b.pts) {
    return { categories, score, winner: a.pts > b.pts ? 'A' : 'B', decidedBy: 'points_tiebreak' };
  }
  return { categories, score, winner: 'draw', decidedBy: 'draw' };
}
