import type { PlayerSeasonLogIds } from '../domain/lock.js';
import type { PoolCandidate } from '../domain/pool.js';
import type {
  GameMode,
  GameSettings,
  GameStatus,
  LockRecord,
  LockedLine,
  PickRecord,
  PoolPlayer,
  Team,
  Winner,
} from '../domain/types.js';

export interface GameRecord extends GameSettings {
  id: number;
  mode: GameMode;
  status: GameStatus;
  winner: Winner | null;
  scoreA: number | null;
  scoreB: number | null;
  createdAt: Date;
  revealedAt: Date | null;
}

export interface GameResultUpdate {
  winner: Winner;
  scoreA: number;
  scoreB: number;
}

/**
 * Persistence boundary for the game service. Implemented by PrismaGameRepository
 * in production and by an in-memory fake in unit tests.
 */
export interface GameRepository {
  /** Every draftable player-season: the top `topN` of each NBA season by 9-cat rank. */
  listUniverse(topN: number): Promise<PoolCandidate[]>;
  /** The ids of every game log of the given player-seasons. */
  listGameLogIds(playerSeasonIds: number[]): Promise<PlayerSeasonLogIds[]>;
  /** Creates the game and its locked games atomically. */
  createGame(mode: GameMode, settings: GameSettings, locks: LockRecord[]): Promise<GameRecord>;
  findGame(gameId: number): Promise<GameRecord | null>;
  /** The game's pool, with season averages. Never includes the locked games. */
  listPool(gameId: number): Promise<PoolPlayer[]>;
  /** Picks in pick order. */
  listPicks(gameId: number): Promise<PickRecord[]>;
  listLocks(gameId: number): Promise<LockRecord[]>;
  /** The locked game lines for the given player-seasons in this game. Only call after the draft. */
  listLockedLines(gameId: number, playerSeasonIds: number[]): Promise<LockedLine[]>;
  addPick(gameId: number, pick: { pickNumber: number; team: Team; playerSeasonId: number }): Promise<PickRecord>;
  setStatus(gameId: number, status: GameStatus): Promise<void>;
  saveResult(gameId: number, result: GameResultUpdate): Promise<void>;
  /**
   * Runs fn in a transaction holding a row lock on the game, so concurrent
   * requests for the same game are serialized.
   */
  withGameLock<T>(gameId: number, fn: (repo: GameRepository) => Promise<T>): Promise<T>;
}
