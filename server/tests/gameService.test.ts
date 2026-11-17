import { beforeEach, describe, expect, it } from 'vitest';
import { DraftRuleError, SettingsError } from '../src/domain/draft.js';
import { HttpError } from '../src/errors.js';
import { GameService } from '../src/services/gameService.js';
import { makeUniverse, seededRng } from './support/fixtures.js';
import { InMemoryGameRepository } from './support/inMemoryRepository.js';

let repo: InMemoryGameRepository;
let service: GameService;

/** Universe of 60 player-seasons. */
beforeEach(() => {
  const { players, logs } = makeUniverse(60);
  repo = new InMemoryGameRepository(players, logs);
  service = new GameService(repo, seededRng(123));
});

/** Pass-and-play: each turn takes the top of the board. */
async function draftAllPassAndPlay(gameId: number) {
  let s = await service.getState(gameId);
  while (s.currentTurn) {
    s = (await service.makePick(gameId, { playerSeasonId: s.available[0].id, team: s.currentTurn.team })).state;
  }
  return s;
}

describe('createGame', () => {
  it('uses the default settings: 24-player pool, 5 per team', async () => {
    const state = await service.createGame('vs_cpu');
    expect(state.settings).toEqual({ poolSize: 24, rosterSize: 5, uniquePlayers: false });
    expect(state.totalPicks).toBe(10);
    expect(state.available).toHaveLength(24);
    expect(state.currentTurn).toMatchObject({ pickNumber: 1, team: 'A' });
  });

  it('samples the pool from the universe and locks one of each player-season’s own games', async () => {
    const state = await service.createGame('vs_cpu', { poolSize: 30 });
    const locks = await repo.listLocks(state.id);
    expect(locks).toHaveLength(30);
    expect(new Set(locks.map((l) => l.playerSeasonId))).toEqual(new Set(state.available.map((p) => p.id)));
    for (const l of locks) {
      const log = repo.logs.find((g) => g.gameLogId === l.lockedGameLogId)!;
      expect(log.playerSeasonId).toBe(l.playerSeasonId);
    }
  });

  it('draws a different pool each game', async () => {
    const a = await service.createGame('vs_cpu');
    const b = await service.createGame('vs_cpu');
    expect(a.available.map((p) => p.id).sort()).not.toEqual(b.available.map((p) => p.id).sort());
  });

  it('honours custom pool and team sizes', async () => {
    const { id } = await service.createGame('pass_and_play', { poolSize: 8, rosterSize: 3 });
    const s = await draftAllPassAndPlay(id);
    expect(s.picks.map((p) => p.team).join('')).toBe('ABBAAB');
    expect(s.rosters.A).toHaveLength(3);
    expect(s.available).toHaveLength(2);
    expect(s.status).toBe('draft_complete');
  });

  it('rejects invalid settings', async () => {
    await expect(service.createGame('vs_cpu', { rosterSize: 14 })).rejects.toBeInstanceOf(SettingsError);
    await expect(service.createGame('vs_cpu', { poolSize: 9, rosterSize: 5 })).rejects.toBeInstanceOf(SettingsError);
  });

  it('uniquePlayers: one season per player', async () => {
    const { players, logs } = makeUniverse(60, { seasonsPerPlayer: 3 }); // 20 players
    const r = new InMemoryGameRepository(players, logs);
    const svc = new GameService(r, seededRng(5));
    const s = await svc.createGame('vs_cpu', { poolSize: 20, uniquePlayers: true });
    expect(new Set(s.available.map((p) => p.playerId)).size).toBe(20);
    await expect(svc.createGame('vs_cpu', { poolSize: 21, uniquePlayers: true })).rejects.toMatchObject({
      status: 400,
      code: 'POOL_TOO_LARGE',
    });
  });

  it('refuses to start without loaded data', async () => {
    const empty = new GameService(new InMemoryGameRepository([], []), seededRng());
    await expect(empty.createGame('vs_cpu')).rejects.toMatchObject({ status: 503, code: 'POOL_NOT_SEEDED' });
  });
});

describe('locked game', () => {
  it('never changes through the draft and reveal', async () => {
    const { id } = await service.createGame('pass_and_play');
    const before = await repo.listLocks(id);

    await draftAllPassAndPlay(id);
    expect(await repo.listLocks(id)).toEqual(before);

    const r1 = await service.reveal(id);
    const r2 = await service.reveal(id);
    expect(await repo.listLocks(id)).toEqual(before);
    expect(r2).toEqual(r1); // revealing again is idempotent

    const lockById = new Map(before.map((l) => [l.playerSeasonId, l.lockedGameLogId]));
    for (const p of [...r1.teams.A.players, ...r1.teams.B.players]) {
      expect(p.lockedGame.gameLogId).toBe(lockById.get(p.id));
    }
  });

  it('is never exposed by the game state', async () => {
    const { id } = await service.createGame('vs_cpu');
    const json = JSON.stringify(await service.getState(id));
    expect(json).not.toMatch(/locked|gameLog/i);
    for (const l of await repo.listLocks(id)) {
      expect(json).not.toContain(String(l.lockedGameLogId));
    }
  });

  it('cannot be revealed before the draft is complete', async () => {
    const s = await service.createGame('pass_and_play');
    await expect(service.reveal(s.id)).rejects.toMatchObject({ code: 'DRAFT_NOT_COMPLETE', status: 409 });
    await service.makePick(s.id, { playerSeasonId: s.available[0].id, team: 'A' });
    await expect(service.reveal(s.id)).rejects.toBeInstanceOf(HttpError);
  });
});

describe('pass-and-play draft', () => {
  it('follows snake order and completes after 2 x roster size picks', async () => {
    const { id } = await service.createGame('pass_and_play');
    const s = await draftAllPassAndPlay(id);
    expect(s.picks.map((p) => p.team).join('')).toBe('ABBAABBAAB');
    expect(s.rosters.A).toHaveLength(5);
    expect(s.rosters.B).toHaveLength(5);
    expect(s.status).toBe('draft_complete');
    expect(s.currentTurn).toBeNull();
  });

  it('rejects a pick out of turn without recording it', async () => {
    const s = await service.createGame('pass_and_play');
    await expect(service.makePick(s.id, { playerSeasonId: s.available[0].id, team: 'B' })).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
    expect(await repo.listPicks(s.id)).toHaveLength(0);
  });

  it('rejects an already-drafted player-season, and one outside the pool', async () => {
    const s = await service.createGame('pass_and_play');
    const inPool = new Set(s.available.map((p) => p.id));
    const outside = repo.players.find((p) => !inPool.has(p.id))!.id;
    await expect(service.makePick(s.id, { playerSeasonId: outside, team: 'A' })).rejects.toMatchObject({
      code: 'PLAYER_NOT_IN_POOL',
    });
    await service.makePick(s.id, { playerSeasonId: s.available[0].id, team: 'A' });
    await expect(service.makePick(s.id, { playerSeasonId: s.available[0].id, team: 'B' })).rejects.toMatchObject({
      code: 'PLAYER_ALREADY_DRAFTED',
    });
  });

  it('rejects picks after the draft is complete', async () => {
    const { id } = await service.createGame('pass_and_play');
    const s = await draftAllPassAndPlay(id);
    await expect(service.makePick(id, { playerSeasonId: s.available[0].id, team: 'B' })).rejects.toBeInstanceOf(
      DraftRuleError,
    );
  });

  it('serializes concurrent picks for the same slot', async () => {
    const s = await service.createGame('pass_and_play');
    const results = await Promise.allSettled([
      service.makePick(s.id, { playerSeasonId: s.available[0].id, team: 'A' }),
      service.makePick(s.id, { playerSeasonId: s.available[1].id, team: 'A' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await repo.listPicks(s.id)).toHaveLength(1);
  });
});

describe('vs CPU draft', () => {
  it('CPU auto-picks after the user until it is the user’s turn again', async () => {
    const s = await service.createGame('vs_cpu');
    const board = s.available; // sorted by pool value, best first
    const r1 = await service.makePick(s.id, { playerSeasonId: board.at(-1)!.id });
    expect(r1.autoPicks.map((p) => p.pickNumber)).toEqual([2, 3]);
    expect(r1.autoPicks.every((p) => p.team === 'B')).toBe(true);
    // Early rounds: CPU takes the best available value.
    expect(r1.autoPicks.map((p) => p.playerSeasonId)).toEqual([board[0].id, board[1].id]);
    expect(r1.state.currentTurn).toMatchObject({ pickNumber: 4, team: 'A' });

    const r2 = await service.makePick(s.id, { playerSeasonId: r1.state.available[0].id });
    expect(r2.autoPicks).toHaveLength(0); // pick 5 is A again
    const r3 = await service.makePick(s.id, { playerSeasonId: r2.state.available[0].id });
    expect(r3.autoPicks.map((p) => p.pickNumber)).toEqual([6, 7]);
  });

  it('completes a full game with a custom size and reveals 9 categories', async () => {
    const { id } = await service.createGame('vs_cpu', { poolSize: 20, rosterSize: 8 });
    let state = await service.getState(id);
    while (state.currentTurn) {
      state = (await service.makePick(id, { playerSeasonId: state.available.at(-1)!.id })).state;
    }
    expect(state.picks.map((p) => p.team).join('')).toBe('ABBAABBAABBAABBA');
    expect(state.status).toBe('draft_complete');

    const r = await service.reveal(id);
    expect(r.teams.A.players).toHaveLength(8);
    expect(r.teams.B.players).toHaveLength(8);
    expect(r.categories).toHaveLength(9);
    expect(r.score.A + r.score.B).toBeLessThanOrEqual(9);
    expect((await service.getState(id)).result).toEqual({ winner: r.winner, score: r.score });
  });

  it('the human cannot pick for the CPU team', async () => {
    const s = await service.createGame('vs_cpu');
    await expect(service.makePick(s.id, { playerSeasonId: s.available[0].id, team: 'B' })).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
  });
});
