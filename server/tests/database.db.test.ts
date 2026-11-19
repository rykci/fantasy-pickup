// Integration tests against real Postgres (docker compose + migrations + ingested data).
// Run with: npm run test:db
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNIVERSE_TOP_N_PER_SEASON } from '../src/domain/pool.js';
import { createPrismaGameRepository } from '../src/repo/prismaGameRepository.js';
import { GameService } from '../src/services/gameService.js';

const prisma = new PrismaClient();
const service = new GameService(createPrismaGameRepository(prisma));
const createdGameIds: number[] = [];

beforeAll(async () => {
  const ranked = await prisma.playerSeason.count({ where: { seasonRank: { lte: UNIVERSE_TOP_N_PER_SEASON } } });
  if (ranked < 200) throw new Error('Load the data first: python ingestion/ingest.py');
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: { in: createdGameIds } } });
  await prisma.$disconnect();
});

async function newGame(mode: 'vs_cpu' | 'pass_and_play' = 'pass_and_play', settings = {}) {
  const s = await service.createGame(mode, settings);
  createdGameIds.push(s.id);
  return s;
}

describe('database invariants', () => {
  it('pool comes from the top-N universe; each locked game belongs to its player-season', async () => {
    const { id } = await newGame('pass_and_play', { poolSize: 40 });
    const rows = await prisma.gamePlayer.findMany({
      where: { gameId: id },
      include: { lockedGameLog: true, playerSeason: true },
    });
    expect(rows).toHaveLength(40);
    for (const r of rows) {
      expect(r.lockedGameLog.playerSeasonId).toBe(r.playerSeasonId);
      expect(r.playerSeason.seasonRank).toBeLessThanOrEqual(UNIVERSE_TOP_N_PER_SEASON);
    }
  });

  it("a player's team is the team of their locked game (right for traded players)", async () => {
    const { id, available } = await newGame('pass_and_play', { poolSize: 200 });
    const rows = await prisma.gamePlayer.findMany({ where: { gameId: id }, include: { lockedGameLog: true } });
    const byPs = new Map(rows.map((r) => [r.playerSeasonId, r.lockedGameLog.team]));
    for (const p of available) expect(p.team).toBe(byPs.get(p.id));
  });

  it('game clues match each locked game, without exposing its stats', async () => {
    const { id, available } = await newGame('pass_and_play', { showGameDate: true });
    const rows = await prisma.gamePlayer.findMany({ where: { gameId: id }, include: { lockedGameLog: true } });
    const byPs = new Map(rows.map((r) => [r.playerSeasonId, r.lockedGameLog]));
    for (const p of available) {
      const g = byPs.get(p.id)!;
      expect(p.gameClue).toEqual({
        gameDate: g.gameDate.toISOString().slice(0, 10),
        opponent: g.opponent,
        isHome: g.isHome,
      });
      expect(p.averages).toBeNull();
    }
  });

  it('uniquePlayers: no player appears twice in the pool', async () => {
    const { available } = await newGame('pass_and_play', { poolSize: 200, uniquePlayers: true });
    expect(new Set(available.map((p) => p.playerId)).size).toBe(200);
  });

  it('trigger blocks changing a locked game', async () => {
    const { id } = await newGame();
    const row = await prisma.gamePlayer.findFirstOrThrow({ where: { gameId: id } });
    const other = await prisma.gameLog.findFirstOrThrow({
      where: { playerSeasonId: row.playerSeasonId, id: { not: row.lockedGameLogId } },
    });
    await expect(
      prisma.gamePlayer.update({
        where: { gameId_playerSeasonId: { gameId: id, playerSeasonId: row.playerSeasonId } },
        data: { lockedGameLogId: other.id },
      }),
    ).rejects.toThrow(/immutable/);
  });

  it('trigger blocks editing the stats of a locked game log', async () => {
    const { id } = await newGame();
    const row = await prisma.gamePlayer.findFirstOrThrow({ where: { gameId: id } });
    await expect(
      prisma.gameLog.update({ where: { id: row.lockedGameLogId }, data: { pts: { increment: 50 } } }),
    ).rejects.toThrow(/immutable/);
  });

  it('CHECK constraint enforces snake order even if the API is bypassed', async () => {
    const { id, available } = await newGame();
    await expect(
      prisma.draftPick.create({ data: { gameId: id, pickNumber: 1, team: 'B', playerSeasonId: available[0].id } }),
    ).rejects.toThrow();
  });

  it('trigger rejects picks past the end of the draft for that game’s roster size', async () => {
    const { id, available } = await newGame('pass_and_play', { poolSize: 6, rosterSize: 2 });
    // Pick 5 would be valid in a 5-round draft but this draft has only 4 picks. (5 is A in snake order.)
    await expect(
      prisma.draftPick.create({ data: { gameId: id, pickNumber: 5, team: 'A', playerSeasonId: available[0].id } }),
    ).rejects.toThrow(/past the end of the draft/);
    await prisma.draftPick.create({ data: { gameId: id, pickNumber: 4, team: 'A', playerSeasonId: available[0].id } });
  });

  it('CHECK constraint rejects invalid game settings', async () => {
    await expect(
      prisma.game.create({ data: { mode: 'vs_cpu', poolSize: 9, rosterSize: 5, uniquePlayers: false } }),
    ).rejects.toThrow();
    await expect(
      prisma.game.create({ data: { mode: 'vs_cpu', poolSize: 40, rosterSize: 14, uniquePlayers: false } }),
    ).rejects.toThrow();
  });

  it('unique constraint blocks drafting the same player-season twice', async () => {
    const { id, available } = await newGame();
    const playerSeasonId = available[0].id;
    await prisma.draftPick.create({ data: { gameId: id, pickNumber: 1, team: 'A', playerSeasonId } });
    await expect(
      prisma.draftPick.create({ data: { gameId: id, pickNumber: 2, team: 'B', playerSeasonId } }),
    ).rejects.toThrow();
  });
});

describe('full game through the Prisma repository', () => {
  it('vs_cpu: draft, reveal, lock unchanged', async () => {
    const { id } = await newGame('vs_cpu', { poolSize: 30, rosterSize: 7 });
    const before = await prisma.gamePlayer.findMany({ where: { gameId: id }, orderBy: { playerSeasonId: 'asc' } });

    let state = await service.getState(id);
    while (state.currentTurn) state = (await service.makePick(id, { playerSeasonId: state.available[0].id })).state;
    expect(state.picks).toHaveLength(14);

    const reveal = await service.reveal(id);
    expect(reveal.categories).toHaveLength(9);
    const after = await prisma.gamePlayer.findMany({ where: { gameId: id }, orderBy: { playerSeasonId: 'asc' } });
    expect(after).toEqual(before);

    const game = await prisma.game.findUniqueOrThrow({ where: { id } });
    expect(game.status).toBe('revealed');
    expect(game.winner).toBe(reveal.winner);
    expect([game.scoreA, game.scoreB]).toEqual([reveal.score.A, reveal.score.B]);
  });

  it('concurrent picks for the same slot: exactly one succeeds', async () => {
    const { id, available } = await newGame('pass_and_play');
    const results = await Promise.allSettled([
      service.makePick(id, { playerSeasonId: available[0].id, team: 'A' }),
      service.makePick(id, { playerSeasonId: available[1].id, team: 'A' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.draftPick.count({ where: { gameId: id } })).toBe(1);
  });
});
