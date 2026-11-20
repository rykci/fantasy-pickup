import type { Prisma, PrismaClient } from '@prisma/client';
import type { PlayerSeasonLogIds } from '../domain/lock.js';
import type { PoolCandidate } from '../domain/pool.js';
import {
  STAT_KEYS,
  type GameMode,
  type GameClue,
  type GameSettings,
  type GameStatus,
  type LockRecord,
  type LockedLine,
  type PickRecord,
  type PoolPlayer,
  type StatLine,
  type Team,
} from '../domain/types.js';
import type {
  GameRecord,
  GameRepository,
  GameResultUpdate,
  GameUpdate,
  OnlineOptions,
  SeatRecord,
} from './gameRepository.js';

type Db = PrismaClient | Prisma.TransactionClient;

function statLine(row: StatLine): StatLine {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, row[k]])) as StatLine;
}

export class PrismaGameRepository implements GameRepository {
  constructor(
    private readonly db: Db,
    private readonly root?: PrismaClient,
  ) {}

  async listUniverse(topN: number, seasons: { from: number; to: number }): Promise<PoolCandidate[]> {
    const rows = await this.db.playerSeason.findMany({
      // Seasons are "1995-96" strings, so starting years compare as text: "1995" <= "1995-96" < "1996".
      where: { seasonRank: { lte: topN }, season: { gte: String(seasons.from), lt: String(seasons.to + 1) } },
      select: { id: true, playerId: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => ({ playerSeasonId: r.id, playerId: r.playerId }));
  }

  async listGameLogIds(playerSeasonIds: number[]): Promise<PlayerSeasonLogIds[]> {
    const logs = await this.db.gameLog.findMany({
      where: { playerSeasonId: { in: playerSeasonIds } },
      select: { id: true, playerSeasonId: true },
      orderBy: { id: 'asc' },
    });
    const byPs = new Map<number, number[]>(playerSeasonIds.map((id) => [id, []]));
    for (const l of logs) byPs.get(l.playerSeasonId)!.push(l.id);
    return [...byPs].map(([playerSeasonId, gameLogIds]) => ({ playerSeasonId, gameLogIds }));
  }

  async createGame(
    mode: GameMode,
    settings: GameSettings,
    firstTeam: Team,
    locks: LockRecord[],
    online?: OnlineOptions,
  ): Promise<GameRecord> {
    // Nested create => the game and its locks are inserted in a single transaction.
    return this.db.game.create({
      data: {
        mode,
        ...settings,
        firstTeam,
        ...(online && {
          status: 'lobby',
          roomCode: online.roomCode,
          pickSeconds: online.pickSeconds,
          lastActivityAt: online.now,
        }),
        players: {
          createMany: {
            data: locks.map((l) => ({ playerSeasonId: l.playerSeasonId, lockedGameLogId: l.lockedGameLogId })),
          },
        },
      },
    });
  }

  async findGame(gameId: number): Promise<GameRecord | null> {
    return this.db.game.findUnique({ where: { id: gameId } });
  }

  async listPool(gameId: number): Promise<PoolPlayer[]> {
    // From the locked game log, only its team (right for traded players): never its stats.
    const rows = await this.db.gamePlayer.findMany({
      where: { gameId },
      select: { playerSeason: { include: { player: true } }, lockedGameLog: { select: { team: true } } },
      orderBy: { playerSeasonId: 'asc' },
    });
    return rows.map(({ playerSeason: ps, lockedGameLog }) => ({
      id: ps.id,
      playerId: ps.playerId,
      name: ps.player.name,
      season: ps.season,
      team: lockedGameLog.team,
      averages: { gamesPlayed: ps.gamesPlayed, minutes: ps.minutes, ...statLine(ps) },
    }));
  }

  async listPicks(gameId: number): Promise<PickRecord[]> {
    const picks = await this.db.draftPick.findMany({ where: { gameId }, orderBy: { pickNumber: 'asc' } });
    return picks.map((p) => ({
      pickNumber: p.pickNumber,
      team: p.team,
      playerSeasonId: p.playerSeasonId,
      pickedAt: p.pickedAt,
    }));
  }

  async listLocks(gameId: number): Promise<LockRecord[]> {
    return this.db.gamePlayer.findMany({
      where: { gameId },
      select: { playerSeasonId: true, lockedGameLogId: true },
      orderBy: { playerSeasonId: 'asc' },
    });
  }

  async listGameClues(gameId: number): Promise<GameClue[]> {
    // Date / opponent / home-away only: never the locked game's stats.
    const rows = await this.db.gamePlayer.findMany({
      where: { gameId },
      select: { playerSeasonId: true, lockedGameLog: { select: { gameDate: true, opponent: true, isHome: true } } },
    });
    return rows.map(({ playerSeasonId, lockedGameLog: g }) => ({
      playerSeasonId,
      gameDate: g.gameDate.toISOString().slice(0, 10),
      opponent: g.opponent,
      isHome: g.isHome,
    }));
  }

  async listLockedLines(gameId: number, playerSeasonIds: number[]): Promise<LockedLine[]> {
    const rows = await this.db.gamePlayer.findMany({
      where: { gameId, playerSeasonId: { in: playerSeasonIds } },
      select: { lockedGameLog: true },
    });
    return rows.map(({ lockedGameLog: g }) => ({
      playerSeasonId: g.playerSeasonId,
      gameLogId: g.id,
      gameId: g.gameId,
      gameDate: g.gameDate.toISOString().slice(0, 10),
      team: g.team,
      opponent: g.opponent,
      isHome: g.isHome,
      minutes: g.minutes,
      ...statLine(g),
    }));
  }

  async addPick(gameId: number, pick: { pickNumber: number; team: Team; playerSeasonId: number }): Promise<PickRecord> {
    const p = await this.db.draftPick.create({ data: { gameId, ...pick } });
    return { pickNumber: p.pickNumber, team: p.team, playerSeasonId: p.playerSeasonId, pickedAt: p.pickedAt };
  }

  async setStatus(gameId: number, status: GameStatus): Promise<void> {
    await this.db.game.update({ where: { id: gameId }, data: { status } });
  }

  async saveResult(gameId: number, result: GameResultUpdate): Promise<void> {
    await this.db.game.update({
      where: { id: gameId },
      data: { status: 'revealed', revealedAt: new Date(), ...result },
    });
  }

  async findGameIdByRoomCode(roomCode: string): Promise<number | null> {
    const g = await this.db.game.findUnique({ where: { roomCode }, select: { id: true } });
    return g?.id ?? null;
  }

  async listSeats(gameId: number): Promise<SeatRecord[]> {
    return this.db.gameSeat.findMany({
      where: { gameId },
      select: { team: true, name: true, tokenHash: true, joinedAt: true, lastSeenAt: true, rematch: true },
      orderBy: { team: 'asc' },
    });
  }

  async addSeat(gameId: number, seat: Pick<SeatRecord, 'team' | 'name' | 'tokenHash'>, at: Date): Promise<SeatRecord> {
    const s = await this.db.gameSeat.create({ data: { gameId, ...seat, joinedAt: at, lastSeenAt: at } });
    return {
      team: s.team,
      name: s.name,
      tokenHash: s.tokenHash,
      joinedAt: s.joinedAt,
      lastSeenAt: s.lastSeenAt,
      rematch: s.rematch,
    };
  }

  async setRematch(gameId: number, team: Team, answer: boolean | null): Promise<void> {
    await this.db.gameSeat.update({ where: { gameId_team: { gameId, team } }, data: { rematch: answer } });
  }

  async touchSeat(gameId: number, team: Team, at: Date): Promise<void> {
    await this.db.gameSeat.update({ where: { gameId_team: { gameId, team } }, data: { lastSeenAt: at } });
  }

  async updateGame(gameId: number, update: GameUpdate): Promise<void> {
    await this.db.game.update({ where: { id: gameId }, data: update });
  }

  async withGameLock<T>(gameId: number, fn: (repo: GameRepository) => Promise<T>): Promise<T> {
    if (!this.root) {
      // Already inside a transaction.
      return fn(this);
    }
    return this.root.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM games WHERE id = ${gameId} FOR UPDATE`;
      return fn(new PrismaGameRepository(tx));
    });
  }
}

export function createPrismaGameRepository(prisma: PrismaClient): PrismaGameRepository {
  return new PrismaGameRepository(prisma, prisma);
}
