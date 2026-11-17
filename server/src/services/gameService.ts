import { randomInt } from 'node:crypto';
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
import type { GameRecord, GameRepository } from '../repo/gameRepository.js';

/** In vs_cpu mode the human is always Team A and drafts first. */
export const HUMAN_TEAM: Team = 'A';
export const CPU_TEAM: Team = 'B';

/** Cryptographically strong uniform float in [0, 1). */
export const secureRng: Rng = () => randomInt(0, 2 ** 48 - 1) / 2 ** 48;

// ------------------------------------------------------------------ DTOs

export interface PlayerView {
  /** Player-season id: what gets drafted. */
  id: number;
  /** Person id: shared by every season of the same player. */
  playerId: number;
  name: string;
  season: string;
  team: string;
  /** Season per-game averages. Percentages are 0-1 fractions (null = no attempts). */
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
  };
  /** 9-cat value relative to this game's pool (sum of z-scores; 0 = pool average). */
  value: number;
}

export interface PickView {
  pickNumber: number;
  round: number;
  team: Team;
  playerSeasonId: number;
  playerName: string;
  season: string;
  pickedAt: string;
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
  currentTurn: { pickNumber: number; round: number; team: Team; label: string } | null;
  draftOrder: { pickNumber: number; round: number; team: Team; playerSeasonId: number | null }[];
  rosters: Record<Team, PlayerView[]>;
  available: PlayerView[];
  picks: PickView[];
  /** Only populated once the game has been revealed. Never contains locked game lines. */
  result: { winner: Winner; score: { A: number; B: number } } | null;
}

export interface PickResponse {
  state: GameStateView;
  /** Picks made automatically by the CPU in response to this pick (vs_cpu only). */
  autoPicks: PickView[];
}

export interface RevealedPlayer extends PlayerView {
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
}

// --------------------------------------------------------------- service

export class GameService {
  constructor(
    private readonly repo: GameRepository,
    private readonly rng: Rng = secureRng,
  ) {}

  /**
   * Creates a game: draws a random pool of player-seasons from the universe and
   * locks one random game from that season for each of them.
   */
  async createGame(mode: GameMode, settings: Partial<GameSettings> = {}): Promise<GameStateView> {
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
    const game = await this.repo.createGame(mode, s, locks);
    return this.getState(game.id);
  }

  async getState(gameId: number): Promise<GameStateView> {
    const game = await this.repo.findGame(gameId);
    if (!game) throw notFound(`Game ${gameId}`);
    const [pool, picks] = await Promise.all([this.repo.listPool(gameId), this.repo.listPicks(gameId)]);
    return buildState(game, pool, picks);
  }

  /**
   * Records a pick. Validates turn, availability and draft status server-side.
   * In vs_cpu mode the CPU then picks until it is the human's turn again
   * (snake order means the CPU sometimes has two picks in a row).
   */
  async makePick(gameId: number, input: { playerSeasonId: number; team?: Team }): Promise<PickResponse> {
    const autoPickNumbers = await this.repo.withGameLock(gameId, async (repo) => {
      const game = await repo.findGame(gameId);
      if (!game) throw notFound(`Game ${gameId}`);
      if (game.status !== 'drafting') {
        throw new DraftRuleError('DRAFT_COMPLETE', 'The draft is already complete.');
      }
      const { rosterSize } = game;
      const total = totalPicks(rosterSize);

      const [pool, picks] = await Promise.all([repo.listPool(gameId), repo.listPicks(gameId)]);
      const poolIds = new Set(pool.map((p) => p.id));

      let actingTeam = input.team;
      if (game.mode === 'vs_cpu') {
        actingTeam ??= HUMAN_TEAM;
        if (actingTeam !== HUMAN_TEAM) {
          throw new DraftRuleError('NOT_YOUR_TURN', `Team ${CPU_TEAM} is controlled by the CPU.`);
        }
      }

      const slot = validatePick({ picks, rosterSize, poolIds, playerSeasonId: input.playerSeasonId, team: actingTeam });
      picks.push(
        await repo.addPick(gameId, { pickNumber: slot.pickNumber, team: slot.team, playerSeasonId: input.playerSeasonId }),
      );

      const autoPicks: number[] = [];
      if (game.mode === 'vs_cpu') {
        const values = poolValues(pool);
        while (picks.length < total && teamForPick(picks.length + 1) === CPU_TEAM) {
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
          const cpuSlot = validatePick({ picks, rosterSize, poolIds, playerSeasonId: choice.id, team: CPU_TEAM });
          picks.push(
            await repo.addPick(gameId, { pickNumber: cpuSlot.pickNumber, team: CPU_TEAM, playerSeasonId: choice.id }),
          );
          autoPicks.push(pickNumber);
        }
      }

      if (picks.length === total) {
        await repo.setStatus(gameId, 'draft_complete');
      }
      return autoPicks;
    });

    const state = await this.getState(gameId);
    return { state, autoPicks: state.picks.filter((p) => autoPickNumbers.includes(p.pickNumber)) };
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
        repo.listLockedLines(
          gameId,
          picks.map((p) => p.playerSeasonId),
        ),
      ]);
      const values = poolValues(pool);
      const playersById = new Map(pool.map((p) => [p.id, p]));
      const linesById = new Map(lines.map((l) => [l.playerSeasonId, l]));
      const labels = teamLabels(game.mode);

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
      };
    });
  }
}

// --------------------------------------------------------------- helpers

export function teamLabels(mode: GameMode): Record<Team, string> {
  return mode === 'vs_cpu' ? { A: 'You', B: 'CPU' } : { A: 'Player 1', B: 'Player 2' };
}

const round3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);

export function toPlayerView(p: PoolPlayer, values: ReadonlyMap<number, number>): PlayerView {
  const a = p.averages;
  return {
    id: p.id,
    playerId: p.playerId,
    name: p.name,
    season: p.season,
    team: p.team,
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

function buildState(game: GameRecord, pool: PoolPlayer[], picks: PickRecord[]): GameStateView {
  const labels = teamLabels(game.mode);
  const values = poolValues(pool);
  const views = new Map(pool.map((p) => [p.id, toPlayerView(p, values)]));
  const pickedIds = new Set(picks.map((p) => p.playerSeasonId));
  const byPick = new Map(picks.map((p) => [p.pickNumber, p.playerSeasonId]));
  const slot = currentSlot(picks.length, game.rosterSize);
  const roster = (t: Team) => picks.filter((p) => p.team === t).map((p) => views.get(p.playerSeasonId)!);

  return {
    id: game.id,
    mode: game.mode,
    status: game.status,
    createdAt: game.createdAt.toISOString(),
    settings: { poolSize: game.poolSize, rosterSize: game.rosterSize, uniquePlayers: game.uniquePlayers },
    totalPicks: totalPicks(game.rosterSize),
    teamLabels: labels,
    cpuTeams: game.mode === 'vs_cpu' ? [CPU_TEAM] : [],
    currentTurn: slot ? { ...slot, label: labels[slot.team] } : null,
    draftOrder: draftOrder(game.rosterSize).map((s) => ({ ...s, playerSeasonId: byPick.get(s.pickNumber) ?? null })),
    rosters: { A: roster('A'), B: roster('B') },
    available: [...views.values()].filter((v) => !pickedIds.has(v.id)).sort((x, y) => y.value - x.value),
    picks: picks.map((p) => {
      const v = views.get(p.playerSeasonId);
      return {
        pickNumber: p.pickNumber,
        round: roundForPick(p.pickNumber),
        team: p.team,
        playerSeasonId: p.playerSeasonId,
        playerName: v?.name ?? `#${p.playerSeasonId}`,
        season: v?.season ?? '',
        pickedAt: p.pickedAt.toISOString(),
      };
    }),
    result:
      game.status === 'revealed' && game.winner && game.scoreA !== null && game.scoreB !== null
        ? { winner: game.winner, score: { A: game.scoreA, B: game.scoreB } }
        : null,
  };
}
