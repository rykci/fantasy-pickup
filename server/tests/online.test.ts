import { beforeEach, describe, expect, it } from 'vitest';
import { GameService, ONLINE, hashToken } from '../src/services/gameService.js';
import { makeUniverse, seededRng } from './support/fixtures.js';
import { InMemoryGameRepository } from './support/inMemoryRepository.js';

let repo: InMemoryGameRepository;
let service: GameService;
let clock: number;
const at = (ms: number) => {
  clock = ms;
};
const T0 = Date.UTC(2026, 10, 20, 20, 0, 0);

beforeEach(() => {
  const { players, logs } = makeUniverse(60);
  repo = new InMemoryGameRepository(players, logs);
  clock = T0;
  service = new GameService(repo, seededRng(7), () => 'A', () => new Date(clock));
});

/** Host creates, friend joins, host starts, and the coin flip finishes. */
async function startedGame(opts: { pickSeconds?: number | null; rosterSize?: number } = {}) {
  const host = await service.createOnlineGame('Ricky', { rosterSize: opts.rosterSize ?? 2, poolSize: 8 }, opts.pickSeconds ?? null);
  const guest = await service.joinGame(host.state.online!.roomCode, 'Sam');
  await service.startGame(host.gameId, host.token);
  at(T0 + ONLINE.FIRST_TURN_LEAD_MS);
  return { id: host.gameId, host: host.token, guest: guest.token };
}

describe('online rooms', () => {
  it('creates a lobby with a room code; the host holds Team A', async () => {
    const g = await service.createOnlineGame('Ricky', {}, 60);
    expect(g.team).toBe('A');
    expect(g.state.status).toBe('lobby');
    expect(g.state.online).toMatchObject({
      roomCode: expect.stringMatching(/^[A-HJKMNP-Z2-9]{4}$/),
      you: 'A',
      pickSeconds: 60,
      seats: { A: { name: 'Ricky', connected: true }, B: null },
    });
    expect(g.state.teamLabels).toEqual({ A: 'Ricky', B: 'Waiting…' });
    // Only the hash is stored, and nothing token-like is sent back in the state.
    expect(repo.seats.get(g.gameId)![0].tokenHash).toBe(hashToken(g.token));
    expect(JSON.stringify(g.state)).not.toContain(g.token);
    expect(JSON.stringify(g.state)).not.toContain(hashToken(g.token));
  });

  it('a friend joins by code (any case) and takes Team B; a third person cannot', async () => {
    const g = await service.createOnlineGame('Ricky');
    const code = g.state.online!.roomCode;
    const sam = await service.joinGame(code.toLowerCase(), '  Sam  ');
    expect(sam).toMatchObject({ gameId: g.gameId, team: 'B' });
    expect(sam.state.online!.you).toBe('B');
    expect(sam.state.teamLabels).toEqual({ A: 'Ricky', B: 'Sam' });
    await expect(service.joinGame(code, 'Alex')).rejects.toMatchObject({ code: 'ROOM_FULL' });
    await expect(service.joinGame('ZZZZ', 'Alex')).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
  });

  it('rejects bad names and pick clocks', async () => {
    await expect(service.createOnlineGame('   ')).rejects.toMatchObject({ code: 'INVALID_NAME' });
    await expect(service.createOnlineGame('x'.repeat(21))).rejects.toMatchObject({ code: 'INVALID_NAME' });
    await expect(service.createOnlineGame('Ricky', {}, 45)).rejects.toMatchObject({ code: 'INVALID_SETTINGS' });
  });

  it('only the host starts, and only once the friend is in', async () => {
    const g = await service.createOnlineGame('Ricky');
    await expect(service.startGame(g.gameId, g.token)).rejects.toMatchObject({ code: 'WAITING_FOR_OPPONENT' });
    const sam = await service.joinGame(g.state.online!.roomCode, 'Sam');
    await expect(service.startGame(g.gameId, sam.token)).rejects.toMatchObject({ code: 'NOT_HOST' });
    await expect(service.startGame(g.gameId, undefined)).rejects.toMatchObject({ code: 'NOT_HOST' });
    const s = await service.startGame(g.gameId, g.token);
    expect(s.status).toBe('drafting');
    // Both screens play the flip at the same time, then the first turn opens.
    expect(s.online!.flipAt).toBe(new Date(T0 + ONLINE.FLIP_LEAD_MS).toISOString());
    expect(s.online!.turnStartedAt).toBe(new Date(T0 + ONLINE.FIRST_TURN_LEAD_MS).toISOString());
    await expect(service.startGame(g.gameId, g.token)).rejects.toMatchObject({ code: 'ALREADY_STARTED' });
    await expect(service.joinGame(g.state.online!.roomCode, 'Alex')).rejects.toMatchObject({ code: 'ALREADY_STARTED' });
  });

  it('marks players connected while they keep polling', async () => {
    const g = await service.createOnlineGame('Ricky');
    const sam = await service.joinGame(g.state.online!.roomCode, 'Sam');
    at(T0 + ONLINE.CONNECTED_MS + 1000);
    const s = await service.getState(g.gameId, g.token);
    expect(s.online!.seats.A!.connected).toBe(true); // just polled
    expect(s.online!.seats.B!.connected).toBe(false); // Sam went quiet
    await service.getState(g.gameId, sam.token);
    expect((await service.getState(g.gameId)).online!.seats.B!.connected).toBe(true);
  });
});

describe('online draft', () => {
  it('picks need your token and your turn; nobody can pick before the coin lands', async () => {
    const host = await service.createOnlineGame('Ricky', { rosterSize: 2, poolSize: 8 });
    const sam = await service.joinGame(host.state.online!.roomCode, 'Sam');
    const ps = host.state.available[0].id;
    await expect(service.makePick(host.gameId, { playerSeasonId: ps }, host.token)).rejects.toMatchObject({
      code: 'NOT_STARTED',
    });
    await service.startGame(host.gameId, host.token);
    await expect(service.makePick(host.gameId, { playerSeasonId: ps }, host.token)).rejects.toMatchObject({
      code: 'NOT_STARTED',
    });
    at(T0 + ONLINE.FIRST_TURN_LEAD_MS);
    await expect(service.makePick(host.gameId, { playerSeasonId: ps })).rejects.toMatchObject({ code: 'NOT_A_PLAYER' });
    await expect(service.makePick(host.gameId, { playerSeasonId: ps }, sam.token)).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
    // Claiming the other team doesn't work either.
    await expect(service.makePick(host.gameId, { playerSeasonId: ps, team: 'B' }, host.token)).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
    const r = await service.makePick(host.gameId, { playerSeasonId: ps }, host.token);
    expect(r.state.picks[0]).toMatchObject({ pickNumber: 1, team: 'A' });
    expect(r.state.currentTurn).toMatchObject({ team: 'B', label: 'Sam' });
  });

  it('when the last pick is made, the reveal is scheduled for both screens', async () => {
    const { id, host, guest } = await startedGame();
    let s = await service.getState(id, host);
    for (const token of [host, guest, guest, host]) {
      s = (await service.makePick(id, { playerSeasonId: s.available[0].id }, token)).state;
    }
    expect(s.status).toBe('draft_complete');
    expect(s.online!.revealStartedAt).toBe(new Date(clock + ONLINE.REVEAL_LEAD_MS).toISOString());
    const r = await service.reveal(id);
    expect(r.teamLabels).toEqual({ A: 'Ricky', B: 'Sam' });
    expect(r.winnerLabel).toMatch(/Ricky|Sam|Draw/);
  });
});

describe('pick clock', () => {
  it('auto-picks the best available player when time runs out, and the next clock starts then', async () => {
    const { id, host } = await startedGame({ pickSeconds: 30 });
    const turn1 = T0 + ONLINE.FIRST_TURN_LEAD_MS;
    let s = await service.getState(id, host);
    expect(s.online!.turnDeadline).toBe(new Date(turn1 + 30_000).toISOString());

    at(turn1 + 29_000);
    expect((await service.getState(id)).picks).toHaveLength(0);

    // 45 s in: Ricky's turn ran out at 30 s; Sam's clock started then and has 15 s left.
    at(turn1 + 45_000);
    s = await service.getState(id);
    expect(s.picks).toHaveLength(1);
    expect(s.picks[0].team).toBe('A');
    expect(s.online!.turnDeadline).toBe(new Date(turn1 + 60_000).toISOString());
  });

  it('a pick resets the clock; overdue turns are filled before a late pick is checked', async () => {
    const { id, host, guest } = await startedGame({ pickSeconds: 30 });
    const turn1 = T0 + ONLINE.FIRST_TURN_LEAD_MS;
    at(turn1 + 10_000);
    let s = await service.getState(id, host);
    s = (await service.makePick(id, { playerSeasonId: s.available[0].id }, host)).state;
    expect(s.online!.turnDeadline).toBe(new Date(turn1 + 40_000).toISOString());

    // Sam's time ran out (40 s), then Sam's second snake pick ran out too (70 s): Sam's late pick is refused.
    at(turn1 + 75_000);
    await expect(service.makePick(id, { playerSeasonId: s.available[0].id }, guest)).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
    s = await service.getState(id);
    expect(s.picks.map((p) => p.team)).toEqual(['A', 'B', 'B']);
  });

  it('if both players leave, the whole draft fills itself in and the reveal is scheduled', async () => {
    const { id } = await startedGame({ pickSeconds: 30, rosterSize: 2 });
    at(T0 + 10 * 60_000);
    const s = await service.getState(id);
    expect(s.picks).toHaveLength(4);
    expect(s.status).toBe('draft_complete');
    expect(s.online!.revealStartedAt).not.toBeNull();
  });

  it('no clock: nothing is ever auto-picked', async () => {
    const { id } = await startedGame({ pickSeconds: null });
    at(T0 + 60 * 60_000);
    const s = await service.getState(id);
    expect(s.picks).toHaveLength(0);
    expect(s.online!.turnDeadline).toBeNull();
  });
});

describe('rematch and expiry', () => {
  async function finishedGame() {
    const g = await startedGame();
    let s = await service.getState(g.id, g.host);
    for (const token of [g.host, g.guest, g.guest, g.host]) {
      s = (await service.makePick(g.id, { playerSeasonId: s.available[0].id }, token)).state;
    }
    return g;
  }

  it('when both say yes, the rematch starts right away with the same players and settings', async () => {
    const g = await finishedGame();
    expect(await service.rematch(g.id, g.host)).toEqual({ gameId: null });
    let s = await service.getState(g.id, g.guest);
    expect(s.online!.rematch).toEqual({ A: true, B: null }); // Sam sees "Ricky wants a rematch"
    expect(s.online!.rematchGameId).toBeNull();

    const { gameId } = await service.rematch(g.id, g.guest);
    expect(gameId).not.toBeNull();
    expect((await service.getState(g.id)).online!.rematchGameId).toBe(gameId);
    // Asking again (e.g. a late click) lands in the same game.
    expect(await service.rematch(g.id, g.host)).toEqual({ gameId });

    s = await service.getState(gameId!, g.guest);
    expect(s.status).toBe('drafting'); // no lobby: straight to the coin flip
    expect(s.online!.you).toBe('B'); // same token, same seat
    expect(s.teamLabels).toEqual({ A: 'Ricky', B: 'Sam' });
    expect(s.settings).toMatchObject({ rosterSize: 2, poolSize: 8 });
    expect(s.online!.flipAt).toBe(new Date(clock + ONLINE.FLIP_LEAD_MS).toISOString());
    expect(s.online!.turnStartedAt).toBe(new Date(clock + ONLINE.FIRST_TURN_LEAD_MS).toISOString());
    expect(s.online!.rematch).toEqual({ A: null, B: null });
  });

  it('no means no, until the other player asks again', async () => {
    const g = await finishedGame();
    await service.rematch(g.id, g.host);
    expect(await service.rematch(g.id, g.guest, false)).toEqual({ gameId: null });
    expect((await service.getState(g.id)).online!.rematch).toEqual({ A: true, B: false });

    // Ricky asks again: Sam's answer is cleared, so Sam is asked again.
    await service.rematch(g.id, g.host);
    expect((await service.getState(g.id)).online!.rematch).toEqual({ A: true, B: null });

    // Ricky leaves (counts as no); then Sam asking doesn't start anything.
    await service.rematch(g.id, g.host, false);
    expect(await service.rematch(g.id, g.guest)).toEqual({ gameId: null });
    expect((await service.getState(g.id)).online!.rematchGameId).toBeNull();
  });

  it('rematch needs a finished game and a player', async () => {
    const g = await startedGame();
    await expect(service.rematch(g.id, g.host)).rejects.toMatchObject({ code: 'NOT_FINISHED' });
    await expect(service.rematch(g.id, 'nope')).rejects.toMatchObject({ code: 'NOT_A_PLAYER' });
  });

  it('games expire after 24 hours without activity', async () => {
    const g = await service.createOnlineGame('Ricky');
    at(T0 + ONLINE.EXPIRE_MS + 1);
    expect((await service.getState(g.gameId)).online!.expired).toBe(true);
    await expect(service.joinGame(g.state.online!.roomCode, 'Sam')).rejects.toMatchObject({ code: 'GAME_EXPIRED' });
  });
});
