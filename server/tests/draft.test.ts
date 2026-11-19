import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DraftRuleError,
  SettingsError,
  currentSlot,
  draftOrder,
  roundForPick,
  teamForPick,
  totalPicks,
  validatePick,
  validateSettings,
} from '../src/domain/draft.js';
import type { Team } from '../src/domain/types.js';

describe('snake draft order', () => {
  it('alternates A,B then B,A (5 rounds = 10 picks)', () => {
    expect(draftOrder(5).map((s) => s.team).join('')).toBe('ABBAABBAAB');
    expect(totalPicks(5)).toBe(10);
  });

  it('works for any roster size', () => {
    expect(draftOrder(1).map((s) => s.team).join('')).toBe('AB');
    expect(draftOrder(2).map((s) => s.team).join('')).toBe('ABBA');
    expect(draftOrder(13)).toHaveLength(26);
    for (const n of [1, 3, 8, 13]) {
      const order = draftOrder(n);
      expect(order.filter((s) => s.team === 'A')).toHaveLength(n);
      expect(order.filter((s) => s.team === 'B')).toHaveLength(n);
      expect(order.at(-1)!.round).toBe(n);
    }
  });

  it('assigns rounds two picks at a time', () => {
    expect(draftOrder(5).map((s) => s.round)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(roundForPick(1)).toBe(1);
    expect(roundForPick(26)).toBe(13);
  });

  it('the coin-flip winner picks first; B first mirrors A first', () => {
    expect(draftOrder(5, 'B').map((s) => s.team).join('')).toBe('BAABBAABBA');
    expect(currentSlot(0, 5, 'B')).toEqual({ pickNumber: 1, round: 1, team: 'B' });
    expect(currentSlot(2, 5, 'B')).toEqual({ pickNumber: 3, round: 2, team: 'A' });
    for (let p = 1; p <= 26; p++) expect(teamForPick(p, 'B')).not.toBe(teamForPick(p, 'A'));
  });

  it('validatePick follows the coin flip', () => {
    const pool = new Set([1, 2, 3]);
    expect(validatePick({ picks: [], rosterSize: 1, firstTeam: 'B', poolIds: pool, playerSeasonId: 1 }).team).toBe('B');
    expect(() =>
      validatePick({ picks: [], rosterSize: 1, firstTeam: 'B', poolIds: pool, playerSeasonId: 1, team: 'A' }),
    ).toThrow(/Team B's turn/);
  });

  it('matches the formula used by the DB trigger', () => {
    for (let p = 1; p <= 26; p++) {
      const sqlTeam: Team = (Math.floor((p - 1) / 2) + ((p - 1) % 2)) % 2 === 0 ? 'A' : 'B';
      expect(teamForPick(p)).toBe(sqlTeam);
    }
  });

  it('rejects non-positive or fractional pick numbers', () => {
    expect(() => teamForPick(0)).toThrow(RangeError);
    expect(() => teamForPick(1.5)).toThrow(RangeError);
  });

  it('reports the slot on the clock and null when done', () => {
    expect(currentSlot(0, 5)).toEqual({ pickNumber: 1, round: 1, team: 'A' });
    expect(currentSlot(2, 5)).toEqual({ pickNumber: 3, round: 2, team: 'B' });
    expect(currentSlot(10, 5)).toBeNull();
    expect(currentSlot(2, 1)).toBeNull();
    expect(currentSlot(10, 6)).toEqual({ pickNumber: 11, round: 6, team: 'B' });
  });
});

describe('validateSettings', () => {
  const ok = (poolSize: number, rosterSize: number) => validateSettings({ ...DEFAULT_SETTINGS, poolSize, rosterSize });

  it('accepts the defaults and the boundaries', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(ok(2, 1).rosterSize).toBe(1);
    expect(ok(26, 13).poolSize).toBe(26);
    expect(ok(200, 5).poolSize).toBe(200);
  });

  it('rejects team sizes outside 1-13', () => {
    expect(() => ok(30, 0)).toThrow(SettingsError);
    expect(() => ok(30, 14)).toThrow(SettingsError);
    expect(() => ok(30, 2.5)).toThrow(SettingsError);
  });

  it('needs enough players to fill both teams, and at most 200', () => {
    expect(() => ok(9, 5)).toThrow(/from 10/);
    expect(() => ok(201, 5)).toThrow(SettingsError);
    expect(() => ok(24.5, 5)).toThrow(SettingsError);
  });
});

describe('validatePick', () => {
  const pool = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const picksSoFar = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ pickNumber: i + 1, team: teamForPick(i + 1), playerSeasonId: i + 1 }));
  const attempt = (n: number, playerSeasonId: number, team?: Team, rosterSize = 5) =>
    validatePick({ picks: picksSoFar(n), rosterSize, firstTeam: 'A', poolIds: pool, playerSeasonId, team });

  function codeOf(fn: () => unknown): string | undefined {
    try {
      fn();
    } catch (e) {
      return e instanceof DraftRuleError ? e.code : 'OTHER';
    }
    return undefined;
  }

  it('accepts a valid pick and returns the slot it fills', () => {
    expect(attempt(0, 5, 'A')).toEqual({ pickNumber: 1, round: 1, team: 'A' });
  });

  it("can't pick out of turn", () => {
    expect(codeOf(() => attempt(0, 5, 'B'))).toBe('NOT_YOUR_TURN');
    // After pick 2 (B), B picks again at 3: A trying to pick is out of turn.
    expect(codeOf(() => attempt(2, 5, 'A'))).toBe('NOT_YOUR_TURN');
    expect(attempt(2, 5, 'B').pickNumber).toBe(3);
  });

  it("can't pick an already-drafted player-season", () => {
    expect(codeOf(() => attempt(3, 2, 'A'))).toBe('PLAYER_ALREADY_DRAFTED');
  });

  it("can't pick a player-season outside the pool", () => {
    expect(codeOf(() => attempt(0, 999, 'A'))).toBe('PLAYER_NOT_IN_POOL');
  });

  it("can't pick once the draft is finished, which depends on the roster size", () => {
    expect(codeOf(() => attempt(10, 11, 'A'))).toBe('DRAFT_COMPLETE');
    expect(codeOf(() => attempt(2, 11, 'B', 1))).toBe('DRAFT_COMPLETE');
    expect(attempt(10, 11, 'B', 6).pickNumber).toBe(11);
  });

  it('does not mutate the picks it is given', () => {
    const picks = picksSoFar(1);
    validatePick({ picks, rosterSize: 5, firstTeam: 'A', poolIds: pool, playerSeasonId: 7 });
    expect(picks).toHaveLength(1);
  });
});
