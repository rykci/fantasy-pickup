import type { GameSettings, PickRecord, Team } from './types.js';

export const TEAMS: readonly Team[] = ['A', 'B'];

export const DEFAULT_SETTINGS: GameSettings = { poolSize: 24, rosterSize: 5, uniquePlayers: false };
/** Mirrored by the games_settings_valid CHECK constraint. */
export const LIMITS = { minRoster: 1, maxRoster: 13, maxPool: 200 } as const;

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

/**
 * Snake draft: odd rounds go A, B; even rounds go B, A.
 *   1:A 2:B | 3:B 4:A | 5:A 6:B | 7:B 8:A | ...
 * Doesn't depend on the number of rounds. (Mirrored by a CHECK constraint on draft_picks.)
 */
export function teamForPick(pickNumber: number): Team {
  assertPickNumber(pickNumber);
  const round = roundForPick(pickNumber);
  const slot = (pickNumber - 1) % TEAMS.length;
  return round % 2 === 1 ? TEAMS[slot] : TEAMS[TEAMS.length - 1 - slot];
}

export function draftOrder(rosterSize: number): DraftSlot[] {
  return Array.from({ length: totalPicks(rosterSize) }, (_, i) => slotFor(i + 1));
}

/** The slot that is on the clock, or null when the draft is complete. */
export function currentSlot(picksMade: number, rosterSize: number): DraftSlot | null {
  return picksMade >= totalPicks(rosterSize) ? null : slotFor(picksMade + 1);
}

function slotFor(pickNumber: number): DraftSlot {
  return { pickNumber, round: roundForPick(pickNumber), team: teamForPick(pickNumber) };
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
  poolIds: ReadonlySet<number>;
  playerSeasonId: number;
  /** Team claiming to make the pick. Omit to pick for whoever is on the clock. */
  team?: Team;
}

/**
 * Validates a pick against the current draft state and returns the slot it fills.
 * Throws DraftRuleError on any violation. Pure: does not mutate its input.
 */
export function validatePick({ picks, rosterSize, poolIds, playerSeasonId, team }: PickAttempt): DraftSlot {
  const slot = currentSlot(picks.length, rosterSize);
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
