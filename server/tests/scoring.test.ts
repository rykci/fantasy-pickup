import { describe, expect, it } from 'vitest';
import { CATEGORIES, scoreMatchup, teamTotals } from '../src/domain/scoring.js';
import { line } from './support/fixtures.js';

// A baseline team; tests tweak one thing at a time.
const base = line({ pts: 100, reb: 40, ast: 25, stl: 8, blk: 5, fg3m: 10, fgm: 40, fga: 85, ftm: 15, fta: 20, tov: 12 });
const winners = (r: ReturnType<typeof scoreMatchup>) => Object.fromEntries(r.categories.map((c) => [c.key, c.winner]));

describe('teamTotals', () => {
  it('sums every stat', () => {
    const t = teamTotals([line({ pts: 30, fgm: 10, fga: 20, tov: 3 }), line({ pts: 20, fgm: 8, fga: 12, tov: 1 })]);
    expect(t).toMatchObject({ pts: 50, fgm: 18, fga: 32, tov: 4, reb: 0 });
  });

  it('is all zeros for an empty roster', () => {
    expect(teamTotals([])).toEqual(line());
  });
});

describe('scoreMatchup: categories', () => {
  it('has the 9 standard categories', () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual(['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO']);
  });

  it('identical teams tie every category and draw', () => {
    const r = scoreMatchup(base, { ...base });
    expect(r.categories.every((c) => c.winner === 'tie')).toBe(true);
    expect(r).toMatchObject({ score: { A: 0, B: 0 }, winner: 'draw', decidedBy: 'draw' });
  });

  it('counting stats: higher total wins', () => {
    const r = scoreMatchup({ ...base, reb: 41, blk: 4 }, base);
    expect(winners(r)).toMatchObject({ reb: 'A', blk: 'B', pts: 'tie' });
  });

  it('TO: fewer turnovers wins', () => {
    expect(winners(scoreMatchup({ ...base, tov: 10 }, base)).tov).toBe('A');
    expect(winners(scoreMatchup({ ...base, tov: 14 }, base)).tov).toBe('B');
  });

  it('FG%/FT% use team makes / attempts, not volume', () => {
    // A: 30/60 = .500, B: 40/85 = .471. A made fewer but shot better.
    const r = scoreMatchup({ ...base, fgm: 30, fga: 60 }, base);
    expect(winners(r).fgPct).toBe('A');
    const fg = r.categories.find((c) => c.key === 'fgPct')!;
    expect(fg.A).toBeCloseTo(0.5);
    expect(fg.B).toBeCloseTo(40 / 85);
  });

  it('equal percentages tie exactly (no floating point drift)', () => {
    // 1/3 vs 7/21
    const r = scoreMatchup({ ...base, ftm: 1, fta: 3 }, { ...base, ftm: 7, fta: 21 });
    expect(winners(r).ftPct).toBe('tie');
  });

  it('a team with no attempts loses the percentage category; neither team: tie', () => {
    const r = scoreMatchup({ ...base, ftm: 0, fta: 0 }, { ...base, ftm: 0, fta: 1 });
    expect(winners(r).ftPct).toBe('B');
    expect(r.categories.find((c) => c.key === 'ftPct')!.A).toBeNull();
    expect(winners(scoreMatchup({ ...base, ftm: 0, fta: 0 }, { ...base, ftm: 0, fta: 0 })).ftPct).toBe('tie');
  });

  it('marks TO as lower-is-better for display', () => {
    const r = scoreMatchup(base, base);
    expect(r.categories.filter((c) => c.lowerIsBetter).map((c) => c.key)).toEqual(['tov']);
  });
});

describe('scoreMatchup: winner', () => {
  it('more categories wins', () => {
    // A: PTS, REB, AST, STL, BLK. B: 3PM, FG%, FT%, TO.
    const a = { ...base, pts: 110, reb: 45, ast: 30, stl: 9, blk: 6, fg3m: 8, fgm: 40, fga: 95, ftm: 10, fta: 20, tov: 15 };
    const r = scoreMatchup(a, base);
    expect(r).toMatchObject({ score: { A: 5, B: 4 }, winner: 'A', decidedBy: 'categories' });
  });

  it('ties count for nobody (3-2 with four ties still wins)', () => {
    const r = scoreMatchup({ ...base, pts: 101, reb: 41, ast: 26, stl: 7, blk: 4 }, base);
    expect(r).toMatchObject({ score: { A: 3, B: 2 }, winner: 'A' });
  });

  it('level on categories: total PTS breaks the tie', () => {
    // A: PTS, REB. B: AST, STL. Rest tied.
    const r = scoreMatchup({ ...base, pts: 101, reb: 41, ast: 24, stl: 7 }, base);
    expect(r).toMatchObject({ score: { A: 2, B: 2 }, winner: 'A', decidedBy: 'points_tiebreak' });
  });

  it('PTS tiebreak can favour B', () => {
    const r = scoreMatchup({ ...base, pts: 99, reb: 41 }, base);
    expect(r).toMatchObject({ score: { A: 1, B: 1 }, winner: 'B', decidedBy: 'points_tiebreak' });
  });

  it('level on categories and PTS: draw', () => {
    const r = scoreMatchup({ ...base, reb: 41, ast: 24 }, base);
    expect(r).toMatchObject({ score: { A: 1, B: 1 }, winner: 'draw', decidedBy: 'draw' });
  });

  it('end to end from stat lines', () => {
    const a = teamTotals([
      line({ pts: 30, reb: 10, ast: 4, stl: 1, blk: 2, fg3m: 3, fgm: 11, fga: 20, ftm: 5, fta: 6, tov: 2 }),
      line({ pts: 14, reb: 11, ast: 3, stl: 0, blk: 1, fg3m: 0, fgm: 6, fga: 10, ftm: 2, fta: 6, tov: 1 }),
    ]);
    const b = teamTotals([
      line({ pts: 24, reb: 12, ast: 10, stl: 1, blk: 0, fg3m: 1, fgm: 9, fga: 21, ftm: 5, fta: 5, tov: 4 }),
      line({ pts: 19, reb: 7, ast: 4, stl: 2, blk: 3, fg3m: 3, fgm: 7, fga: 15, ftm: 2, fta: 2, tov: 3 }),
    ]);
    const r = scoreMatchup(a, b);
    // A: PTS 44>43, REB 21>19, FG% .567>.444, TO 3<7. B: AST, STL, BLK, 3PM (3 vs 4), FT% (7/12 vs 7/7).
    expect(winners(r)).toEqual({
      pts: 'A', reb: 'A', ast: 'B', stl: 'B', blk: 'tie', fg3m: 'B', fgPct: 'A', ftPct: 'B', tov: 'A',
    });
    expect(r).toMatchObject({ score: { A: 4, B: 4 }, winner: 'A', decidedBy: 'points_tiebreak' });
  });
});
