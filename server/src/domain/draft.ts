import type { GameSettings, PickRecord, Team } from './types.js';

export const TEAMS: readonly Team[] = ['A', 'B'];

export const DEFAULT_SETTINGS: GameSettings = {
  poolSize: 15,
  rosterSize: 5,
  uniquePlayers: true,
  fromSeason: 1983,
  toSeason: 2022,
  showSeasonTeam: false,
  showGameDate: false,
  showAverages: false,
};
/** Mirrored by the games_settings_valid CHECK constraint. */
export const LIMITS = { minRoster: 1, maxRoster: 13, maxPool: 200 } as const;
/** The seasons in the data, by starting year: 1983-84 to 2022-23. */
export const SEASONS = { first: 1983, last: 2022 } as const;

/** 1995 → "1995-96". */
export function seasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** "1995-96" → 1995. */
export function seasonStart(season: string): number {
  return Number(season.slice(0, 4));
}

export interface DraftSlot {
  pickNumber: number; // 1-based, 1..totalPicks
  round: number; // 1-based, 1..rosterSize
  team: Team;
}

export function totalPicks(rosterSize: number): number {
  return rosterSize * TEAMS.length;
}

/** Throws a SettingsError if the settings can't make a valid game. */
export function validateSettings(s: GameSettings): GameSettings {
  const { minRoster, maxRoster, maxPool } = LIMITS;
  if (!Number.isInteger(s.rosterSize) || s.rosterSize < minRoster || s.rosterSize > maxRoster) {
    throw new SettingsError(`Team size must be a whole number from ${minRoster} to ${maxRoster}.`);
  }
  const minPool = totalPicks(s.rosterSize);
  if (!Number.isInteger(s.poolSize) || s.poolSize < minPool || s.poolSize > maxPool) {
    throw new SettingsError(
      `Pool size must be a whole number from ${minPool} (enough to fill both teams of ${s.rosterSize}) to ${maxPool}.`,
    );
  }
  const { first, last } = SEASONS;
  const year = (n: number) => Number.isInteger(n) && n >= first && n <= last;
  if (!year(s.fromSeason) || !year(s.toSeason)) {
    throw new SettingsError(`Seasons must be from ${seasonLabel(first)} to ${seasonLabel(last)}.`);
  }
  if (s.fromSeason > s.toSeason) throw new SettingsError('The first season must not be after the last one.');
  return s;
}

export class SettingsError extends Error {
  readonly code = 'INVALID_SETTINGS';
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

/** Round (1-based) that a pick number belongs to. */
export function roundForPick(pickNumber: number): number {
  assertPickNumber(pickNumber);
  return Math.ceil(pickNumber / TEAMS.length);
}

export function otherTeam(t: Team): Team {
  return t === 'A' ? 'B' : 'A';
}

/**
 * Snake draft. `first` (the coin-flip winner) picks first in odd rounds, second in even ones.
 *   first = A:  1:A 2:B | 3:B 4:A | 5:A 6:B | ...
 *   first = B:  1:B 2:A | 3:A 4:B | 5:B 6:A | ...
 * Doesn't depend on the number of rounds. (Mirrored by the draft_picks_valid trigger.)
 */
export function teamForPick(pickNumber: number, first: Team = 'A'): Team {
  assertPickNumber(pickNumber);
  const round = roundForPick(pickNumber);
  const firstInSlot = (pickNumber - 1) % TEAMS.length === 0;
  return firstInSlot === (round % 2 === 1) ? first : otherTeam(first);
}

export function draftOrder(rosterSize: number, first: Team = 'A'): DraftSlot[] {
  return Array.from({ length: totalPicks(rosterSize) }, (_, i) => slotFor(i + 1, first));
}

/** The slot that is on the clock, or null when the draft is complete. */
export function currentSlot(picksMade: number, rosterSize: number, first: Team = 'A'): DraftSlot | null {
  return picksMade >= totalPicks(rosterSize) ? null : slotFor(picksMade + 1, first);
}

function slotFor(pickNumber: number, first: Team): DraftSlot {
  return { pickNumber, round: roundForPick(pickNumber), team: teamForPick(pickNumber, first) };
}

function assertPickNumber(n: number): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`pick number must be a positive integer, got ${n}`);
  }
}

// ---------------------------------------------------------------- validation

export type DraftErrorCode =
  | 'DRAFT_COMPLETE'
  | 'NOT_YOUR_TURN'
  | 'PLAYER_ALREADY_DRAFTED'
  | 'PLAYER_NOT_IN_POOL';

export class DraftRuleError extends Error {
  constructor(
    public readonly code: DraftErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DraftRuleError';
  }
}

export interface PickAttempt {
  picks: readonly Pick<PickRecord, 'pickNumber' | 'team' | 'playerSeasonId'>[];
  rosterSize: number;
  /** The coin-flip winner, who picks first. */
  firstTeam: Team;
  poolIds: ReadonlySet<number>;
  playerSeasonId: number;
  /** Team claiming to make the pick. Omit to pick for whoever is on the clock. */
  team?: Team;
}

/**
 * Validates a pick against the current draft state and returns the slot it fills.
 * Throws DraftRuleError on any violation. Pure: does not mutate its input.
 */
export function validatePick({ picks, rosterSize, firstTeam, poolIds, playerSeasonId, team }: PickAttempt): DraftSlot {
  const slot = currentSlot(picks.length, rosterSize, firstTeam);
  if (!slot) {
    throw new DraftRuleError('DRAFT_COMPLETE', 'The draft is already complete.');
  }
  if (team !== undefined && team !== slot.team) {
    throw new DraftRuleError(
      'NOT_YOUR_TURN',
      `It is Team ${slot.team}'s turn (pick ${slot.pickNumber}), not Team ${team}'s.`,
    );
  }
  if (!poolIds.has(playerSeasonId)) {
    throw new DraftRuleError('PLAYER_NOT_IN_POOL', `Player-season ${playerSeasonId} is not in this game's pool.`);
  }
  if (picks.some((p) => p.playerSeasonId === playerSeasonId)) {
    throw new DraftRuleError('PLAYER_ALREADY_DRAFTED', `Player-season ${playerSeasonId} has already been drafted.`);
  }
  return slot;
}
