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
import type { GameRecord, GameRepository, GameResultUpdate } from './gameRepository.js';

type Db = PrismaClient | Prisma.TransactionClient;

function statLine(row: StatLine): StatLine {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, row[k]])) as StatLine;
}

export class PrismaGameRepository implements GameRepository {
  constructor(
    private readonly db: Db,
    private readonly root?: PrismaClient,
  ) {}

  async listUniverse(topN: number): Promise<PoolCandidate[]> {
    const rows = await this.db.playerSeason.findMany({
      where: { seasonRank: { lte: topN } },
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

  async createGame(mode: GameMode, settings: GameSettings, locks: LockRecord[]): Promise<GameRecord> {
    // Nested create => the game and its locks are inserted in a single transaction.
    return this.db.game.create({
      data: {
        mode,
        ...settings,
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
    // Deliberately selects only the player-season: never the locked game log.
    const rows = await this.db.gamePlayer.findMany({
      where: { gameId },
      select: { playerSeason: { include: { player: true } } },
      orderBy: { playerSeasonId: 'asc' },
    });
    return rows.map(({ playerSeason: ps }) => ({
      id: ps.id,
      playerId: ps.playerId,
      name: ps.player.name,
      season: ps.season,
      team: ps.team,
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
