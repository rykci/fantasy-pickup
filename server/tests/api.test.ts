import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { GameService } from '../src/services/gameService.js';
import { makeUniverse, seededRng } from './support/fixtures.js';
import { InMemoryGameRepository } from './support/inMemoryRepository.js';

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const { players, logs } = makeUniverse(60);
  app = createApp(new GameService(new InMemoryGameRepository(players, logs), seededRng(1)));
});

describe('REST API', () => {
  it('validates the create body', async () => {
    await request(app).post('/api/games').send({ mode: 'online' }).expect(400);
    await request(app).post('/api/games').send({}).expect(400);
    await request(app).post('/api/games').send({ mode: 'vs_cpu', poolSize: 'big' }).expect(400);
    const tooSmall = await request(app).post('/api/games').send({ mode: 'vs_cpu', poolSize: 6, rosterSize: 5 }).expect(400);
    expect(tooSmall.body.error.code).toBe('INVALID_SETTINGS');
  });

  it('accepts custom settings', async () => {
    const res = await request(app)
      .post('/api/games')
      .send({ mode: 'pass_and_play', poolSize: 12, rosterSize: 4, uniquePlayers: true })
      .expect(201);
    expect(res.body.settings).toEqual({ poolSize: 12, rosterSize: 4, uniquePlayers: true });
    expect(res.body.available).toHaveLength(12);
    expect(res.body.draftOrder).toHaveLength(8);
  });

  it('runs a vs_cpu game end to end with server-side rule enforcement', async () => {
    const created = await request(app).post('/api/games').send({ mode: 'vs_cpu' }).expect(201);
    const id = created.body.id;
    const first = created.body.available[0].id;

    await request(app).post(`/api/games/${id}/reveal`).expect(409);
    await request(app).post(`/api/games/${id}/picks`).send({ playerSeasonId: 'x' }).expect(400);
    await request(app).post(`/api/games/${id}/picks`).send({ playerSeasonId: 999999 }).expect(400);

    const r1 = await request(app).post(`/api/games/${id}/picks`).send({ playerSeasonId: first }).expect(201);
    expect(r1.body.autoPicks).toHaveLength(2);

    const dup = await request(app).post(`/api/games/${id}/picks`).send({ playerSeasonId: first }).expect(409);
    expect(dup.body.error.code).toBe('PLAYER_ALREADY_DRAFTED');

    let state = r1.body.state;
    while (state.currentTurn) {
      state = (
        await request(app).post(`/api/games/${id}/picks`).send({ playerSeasonId: state.available[0].id }).expect(201)
      ).body.state;
    }
    const reveal = await request(app).post(`/api/games/${id}/reveal`).expect(200);
    expect(reveal.body.categories.map((c: { label: string }) => c.label)).toEqual([
      'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO',
    ]);
    expect(['A', 'B', 'draw']).toContain(reveal.body.winner);
  });

  it('returns 404 / 400 for unknown or malformed game ids', async () => {
    await request(app).get('/api/games/12345').expect(404);
    await request(app).get('/api/games/abc').expect(400);
  });
});
