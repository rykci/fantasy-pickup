import cors from 'cors';
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { DraftRuleError, SettingsError } from './domain/draft.js';
import { HttpError } from './errors.js';
import type { GameService } from './services/gameService.js';

// Settings are optional (server defaults apply); range rules live in validateSettings.
const settingsFields = {
  poolSize: z.number().int().optional(),
  rosterSize: z.number().int().optional(),
  uniquePlayers: z.boolean().optional(),
  fromSeason: z.number().int().optional(),
  toSeason: z.number().int().optional(),
  showSeasonTeam: z.boolean().optional(),
  showGameDate: z.boolean().optional(),
  showAverages: z.boolean().optional(),
};
const createGameBody = z.object({ mode: z.enum(['vs_cpu', 'pass_and_play']), ...settingsFields });
const playerName = z.string().trim().min(1).max(20);
const createOnlineBody = z.object({
  name: playerName,
  /** Pick clock in seconds, or null for none. */
  pickSeconds: z.number().int().nullable().optional(),
  ...settingsFields,
});
const joinBody = z.object({ code: z.string().trim().min(1).max(10), name: playerName });

/** Online players prove their seat with the token they got when creating or joining. */
const PLAYER_TOKEN_HEADER = 'x-player-token';
const tokenOf = (req: Request) => req.get(PLAYER_TOKEN_HEADER) || undefined;
const rematchBody = z.object({ accept: z.boolean().default(true) });

const pickBody = z.object({
  playerSeasonId: z.number().int().positive(),
  team: z.enum(['A', 'B']).optional(),
});
const gameIdParam = z.coerce.number().int().positive();

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
const route =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

function parseGameId(req: Request): number {
  const r = gameIdParam.safeParse(req.params.id);
  if (!r.success) throw new HttpError(400, 'INVALID_GAME_ID', 'Game id must be a positive integer.');
  return r.data;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, 'VALIDATION_ERROR', msg);
  }
  return r.data;
}

const DRAFT_ERROR_STATUS: Record<DraftRuleError['code'], number> = {
  DRAFT_COMPLETE: 409,
  NOT_YOUR_TURN: 409,
  PLAYER_ALREADY_DRAFTED: 409,
  PLAYER_NOT_IN_POOL: 400,
};

export function createApp(service: GameService) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    '/api/games',
    route(async (req, res) => {
      const { mode, ...settings } = parseBody(createGameBody, req.body);
      res.status(201).json(await service.createGame(mode, settings));
    }),
  );

  app.post(
    '/api/online/games',
    route(async (req, res) => {
      const { name, pickSeconds, ...settings } = parseBody(createOnlineBody, req.body);
      res.status(201).json(await service.createOnlineGame(name, settings, pickSeconds ?? null));
    }),
  );

  app.post(
    '/api/online/join',
    route(async (req, res) => {
      const { code, name } = parseBody(joinBody, req.body);
      res.status(201).json(await service.joinGame(code, name));
    }),
  );

  app.get(
    '/api/games/:id',
    route(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json(await service.getState(parseGameId(req), tokenOf(req)));
    }),
  );

  app.post(
    '/api/games/:id/start',
    route(async (req, res) => {
      res.json(await service.startGame(parseGameId(req), tokenOf(req)));
    }),
  );

  app.post(
    '/api/games/:id/picks',
    route(async (req, res) => {
      const id = parseGameId(req);
      const body = parseBody(pickBody, req.body);
      res.status(201).json(await service.makePick(id, body, tokenOf(req)));
    }),
  );

  app.post(
    '/api/games/:id/rematch',
    route(async (req, res) => {
      const { accept } = parseBody(rematchBody, req.body);
      res.json(await service.rematch(parseGameId(req), tokenOf(req), accept));
    }),
  );

  app.post(
    '/api/games/:id/reveal',
    route(async (req, res) => {
      res.json(await service.reveal(parseGameId(req)));
    }),
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof DraftRuleError) {
      res.status(DRAFT_ERROR_STATUS[err.code]).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof SettingsError) {
      res.status(400).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    // Unique-constraint race (e.g. two tabs picking at once) — the DB is the last line of defence.
    if (err?.code === 'P2002') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'That pick was already made. Refresh and try again.' } });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
  };
  app.use(onError);

  return app;
}
