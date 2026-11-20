import type { PlayerSeasonLogIds } from '../domain/lock.js';
import type { PoolCandidate } from '../domain/pool.js';
import type {
  GameMode,
  GameSettings,
  GameClue,
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
  /** Coin-flip winner: picks first. */
  firstTeam: Team;
  createdAt: Date;
  // Online games only (null / unused otherwise).
  roomCode: string | null;
  pickSeconds: number | null;
  startedAt: Date | null;
  turnStartedAt: Date | null;
  revealStartedAt: Date | null;
  rematchGameId: number | null;
  revealedAt: Date | null;
  lastActivityAt: Date;
}

export interface SeatRecord {
  team: Team;
  name: string;
  tokenHash: string;
  joinedAt: Date;
  lastSeenAt: Date;
  /** After a finished game: wants a rematch (true), said no (false), or hasn't answered (null). */
  rematch: boolean | null;
}

export interface OnlineOptions {
  roomCode: string;
  pickSeconds: number | null;
  /** The service's clock (so tests can control time). */
  now: Date;
}

export type GameUpdate = Partial<
  Pick<GameRecord, 'status' | 'startedAt' | 'turnStartedAt' | 'revealStartedAt' | 'rematchGameId' | 'lastActivityAt'>
>;

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
  listUniverse(topN: number, seasons: { from: number; to: number }): Promise<PoolCandidate[]>;
  /** The ids of every game log of the given player-seasons. */
  listGameLogIds(playerSeasonIds: number[]): Promise<PlayerSeasonLogIds[]>;
  /** Creates the game and its locked games atomically. */
  /** Online games (with `online`) start in the lobby; others start drafting. */
  createGame(
    mode: GameMode,
    settings: GameSettings,
    firstTeam: Team,
    locks: LockRecord[],
    online?: OnlineOptions,
  ): Promise<GameRecord>;
  findGameIdByRoomCode(roomCode: string): Promise<number | null>;
  listSeats(gameId: number): Promise<SeatRecord[]>;
  /** `at` is the join time, also the first "last seen". */
  addSeat(gameId: number, seat: Pick<SeatRecord, 'team' | 'name' | 'tokenHash'>, at: Date): Promise<SeatRecord>;
  /** Records a player's answer to "rematch?" (null clears it). */
  setRematch(gameId: number, team: Team, answer: boolean | null): Promise<void>;
  /** Marks a seat's player as seen now (for the "online" dot). */
  touchSeat(gameId: number, team: Team, at: Date): Promise<void>;
  updateGame(gameId: number, update: GameUpdate): Promise<void>;
  findGame(gameId: number): Promise<GameRecord | null>;
  /** The game's pool, with season averages. Never includes the locked games. */
  listPool(gameId: number): Promise<PoolPlayer[]>;
  /** Picks in pick order. */
  listPicks(gameId: number): Promise<PickRecord[]>;
  listLocks(gameId: number): Promise<LockRecord[]>;
  /** Date and opponent of every locked game in this game (no stats). Only for games that show them. */
  listGameClues(gameId: number): Promise<GameClue[]>;
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
