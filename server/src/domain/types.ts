export type Team = 'A' | 'B';
export type GameMode = 'vs_cpu' | 'pass_and_play' | 'online';
/** `lobby` is online-only: waiting for the second player and the host's Start. */
export type GameStatus = 'lobby' | 'drafting' | 'draft_complete' | 'revealed';
export type Winner = Team | 'draw';

/** Returns a float in [0, 1). Injected so randomness is testable. */
export type Rng = () => number;

/** Box-score stats needed for 9-cat scoring (FG% and FT% come from makes/attempts). */
export const STAT_KEYS = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m', 'fgm', 'fga', 'ftm', 'fta', 'tov'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type StatLine = Record<StatKey, number>;

export interface SeasonAverages extends StatLine {
  gamesPlayed: number;
  minutes: number;
}

export interface GameSettings {
  /** Player-seasons in the pool. */
  poolSize: number;
  /** Players per team = rounds in the draft. */
  rosterSize: number;
  /** true = at most one season per player in the pool. */
  uniquePlayers: boolean;
  // What the draft board shows before the reveal (anything hidden isn't sent at all).
  /** Season and team of each player-season. */
  showSeasonTeam: boolean;
  /** Date and opponent of each player-season's locked game: a clue, its stats stay secret. */
  showGameDate: boolean;
  /** Season averages and VAL. */
  showAverages: boolean;
}

/** Date and opponent of a locked game, without its stats. */
export interface GameClue {
  playerSeasonId: number;
  /** YYYY-MM-DD */
  gameDate: string;
  opponent: string;
  isHome: boolean;
}

/** A draftable player-season in a game's pool. */
export interface PoolPlayer {
  /** Player-season id (what gets drafted). */
  id: number;
  /** Person id (the same for every season of a player). */
  playerId: number;
  name: string;
  /** e.g. "1986-87" */
  season: string;
  team: string;
  averages: SeasonAverages;
}

export interface PickRecord {
  pickNumber: number;
  team: Team;
  playerSeasonId: number;
  pickedAt: Date;
}

export interface LockRecord {
  playerSeasonId: number;
  lockedGameLogId: number;
}

export interface LockedLine extends StatLine {
  playerSeasonId: number;
  gameLogId: number;
  gameId: string;
  /** YYYY-MM-DD */
  gameDate: string;
  team: string;
  opponent: string;
  isHome: boolean;
  minutes: number;
}
