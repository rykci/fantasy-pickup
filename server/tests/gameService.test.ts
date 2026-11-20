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
  service = new GameService(repo, seededRng(123), () => 'A');
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
  it('uses the default settings: 15-player pool, 5 per team', async () => {
    const state = await service.createGame('vs_cpu');
    expect(state.settings).toEqual({
      poolSize: 15,
      rosterSize: 5,
      uniquePlayers: true,
      fromSeason: 1983,
      toSeason: 2025,
      showSeasonTeam: false,
      showGameDate: false,
      showAverages: false,
    });
    expect(state.totalPicks).toBe(10);
    expect(state.available).toHaveLength(15);
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
    const svc = new GameService(r, seededRng(5), () => 'A');
    const s = await svc.createGame('vs_cpu', { poolSize: 20, uniquePlayers: true });
    expect(new Set(s.available.map((p) => p.playerId)).size).toBe(20);
    await expect(svc.createGame('vs_cpu', { poolSize: 21, uniquePlayers: true })).rejects.toMatchObject({
      status: 400,
      code: 'POOL_TOO_LARGE',
    });
  });

  it('season range: the pool only comes from those seasons', async () => {
    // The test universe has one player-season per year from 1990-91 (60 players over 30 seasons: 2 a year).
    const s = await service.createGame('vs_cpu', { fromSeason: 1995, toSeason: 1999, poolSize: 10, rosterSize: 5 });
    const { players } = makeUniverse(60);
    const seasonOf = new Map(players.map((p) => [p.id, Number(p.season.slice(0, 4))]));
    const years = s.available.map((p) => seasonOf.get(p.id)!);
    expect(years).toHaveLength(10);
    expect(Math.min(...years)).toBeGreaterThanOrEqual(1995);
    expect(Math.max(...years)).toBeLessThanOrEqual(1999);
    expect(s.settings).toMatchObject({ fromSeason: 1995, toSeason: 1999 });
  });

  it('season range: a clear message when the seasons are too narrow for the pool', async () => {
    await expect(service.createGame('vs_cpu', { fromSeason: 1995, toSeason: 1995, poolSize: 4, rosterSize: 2 })).rejects.toMatchObject({
      code: 'POOL_TOO_LARGE',
      message: 'Only 2 different players in 1995-96. Lower the pool size or widen the seasons.',
    });
    await expect(service.createGame('vs_cpu', { fromSeason: 2000, toSeason: 1999 })).rejects.toBeInstanceOf(SettingsError);
    await expect(service.createGame('vs_cpu', { fromSeason: 1982 })).rejects.toBeInstanceOf(SettingsError);
    await expect(service.createGame('vs_cpu', { toSeason: 2026 })).rejects.toBeInstanceOf(SettingsError);
  });

  it('refuses to start without loaded data', async () => {
    const empty = new GameService(new InMemoryGameRepository([], []), seededRng(), () => 'A');
    await expect(empty.createGame('vs_cpu')).rejects.toMatchObject({ status: 503, code: 'POOL_NOT_SEEDED' });
  });
});

describe('draft visibility (ball-knowledge settings)', () => {
  const hiddenKeys = /"pts"|"reb"|"fgPct"|"gamesPlayed"|"minutes"/;

  it('defaults: names only, one season per player; no season, team, averages, VAL or clue', async () => {
    const s = await service.createGame('pass_and_play');
    expect(s.settings).toMatchObject({ uniquePlayers: true, showSeasonTeam: false, showGameDate: false, showAverages: false });
    expect(new Set(s.available.map((p) => p.playerId)).size).toBe(s.available.length);
    for (const p of s.available) {
      expect(p.season).toBeNull();
      expect(p.team).toBeNull();
      expect(p.averages).toBeNull();
      expect(p.value).toBeNull();
      expect(p.gameClue).toBeNull();
    }
    expect(JSON.stringify(s)).not.toMatch(hiddenKeys);
  });

  it('hidden season and team stay hidden in picks and rosters', async () => {
    const s = await service.createGame('pass_and_play');
    const r = await service.makePick(s.id, { playerSeasonId: s.available[0].id, team: 'A' });
    expect(r.state.picks[0].season).toBeNull();
    expect(r.state.rosters.A[0]).toMatchObject({ season: null, team: null });
  });

  it('can show season and team', async () => {
    const s = await service.createGame('pass_and_play', { showSeasonTeam: true });
    for (const p of s.available) {
      expect(p.season).toMatch(/^\d{4}-\d{2}$/);
      expect(p.team).toBeTruthy();
    }
  });

  it("doesn't leak the ranking or seasons through the board order", async () => {
    const { players, logs } = makeUniverse(60, { seasonsPerPlayer: 3 }); // same names, different seasons
    for (const p of players) p.name = `Player ${p.playerId}`;
    const svc = new GameService(new InMemoryGameRepository(players, logs), seededRng(8), () => 'A');
    const s = await svc.createGame('pass_and_play', { poolSize: 40, uniquePlayers: false });
    const names = s.available.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    // Within a name, entries aren't simply in id (= season/rank) order every time.
    const byName = new Map<string, number[]>();
    for (const p of s.available) byName.set(p.name, [...(byName.get(p.name) ?? []), p.id]);
    const runs = [...byName.values()].filter((ids) => ids.length > 1);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.some((ids) => ids.join() !== [...ids].sort((a, b) => a - b).join())).toBe(true);
  });

  it('can show the locked game date and opponent as a clue, never its stats', async () => {
    const s = await service.createGame('pass_and_play', { showGameDate: true });
    const locks = new Map((await repo.listLocks(s.id)).map((l) => [l.playerSeasonId, l.lockedGameLogId]));
    for (const p of s.available) {
      const log = repo.logs.find((g) => g.gameLogId === locks.get(p.id))!;
      expect(p.gameClue).toEqual({ gameDate: log.gameDate, opponent: log.opponent, isHome: log.isHome });
    }
    const json = JSON.stringify(s);
    expect(json).not.toMatch(hiddenKeys);
    for (const id of locks.values()) expect(json).not.toContain(`:${id},`);
  });

  it('can show season averages and VAL, best value first', async () => {
    const s = await service.createGame('vs_cpu', { showAverages: true });
    expect(s.available.every((p) => p.averages !== null && p.value !== null)).toBe(true);
    const values = s.available.map((p) => p.value!);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('the CPU drafts by value even when nothing is shown', async () => {
    const s = await service.createGame('vs_cpu', { showSeasonTeam: false });
    const first = s.available[0].id;
    const r = await service.makePick(s.id, { playerSeasonId: first });
    const pool = await repo.listPool(s.id);
    const best = [...pool].sort((a, b) => b.averages.pts - a.averages.pts).filter((p) => p.id !== first);
    expect(r.autoPicks.map((p) => p.playerSeasonId)).toEqual([best[0].id, best[1].id]);
  });

  it('the reveal, and the state after it, show everything', async () => {
    const { id } = await service.createGame('pass_and_play', { showSeasonTeam: false, showGameDate: true });
    await draftAllPassAndPlay(id);
    const r = await service.reveal(id);
    for (const p of [...r.teams.A.players, ...r.teams.B.players]) {
      expect(p.averages.pts).toEqual(expect.any(Number));
      expect(p.season).toBeTruthy();
    }
    const after = await service.getState(id);
    expect(after.rosters.A.every((p) => p.averages !== null && p.season !== null && p.gameClue === null)).toBe(true);
  });

  it('the reveal also shows every undrafted player with their own chosen game', async () => {
    const { id } = await service.createGame('pass_and_play', { poolSize: 16, rosterSize: 4 });
    await draftAllPassAndPlay(id);
    const r = await service.reveal(id);
    expect(r.undrafted).toHaveLength(8);
    const drafted = new Set([...r.teams.A.players, ...r.teams.B.players].map((p) => p.id));
    const locks = new Map((await repo.listLocks(id)).map((l) => [l.playerSeasonId, l.lockedGameLogId]));
    for (const p of r.undrafted) {
      expect(drafted.has(p.id)).toBe(false);
      expect(p.lockedGame.gameLogId).toBe(locks.get(p.id));
      expect(p.averages.pts).toEqual(expect.any(Number));
    }
    const values = r.undrafted.map((p) => p.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    // Undrafted games don't count toward either team.
    expect(r.teams.A.players).toHaveLength(4);
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

describe('coin flip', () => {
  const { players, logs } = makeUniverse(60);
  it('when the CPU wins it, the CPU has already made pick 1 when the game is created', async () => {
    const svc = new GameService(new InMemoryGameRepository(players, logs), seededRng(3), () => 'B');
    const s = await svc.createGame('vs_cpu', { showAverages: true });
    expect(s.firstTeam).toBe('B');
    expect(s.picks).toEqual([expect.objectContaining({ pickNumber: 1, team: 'B' })]);
    expect(s.currentTurn).toMatchObject({ pickNumber: 2, team: 'A' });
    expect(s.draftOrder.map((d) => d.team).join('')).toBe('BAABBAABBA');
    // You then get two in a row (picks 2 and 3), and the CPU answers with 4 and 5.
    const r1 = await svc.makePick(s.id, { playerSeasonId: s.available[0].id });
    expect(r1.autoPicks).toHaveLength(0);
    const r2 = await svc.makePick(s.id, { playerSeasonId: r1.state.available[0].id });
    expect(r2.autoPicks.map((p) => p.pickNumber)).toEqual([4, 5]);
  });

  it('pass-and-play: Player 2 can win it', async () => {
    const svc = new GameService(new InMemoryGameRepository(players, logs), seededRng(3), () => 'B');
    const s = await svc.createGame('pass_and_play');
    expect(s.picks).toHaveLength(0);
    expect(s.currentTurn).toMatchObject({ pickNumber: 1, team: 'B', label: 'Player 2' });
    await expect(svc.makePick(s.id, { playerSeasonId: s.available[0].id, team: 'A' })).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
  });

  it('is a fair coin by default', async () => {
    const svc = new GameService(new InMemoryGameRepository(players, logs), seededRng(11));
    const firsts = new Set<string>();
    for (let i = 0; i < 20; i++) firsts.add((await svc.createGame('pass_and_play')).firstTeam);
    expect(firsts).toEqual(new Set(['A', 'B']));
  });
});

describe('vs CPU draft', () => {
  it('CPU auto-picks after the user until it is the user’s turn again', async () => {
    const s = await service.createGame('vs_cpu', { showAverages: true });
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
