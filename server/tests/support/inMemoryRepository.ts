import type { PlayerSeasonLogIds } from '../../src/domain/lock.js';
import type { PoolCandidate } from '../../src/domain/pool.js';
import type {
  GameMode,
  GameClue,
  GameSettings,
  GameStatus,
  LockRecord,
  LockedLine,
  PickRecord,
  PoolPlayer,
  Team,
} from '../../src/domain/types.js';
import type { GameRecord, GameRepository, GameResultUpdate } from '../../src/repo/gameRepository.js';

/**
 * In-memory GameRepository for unit tests. Mirrors the DB's uniqueness
 * guarantees so tests catch the same violations Postgres would.
 * `players` is the whole universe (every player-season counts as top-N).
 */
export class InMemoryGameRepository implements GameRepository {
  games = new Map<number, GameRecord>();
  locks = new Map<number, LockRecord[]>();
  picks = new Map<number, PickRecord[]>();
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    public players: PoolPlayer[],
    public logs: LockedLine[],
  ) {}

  async listUniverse(_topN: number): Promise<PoolCandidate[]> {
    return this.players.map((p) => ({ playerSeasonId: p.id, playerId: p.playerId }));
  }

  async listGameLogIds(playerSeasonIds: number[]): Promise<PlayerSeasonLogIds[]> {
    return playerSeasonIds.map((id) => ({
      playerSeasonId: id,
      gameLogIds: this.logs.filter((l) => l.playerSeasonId === id).map((l) => l.gameLogId),
    }));
  }

  async createGame(mode: GameMode, settings: GameSettings, locks: LockRecord[]): Promise<GameRecord> {
    const game: GameRecord = {
      id: this.nextId++,
      mode,
      ...settings,
      status: 'drafting',
      winner: null,
      scoreA: null,
      scoreB: null,
      createdAt: new Date(),
      revealedAt: null,
    };
    this.games.set(game.id, game);
    this.locks.set(game.id, locks.map((l) => Object.freeze({ ...l })));
    this.picks.set(game.id, []);
    return { ...game };
  }

  async findGame(gameId: number) {
    const g = this.games.get(gameId);
    return g ? { ...g } : null;
  }

  async listPool(gameId: number): Promise<PoolPlayer[]> {
    // Like Postgres: the team comes from the locked game (right for traded players).
    const teams = new Map(
      (this.locks.get(gameId) ?? []).map((l) => [
        l.playerSeasonId,
        this.logs.find((g) => g.gameLogId === l.lockedGameLogId)!.team,
      ]),
    );
    return this.players.filter((p) => teams.has(p.id)).map((p) => ({ ...p, team: teams.get(p.id)! }));
  }

  async listPicks(gameId: number): Promise<PickRecord[]> {
    return [...(this.picks.get(gameId) ?? [])].sort((a, b) => a.pickNumber - b.pickNumber);
  }

  async listLocks(gameId: number): Promise<LockRecord[]> {
    return (this.locks.get(gameId) ?? []).map((l) => ({ ...l }));
  }

  async listGameClues(gameId: number): Promise<GameClue[]> {
    return (this.locks.get(gameId) ?? []).map((l) => {
      const g = this.logs.find((x) => x.gameLogId === l.lockedGameLogId)!;
      return { playerSeasonId: l.playerSeasonId, gameDate: g.gameDate, opponent: g.opponent, isHome: g.isHome };
    });
  }

  async listLockedLines(gameId: number, playerSeasonIds: number[]): Promise<LockedLine[]> {
    const locks = (this.locks.get(gameId) ?? []).filter((l) => playerSeasonIds.includes(l.playerSeasonId));
    return locks.map((l) => {
      const found = this.logs.find((g) => g.gameLogId === l.lockedGameLogId);
      if (!found) throw new Error(`log ${l.lockedGameLogId} missing`);
      return { ...found };
    });
  }

  async addPick(gameId: number, pick: { pickNumber: number; team: Team; playerSeasonId: number }): Promise<PickRecord> {
    const list = this.picks.get(gameId)!;
    if (list.some((p) => p.pickNumber === pick.pickNumber || p.playerSeasonId === pick.playerSeasonId)) {
      throw Object.assign(new Error('unique violation'), { code: 'P2002' });
    }
    const rec = { ...pick, pickedAt: new Date() };
    list.push(rec);
    return { ...rec };
  }

  async setStatus(gameId: number, status: GameStatus) {
    this.games.get(gameId)!.status = status;
  }

  async saveResult(gameId: number, result: GameResultUpdate) {
    Object.assign(this.games.get(gameId)!, { status: 'revealed', revealedAt: new Date(), ...result });
  }

  /** Serializes callers, like SELECT ... FOR UPDATE does. */
  async withGameLock<T>(_gameId: number, fn: (repo: GameRepository) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => fn(this));
    this.queue = run.catch(() => undefined);
    return run;
  }
}
