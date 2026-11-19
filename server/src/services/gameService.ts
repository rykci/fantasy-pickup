import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  DEFAULT_SETTINGS,
  DraftRuleError,
  currentSlot,
  draftOrder,
  roundForPick,
  teamForPick,
  totalPicks,
  validatePick,
  validateSettings,
} from '../domain/draft.js';
import { cpuChoosePlayer, poolValues, round1 } from '../domain/fantasy.js';
import { lockRandomGames } from '../domain/lock.js';
import { PoolUnavailableError, UNIVERSE_TOP_N_PER_SEASON, samplePool } from '../domain/pool.js';
import { type CategoryResult, type MatchupResult, type TeamTotals, pct, scoreMatchup, teamTotals } from '../domain/scoring.js';
import type {
  GameMode,
  GameClue,
  GameSettings,
  GameStatus,
  LockedLine,
  PickRecord,
  PoolPlayer,
  Rng,
  Team,
  Winner,
} from '../domain/types.js';
import { HttpError, notFound } from '../errors.js';
import type { GameRecord, GameRepository, SeatRecord } from '../repo/gameRepository.js';

/** In vs_cpu mode the human is always Team A and drafts first. */
export const HUMAN_TEAM: Team = 'A';
export const CPU_TEAM: Team = 'B';

/** Cryptographically strong uniform float in [0, 1). */
export const secureRng: Rng = () => randomInt(0, 2 ** 48 - 1) / 2 ** 48;

/** Online timings. Both screens schedule from these server timestamps, so they stay in sync. */
export const ONLINE = {
  /** Host presses Start → the coin flip starts on both screens (time for the other player's poll to see it). */
  FLIP_LEAD_MS: 1500,
  /** Host presses Start → the first pick's clock starts (the flip, plus a moment to read the result). */
  FIRST_TURN_LEAD_MS: 5000,
  /** Last pick → the reveal starts on both screens. */
  REVEAL_LEAD_MS: 2500,
  /** A player seen this recently counts as connected. */
  CONNECTED_MS: 15_000,
  /** Record "last seen" at most this often (polls come every second or so). */
  TOUCH_MS: 5_000,
  /** Lobby or drafting games with no join, start or pick for this long expire. */
  EXPIRE_MS: 24 * 60 * 60 * 1000,
  PICK_SECONDS: [30, 60, 90] as const,
} as const;

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const ROOM_CODE_LENGTH = 4;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// ------------------------------------------------------------------ DTOs

export interface PlayerView {
  /** Player-season id: what gets drafted. */
  id: number;
  /** Person id: shared by every season of the same player. */
  playerId: number;
  name: string;
  /** null during the draft unless the game shows season & team. */
  season: string | null;
  team: string | null;
  /** Date and opponent of the locked game (no stats). Only during the draft, and only if the game shows it. */
  gameClue: { gameDate: string; opponent: string; isHome: boolean } | null;
  /**
   * Season per-game averages. Percentages are 0-1 fractions (null = no attempts).
   * null during the draft unless the game shows averages.
   */
  averages: {
    gamesPlayed: number;
    minutes: number;
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    fg3m: number;
    fgm: number;
    fga: number;
    fgPct: number | null;
    ftm: number;
    fta: number;
    ftPct: number | null;
    tov: number;
  } | null;
  /** 9-cat value relative to this game's pool (sum of z-scores; 0 = pool average). null when averages are hidden. */
  value: number | null;
}

/** Revealed players always carry everything. */
export type FullPlayerView = PlayerView & {
  season: string;
  team: string;
  averages: NonNullable<PlayerView['averages']>;
  value: number;
};

export interface PickView {
  pickNumber: number;
  round: number;
  team: Team;
  playerSeasonId: number;
  playerName: string;
  /** null while the game hides season & team. */
  season: string | null;
  pickedAt: string;
}

/** Online games only: the room, seats, and the server timestamps both screens schedule from. */
export interface OnlineView {
  roomCode: string;
  /** Which team the viewer's token holds, or null for someone just looking. */
  you: Team | null;
  seats: Record<Team, { name: string; connected: boolean } | null>;
  pickSeconds: number | null;
  /** When the coin flip starts on both screens. */
  flipAt: string | null;
  /** When the current turn began; picks open at the first one. */
  turnStartedAt: string | null;
  /** When the clock runs out and the best available player is picked automatically. */
  turnDeadline: string | null;
  /** When the reveal starts on both screens. */
  revealStartedAt: string | null;
  rematchGameId: number | null;
  expired: boolean;
}

export interface GameStateView {
  id: number;
  mode: GameMode;
  status: GameStatus;
  createdAt: string;
  settings: GameSettings;
  totalPicks: number;
  teamLabels: Record<Team, string>;
  /** Which teams are controlled by the CPU (empty in pass-and-play). */
  cpuTeams: Team[];
  /** Coin-flip winner: picks first. */
  firstTeam: Team;
  currentTurn: { pickNumber: number; round: number; team: Team; label: string } | null;
  draftOrder: { pickNumber: number; round: number; team: Team; playerSeasonId: number | null }[];
  rosters: Record<Team, PlayerView[]>;
  available: PlayerView[];
  picks: PickView[];
  /** Only populated once the game has been revealed. Never contains locked game lines. */
  result: { winner: Winner; score: { A: number; B: number } } | null;
  online: OnlineView | null;
  /** The server's clock, so clients can line up the online timestamps with their own. */
  serverNow: string;
}

/** Returned once when you create or join an online game: keep the token, it is your seat. */
export interface SeatGrant {
  gameId: number;
  token: string;
  team: Team;
  state: GameStateView;
}

export interface PickResponse {
  state: GameStateView;
  /** Picks made automatically by the CPU in response to this pick (vs_cpu only). */
  autoPicks: PickView[];
}

export interface UndraftedPlayer extends FullPlayerView {
  lockedGame: Omit<LockedLine, 'playerSeasonId'>;
}

export interface RevealedPlayer extends FullPlayerView {
  pickNumber: number;
  lockedGame: Omit<LockedLine, 'playerSeasonId'>;
}

export interface RevealView {
  gameId: number;
  mode: GameMode;
  teamLabels: Record<Team, string>;
  winner: Winner;
  winnerLabel: string;
  score: { A: number; B: number };
  decidedBy: MatchupResult['decidedBy'];
  categories: CategoryResult[];
  teams: Record<Team, { label: string; totals: TeamTotals; players: RevealedPlayer[] }>;
  /** Pool players nobody drafted, with their chosen game too. Best season value first. */
  undrafted: UndraftedPlayer[];
}

// --------------------------------------------------------------- service

export class GameService {
  constructor(
    private readonly repo: GameRepository,
    private readonly rng: Rng = secureRng,
    /** Who picks first. A fair coin by default; tests can fix it. */
    private readonly coinFlip: () => Team = () => (rng() < 0.5 ? 'A' : 'B'),
    /** Injected so tests can control the pick clock and online timings. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Creates a local game (vs CPU or pass-and-play): draws a random pool of player-seasons
   * from the universe and locks one random game from that season for each of them.
   */
  async createGame(mode: Exclude<GameMode, 'online'>, settings: Partial<GameSettings> = {}): Promise<GameStateView> {
    const game = await this.newGame(mode, settings);
    if (mode === 'vs_cpu' && game.firstTeam === CPU_TEAM) {
      // The CPU won the coin flip: it makes the first pick right away.
      await this.repo.withGameLock(game.id, async (repo) => {
        const [pool, picks] = await Promise.all([repo.listPool(game.id), repo.listPicks(game.id)]);
        await this.cpuPicks(repo, game, pool, picks);
      });
    }
    return this.getState(game.id);
  }

  private async newGame(
    mode: GameMode,
    settings: Partial<GameSettings>,
    online?: { pickSeconds: number | null },
  ): Promise<GameRecord> {
    const given = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
    const s = validateSettings({ ...DEFAULT_SETTINGS, ...given });
    const universe = await this.repo.listUniverse(UNIVERSE_TOP_N_PER_SEASON);
    if (universe.length === 0) {
      throw new HttpError(503, 'POOL_NOT_SEEDED', 'No player-seasons loaded. Run the ingestion script.');
    }
    let poolIds: number[];
    try {
      poolIds = samplePool(universe, s.poolSize, s.uniquePlayers, this.rng);
    } catch (e) {
      if (e instanceof PoolUnavailableError) throw new HttpError(400, 'POOL_TOO_LARGE', e.message);
      throw e;
    }
    const locks = lockRandomGames(await this.repo.listGameLogIds(poolIds), this.rng);
    if (!online) return this.repo.createGame(mode, s, this.coinFlip(), locks);
    if (online.pickSeconds !== null && !(ONLINE.PICK_SECONDS as readonly number[]).includes(online.pickSeconds)) {
      throw new HttpError(400, 'INVALID_SETTINGS', `Pick clock must be off or one of ${ONLINE.PICK_SECONDS.join(', ')} seconds.`);
    }
    // Room codes are short, so retry on the rare collision.
    for (let attempt = 0; attempt < 10; attempt++) {
      const roomCode = this.roomCode();
      if ((await this.repo.findGameIdByRoomCode(roomCode)) !== null) continue;
      try {
        return await this.repo.createGame(mode, s, this.coinFlip(), locks, {
          roomCode,
          pickSeconds: online.pickSeconds,
          now: this.now(),
        });
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    throw new HttpError(503, 'NO_ROOM_CODE', 'Could not find a free room code. Try again.');
  }

  private roomCode(): string {
    return Array.from(
      { length: ROOM_CODE_LENGTH },
      () => ROOM_CODE_ALPHABET[Math.floor(this.rng() * ROOM_CODE_ALPHABET.length)],
    ).join('');
  }

  // ---------------------------------------------------------- online rooms

  /** Creates an online game in the lobby. The host holds Team A. */
  async createOnlineGame(
    hostName: string,
    settings: Partial<GameSettings> = {},
    pickSeconds: number | null = null,
  ): Promise<SeatGrant> {
    const name = cleanName(hostName); // before creating anything
    const game = await this.newGame('online', settings, { pickSeconds });
    const token = newToken();
    await this.repo.addSeat(game.id, { team: 'A', name, tokenHash: hashToken(token) }, this.now());
    return { gameId: game.id, token, team: 'A', state: await this.getState(game.id, token) };
  }

  /** A friend joins by room code and takes Team B. */
  async joinGame(roomCode: string, name: string): Promise<SeatGrant> {
    const gameId = await this.repo.findGameIdByRoomCode(roomCode.trim().toUpperCase());
    if (gameId === null) throw new HttpError(404, 'ROOM_NOT_FOUND', `No game with code ${roomCode}.`);
    const token = newToken();
    await this.repo.withGameLock(gameId, async (repo) => {
      const game = (await repo.findGame(gameId))!;
      this.assertNotExpired(game);
      if (game.status !== 'lobby') throw new HttpError(409, 'ALREADY_STARTED', 'This game has already started.');
      const seats = await repo.listSeats(gameId);
      if (seats.some((s) => s.team === 'B')) throw new HttpError(409, 'ROOM_FULL', 'This game already has two players.');
      await repo.addSeat(gameId, { team: 'B', name: cleanName(name), tokenHash: hashToken(token) }, this.now());
      await repo.updateGame(gameId, { lastActivityAt: this.now() });
    });
    return { gameId, token, team: 'B', state: await this.getState(gameId, token) };
  }

  /** The host starts the game once the friend has joined: the coin flip plays, then the draft opens. */
  async startGame(gameId: number, token: string | undefined): Promise<GameStateView> {
    await this.repo.withGameLock(gameId, async (repo) => {
      const game = await repo.findGame(gameId);
      if (!game || game.mode !== 'online') throw notFound(`Online game ${gameId}`);
      this.assertNotExpired(game);
      const seats = await repo.listSeats(gameId);
      const seat = seatFor(seats, token);
      if (seat?.team !== 'A') throw new HttpError(403, 'NOT_HOST', 'Only the host can start the game.');
      if (game.status !== 'lobby') throw new HttpError(409, 'ALREADY_STARTED', 'This game has already started.');
      if (!seats.some((s) => s.team === 'B')) {
        throw new HttpError(409, 'WAITING_FOR_OPPONENT', 'Wait for your friend to join first.');
      }
      const now = this.now();
      await repo.updateGame(gameId, {
        status: 'drafting',
        startedAt: now,
        turnStartedAt: new Date(now.getTime() + ONLINE.FIRST_TURN_LEAD_MS),
        lastActivityAt: now,
      });
    });
    return this.getState(gameId, token);
  }

  /**
   * After a finished online game: a new game with the same settings and the same two players
   * (a fresh pool and coin flip). Idempotent: both players asking get the same rematch.
   */
  async rematch(gameId: number, token: string | undefined): Promise<{ gameId: number }> {
    const newId = await this.repo.withGameLock(gameId, async (repo) => {
      const game = await repo.findGame(gameId);
      if (!game || game.mode !== 'online') throw notFound(`Online game ${gameId}`);
      const seats = await repo.listSeats(gameId);
      if (!seatFor(seats, token)) throw new HttpError(403, 'NOT_A_PLAYER', 'Only the two players can ask for a rematch.');
      if (game.status !== 'draft_complete' && game.status !== 'revealed') {
        throw new HttpError(409, 'NOT_FINISHED', 'Finish this game first.');
      }
      if (game.rematchGameId !== null) return game.rematchGameId;
      const next = await this.newGame('online', settingsOf(game), { pickSeconds: game.pickSeconds });
      // Same seats and tokens: both players are already signed in to the rematch.
      for (const s of seats) {
        await this.repo.addSeat(next.id, { team: s.team, name: s.name, tokenHash: s.tokenHash }, this.now());
      }
      await repo.updateGame(gameId, { rematchGameId: next.id });
      return next.id;
    });
    return { gameId: newId };
  }

  private assertNotExpired(game: GameRecord) {
    if (isExpired(game, this.now())) {
      throw new HttpError(410, 'GAME_EXPIRED', 'This game expired after 24 hours without a pick.');
    }
  }

  /**
   * Online pick clock. There's no always-running server (it runs as serverless functions),
   * so the clock is enforced whenever anyone asks: every overdue turn gets the best available
   * player, picked the CPU's way. Each auto-picked turn's clock starts at the previous deadline.
   * Call inside the game lock.
   */
  private async enforceClock(repo: GameRepository, game: GameRecord, picks: PickRecord[]): Promise<void> {
    const deadline = turnDeadline(game);
    const now = this.now();
    if (!deadline || deadline > now || isExpired(game, now)) return;
    const pool = await repo.listPool(game.id);
    const values = poolValues(pool);
    const poolIds = new Set(pool.map((p) => p.id));
    const total = totalPicks(game.rosterSize);
    let turnStart = game.turnStartedAt!;
    let due = deadline;
    while (picks.length < total && due <= now) {
      const pickNumber = picks.length + 1;
      const team = teamForPick(pickNumber, game.firstTeam);
      const taken = new Set(picks.map((p) => p.playerSeasonId));
      const choice = cpuChoosePlayer(
        pool.filter((p) => !taken.has(p.id)),
        values,
        roundForPick(pickNumber),
        game.rosterSize,
        this.rng,
      );
      const slot = validatePick({ picks, rosterSize: game.rosterSize, firstTeam: game.firstTeam, poolIds, playerSeasonId: choice.id, team });
      picks.push(await repo.addPick(game.id, { pickNumber: slot.pickNumber, team, playerSeasonId: choice.id }));
      turnStart = due;
      due = new Date(turnStart.getTime() + game.pickSeconds! * 1000);
    }
    await repo.updateGame(game.id, { turnStartedAt: turnStart });
    game.turnStartedAt = turnStart;
    await this.finishDraftIfComplete(repo, game, picks);
  }

  private async finishDraftIfComplete(repo: GameRepository, game: GameRecord, picks: PickRecord[]): Promise<void> {
    if (picks.length < totalPicks(game.rosterSize)) return;
    game.status = 'draft_complete';
    if (game.mode === 'online') {
      game.revealStartedAt = new Date(this.now().getTime() + ONLINE.REVEAL_LEAD_MS);
      await repo.updateGame(game.id, { status: 'draft_complete', revealStartedAt: game.revealStartedAt });
    } else {
      await repo.setStatus(game.id, 'draft_complete');
    }
  }

  // ---------------------------------------------------------- all modes

  /** `token` identifies an online player (it's ignored for local games). */
  async getState(gameId: number, token?: string): Promise<GameStateView> {
    let game = await this.repo.findGame(gameId);
    if (!game) throw notFound(`Game ${gameId}`);
    const now = this.now();
    if (game.mode === 'online' && game.status === 'drafting' && (turnDeadline(game)?.getTime() ?? Infinity) <= now.getTime()) {
      await this.repo.withGameLock(gameId, async (repo) => {
        const locked = (await repo.findGame(gameId))!;
        if (locked.status === 'drafting') await this.enforceClock(repo, locked, await repo.listPicks(gameId));
      });
      game = (await this.repo.findGame(gameId))!;
    }
    const wantClues = game.showGameDate && game.status !== 'revealed';
    const [pool, picks, clues, seats] = await Promise.all([
      this.repo.listPool(gameId),
      this.repo.listPicks(gameId),
      wantClues ? this.repo.listGameClues(gameId) : Promise.resolve([]),
      game.mode === 'online' ? this.repo.listSeats(gameId) : Promise.resolve([]),
    ]);
    const viewer = seatFor(seats, token);
    if (viewer && now.getTime() - viewer.lastSeenAt.getTime() > ONLINE.TOUCH_MS) {
      await this.repo.touchSeat(gameId, viewer.team, now);
      viewer.lastSeenAt = now;
    }
    return buildState(game, pool, picks, clues, seats, viewer?.team ?? null, now);
  }

  /**
   * Records a pick. Validates turn, availability and draft status server-side.
   * In vs_cpu mode the CPU then picks until it is the human's turn again
   * (snake order means the CPU sometimes has two picks in a row).
   */
  async makePick(
    gameId: number,
    input: { playerSeasonId: number; team?: Team },
    token?: string,
  ): Promise<PickResponse> {
    const autoPickNumbers = await this.repo.withGameLock(gameId, async (repo) => {
      const game = await repo.findGame(gameId);
      if (!game) throw notFound(`Game ${gameId}`);
      const now = this.now();
      if (game.mode === 'online') {
        this.assertNotExpired(game);
        // turnStartedAt is only in the future before the first pick, while the coin flip plays.
        if (game.status === 'lobby' || (game.turnStartedAt && now < game.turnStartedAt)) {
          throw new HttpError(409, 'NOT_STARTED', 'The draft opens when the coin lands.');
        }
      }
      if (game.status !== 'drafting') {
        throw new DraftRuleError('DRAFT_COMPLETE', 'The draft is already complete.');
      }
      const { rosterSize } = game;

      const [pool, picks] = await Promise.all([repo.listPool(gameId), repo.listPicks(gameId)]);
      const poolIds = new Set(pool.map((p) => p.id));

      let actingTeam = input.team;
      if (game.mode === 'online') {
        const seat = seatFor(await repo.listSeats(gameId), token);
        if (!seat) throw new HttpError(403, 'NOT_A_PLAYER', "You're not a player in this game.");
        if (input.team !== undefined && input.team !== seat.team) {
          throw new DraftRuleError('NOT_YOUR_TURN', `You are Team ${seat.team}.`);
        }
        actingTeam = seat.team;
        // Overdue turns are auto-picked first; then it may not be your turn any more.
        await this.enforceClock(repo, game, picks);
        if (game.status !== 'drafting') throw new DraftRuleError('DRAFT_COMPLETE', 'The draft is already complete.');
      }
      if (game.mode === 'vs_cpu') {
        actingTeam ??= HUMAN_TEAM;
        if (actingTeam !== HUMAN_TEAM) {
          throw new DraftRuleError('NOT_YOUR_TURN', `Team ${CPU_TEAM} is controlled by the CPU.`);
        }
      }

      const slot = validatePick({
        picks,
        rosterSize,
        firstTeam: game.firstTeam,
        poolIds,
        playerSeasonId: input.playerSeasonId,
        team: actingTeam,
      });
      picks.push(
        await repo.addPick(gameId, { pickNumber: slot.pickNumber, team: slot.team, playerSeasonId: input.playerSeasonId }),
      );

      const autoPicks = game.mode === 'vs_cpu' ? await this.cpuPicks(repo, game, pool, picks) : [];
      if (game.mode === 'online') {
        game.turnStartedAt = now;
        await repo.updateGame(gameId, { turnStartedAt: now, lastActivityAt: now });
      }
      await this.finishDraftIfComplete(repo, game, picks);
      return autoPicks;
    });

    const state = await this.getState(gameId, token);
    return { state, autoPicks: state.picks.filter((p) => autoPickNumbers.includes(p.pickNumber)) };
  }

  /**
   * The CPU picks while it's on the clock (snake order means it sometimes has two in a row).
   * Pushes onto `picks` and returns the pick numbers it made.
   */
  private async cpuPicks(
    repo: GameRepository,
    game: GameRecord,
    pool: PoolPlayer[],
    picks: PickRecord[],
  ): Promise<number[]> {
    const { rosterSize, firstTeam } = game;
    const total = totalPicks(rosterSize);
    const poolIds = new Set(pool.map((p) => p.id));
    const values = poolValues(pool);
    const made: number[] = [];
    while (picks.length < total && teamForPick(picks.length + 1, firstTeam) === CPU_TEAM) {
      const pickNumber = picks.length + 1;
      const taken = new Set(picks.map((p) => p.playerSeasonId));
      const choice = cpuChoosePlayer(
        pool.filter((p) => !taken.has(p.id)),
        values,
        roundForPick(pickNumber),
        rosterSize,
        this.rng,
      );
      // Same validation path as a human pick.
      const slot = validatePick({ picks, rosterSize, firstTeam, poolIds, playerSeasonId: choice.id, team: CPU_TEAM });
      picks.push(await repo.addPick(game.id, { pickNumber: slot.pickNumber, team: CPU_TEAM, playerSeasonId: choice.id }));
      made.push(pickNumber);
    }
    return made;
  }

  /**
   * Reveals each drafted player-season's locked game and scores the matchup.
   * Only allowed after the last pick. Idempotent: the locked games never change,
   * so revealing again returns the same result.
   */
  async reveal(gameId: number): Promise<RevealView> {
    return this.repo.withGameLock(gameId, async (repo) => {
      const game = await repo.findGame(gameId);
      if (!game) throw notFound(`Game ${gameId}`);
      const total = totalPicks(game.rosterSize);
      const picks = await repo.listPicks(gameId);
      if (picks.length < total || game.status === 'drafting') {
        throw new HttpError(
          409,
          'DRAFT_NOT_COMPLETE',
          `Results are hidden until the draft is complete (${picks.length}/${total} picks made).`,
        );
      }

      const [pool, lines] = await Promise.all([
        repo.listPool(gameId),
        // Every pool player's game: the drafted ones score, the undrafted ones are shown too.
        repo.listLocks(gameId).then((locks) =>
          repo.listLockedLines(
            gameId,
            locks.map((l) => l.playerSeasonId),
          ),
        ),
      ]);
      const values = poolValues(pool);
      const playersById = new Map(pool.map((p) => [p.id, p]));
      const linesById = new Map(lines.map((l) => [l.playerSeasonId, l]));
      const labels = labelsFor(game.mode, game.mode === 'online' ? await repo.listSeats(gameId) : []);

      const team = (side: Team) => {
        const players: RevealedPlayer[] = picks
          .filter((p) => p.team === side)
          .map((pick) => {
            const line = linesById.get(pick.playerSeasonId);
            if (!line) throw new Error(`Missing locked game for player-season ${pick.playerSeasonId}`);
            const { playerSeasonId: _omit, ...lockedGame } = line;
            return {
              ...toPlayerView(playersById.get(pick.playerSeasonId)!, values),
              pickNumber: pick.pickNumber,
              lockedGame,
            };
          });
        return { label: labels[side], totals: teamTotals(players.map((p) => p.lockedGame)), players };
      };
      const teams = { A: team('A'), B: team('B') };
      const drafted = new Set(picks.map((p) => p.playerSeasonId));
      const undrafted: UndraftedPlayer[] = pool
        .filter((p) => !drafted.has(p.id))
        .map((p) => {
          const line = linesById.get(p.id);
          if (!line) throw new Error(`Missing locked game for player-season ${p.id}`);
          const { playerSeasonId: _omit, ...lockedGame } = line;
          return { ...toPlayerView(p, values), lockedGame };
        })
        .sort((x, y) => y.value - x.value);
      const result = scoreMatchup(teams.A.totals, teams.B.totals);

      if (game.status !== 'revealed') {
        await repo.saveResult(gameId, { winner: result.winner, scoreA: result.score.A, scoreB: result.score.B });
      }

      return {
        gameId,
        mode: game.mode,
        teamLabels: labels,
        winner: result.winner,
        winnerLabel: result.winner === 'draw' ? 'Draw' : labels[result.winner],
        score: result.score,
        decidedBy: result.decidedBy,
        categories: result.categories,
        teams,
        undrafted,
      };
    });
  }
}

// --------------------------------------------------------------- helpers

export function teamLabels(mode: GameMode): Record<Team, string> {
  return mode === 'vs_cpu' ? { A: 'You', B: 'CPU' } : { A: 'Player 1', B: 'Player 2' };
}

/** Online games are labelled with the players' names. */
function labelsFor(mode: GameMode, seats: SeatRecord[]): Record<Team, string> {
  if (mode !== 'online') return teamLabels(mode);
  const name = (t: Team) => seats.find((s) => s.team === t)?.name;
  return { A: name('A') ?? 'Host', B: name('B') ?? 'Waiting…' };
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length < 1 || n.length > 20) throw new HttpError(400, 'INVALID_NAME', 'Name must be 1–20 characters.');
  return n;
}

function seatFor(seats: SeatRecord[], token: string | undefined): SeatRecord | undefined {
  if (!token) return undefined;
  const h = hashToken(token);
  return seats.find((s) => s.tokenHash === h);
}

function turnDeadline(game: GameRecord): Date | null {
  if (game.mode !== 'online' || game.status !== 'drafting' || !game.pickSeconds || !game.turnStartedAt) return null;
  return new Date(game.turnStartedAt.getTime() + game.pickSeconds * 1000);
}

function isExpired(game: GameRecord, now: Date): boolean {
  return (
    game.mode === 'online' &&
    (game.status === 'lobby' || game.status === 'drafting') &&
    now.getTime() - game.lastActivityAt.getTime() > ONLINE.EXPIRE_MS
  );
}

function settingsOf(g: GameRecord): GameSettings {
  return {
    poolSize: g.poolSize,
    rosterSize: g.rosterSize,
    uniquePlayers: g.uniquePlayers,
    showSeasonTeam: g.showSeasonTeam,
    showGameDate: g.showGameDate,
    showAverages: g.showAverages,
  };
}

function onlineView(game: GameRecord, seats: SeatRecord[], you: Team | null, now: Date): OnlineView {
  const seat = (t: Team) => {
    const s = seats.find((x) => x.team === t);
    return s ? { name: s.name, connected: now.getTime() - s.lastSeenAt.getTime() < ONLINE.CONNECTED_MS } : null;
  };
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    roomCode: game.roomCode!,
    you,
    seats: { A: seat('A'), B: seat('B') },
    pickSeconds: game.pickSeconds,
    flipAt: game.startedAt ? new Date(game.startedAt.getTime() + ONLINE.FLIP_LEAD_MS).toISOString() : null,
    turnStartedAt: iso(game.turnStartedAt),
    turnDeadline: iso(turnDeadline(game)),
    revealStartedAt: iso(game.revealStartedAt),
    rematchGameId: game.rematchGameId,
    expired: isExpired(game, now),
  };
}

const round3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);

/** What the draft board may show of a player-season, per the game's settings. */
function toDraftView(
  p: PoolPlayer,
  values: ReadonlyMap<number, number>,
  show: Pick<GameSettings, 'showSeasonTeam' | 'showGameDate' | 'showAverages'>,
  clue: GameClue | undefined,
): PlayerView {
  const full = toPlayerView(p, values);
  return {
    ...full,
    season: show.showSeasonTeam ? full.season : null,
    team: show.showSeasonTeam ? full.team : null,
    gameClue: show.showGameDate && clue ? { gameDate: clue.gameDate, opponent: clue.opponent, isHome: clue.isHome } : null,
    averages: show.showAverages ? full.averages : null,
    value: show.showAverages ? full.value : null,
  };
}

/**
 * Stable per-game shuffle key. Used to order the board (and same-name players) when
 * averages or seasons are hidden, without leaking rank or season through the order.
 */
function shuffleKey(gameId: number, id: number): number {
  return Math.imul((id ^ Math.imul(gameId, 0x9e3779b1)) >>> 0, 0x85ebca6b) >>> 0;
}

export function toPlayerView(p: PoolPlayer, values: ReadonlyMap<number, number>): FullPlayerView {
  const a = p.averages;
  return {
    id: p.id,
    playerId: p.playerId,
    name: p.name,
    season: p.season,
    team: p.team,
    gameClue: null,
    averages: {
      gamesPlayed: a.gamesPlayed,
      minutes: round1(a.minutes),
      pts: round1(a.pts),
      reb: round1(a.reb),
      ast: round1(a.ast),
      stl: round1(a.stl),
      blk: round1(a.blk),
      fg3m: round1(a.fg3m),
      fgm: round1(a.fgm),
      fga: round1(a.fga),
      fgPct: round3(pct(a.fgm, a.fga)),
      ftm: round1(a.ftm),
      fta: round1(a.fta),
      ftPct: round3(pct(a.ftm, a.fta)),
      tov: round1(a.tov),
    },
    value: round1(values.get(p.id) ?? 0),
  };
}

function buildState(
  game: GameRecord,
  pool: PoolPlayer[],
  picks: PickRecord[],
  clues: GameClue[],
  seats: SeatRecord[],
  viewer: Team | null,
  now: Date,
): GameStateView {
  const labels = labelsFor(game.mode, seats);
  // Before the reveal, send only what the settings allow. After it, everything.
  const revealed = game.status === 'revealed';
  const show = revealed ? { showSeasonTeam: true, showGameDate: false, showAverages: true } : game;
  const values = poolValues(pool);
  const clueById = new Map(clues.map((c) => [c.playerSeasonId, c]));
  const views = new Map<number, PlayerView>(
    pool.map((p) => [p.id, toDraftView(p, values, show, clueById.get(p.id))]),
  );
  // Best value first when averages are shown. Otherwise by name, so the order doesn't
  // leak the ranking; same-name entries in a per-game shuffled order (not by season).
  const boardOrder = show.showAverages
    ? (x: PlayerView, y: PlayerView) => (y.value ?? 0) - (x.value ?? 0)
    : (x: PlayerView, y: PlayerView) =>
        x.name.localeCompare(y.name) || shuffleKey(game.id, x.id) - shuffleKey(game.id, y.id);
  const pickedIds = new Set(picks.map((p) => p.playerSeasonId));
  const byPick = new Map(picks.map((p) => [p.pickNumber, p.playerSeasonId]));
  const slot = currentSlot(picks.length, game.rosterSize, game.firstTeam);
  const roster = (t: Team) => picks.filter((p) => p.team === t).map((p) => views.get(p.playerSeasonId)!);

  return {
    id: game.id,
    mode: game.mode,
    status: game.status,
    createdAt: game.createdAt.toISOString(),
    settings: {
      poolSize: game.poolSize,
      rosterSize: game.rosterSize,
      uniquePlayers: game.uniquePlayers,
      showSeasonTeam: game.showSeasonTeam,
      showGameDate: game.showGameDate,
      showAverages: game.showAverages,
    },
    totalPicks: totalPicks(game.rosterSize),
    teamLabels: labels,
    cpuTeams: game.mode === 'vs_cpu' ? [CPU_TEAM] : [],
    firstTeam: game.firstTeam,
    currentTurn: slot ? { ...slot, label: labels[slot.team] } : null,
    draftOrder: draftOrder(game.rosterSize, game.firstTeam).map((s) => ({ ...s, playerSeasonId: byPick.get(s.pickNumber) ?? null })),
    rosters: { A: roster('A'), B: roster('B') },
    available: [...views.values()].filter((v) => !pickedIds.has(v.id)).sort(boardOrder),
    picks: picks.map((p) => {
      const v = views.get(p.playerSeasonId);
      return {
        pickNumber: p.pickNumber,
        round: roundForPick(p.pickNumber),
        team: p.team,
        playerSeasonId: p.playerSeasonId,
        playerName: v?.name ?? `#${p.playerSeasonId}`,
        season: v?.season ?? null,
        pickedAt: p.pickedAt.toISOString(),
      };
    }),
    result:
      game.status === 'revealed' && game.winner && game.scoreA !== null && game.scoreB !== null
        ? { winner: game.winner, score: { A: game.scoreA, B: game.scoreB } }
        : null,
    online: game.mode === 'online' ? onlineView(game, seats, viewer, now) : null,
    serverNow: now.toISOString(),
  };
}
