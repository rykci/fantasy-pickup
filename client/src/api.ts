// Types mirror the server DTOs in server/src/services/gameService.ts.

export type Team = 'A' | 'B';
export type GameMode = 'vs_cpu' | 'pass_and_play';
export type GameStatus = 'drafting' | 'draft_complete' | 'revealed';
export type Winner = Team | 'draw';

export interface GameSettings {
  poolSize: number;
  rosterSize: number;
  uniquePlayers: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = { poolSize: 24, rosterSize: 5, uniquePlayers: false };
/** Mirrors server/src/domain/draft.ts LIMITS. */
export const LIMITS = { minRoster: 1, maxRoster: 13, maxPool: 200 } as const;

export interface Averages {
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
  /** 0-1 fraction, null = no attempts */
  fgPct: number | null;
  ftm: number;
  fta: number;
  ftPct: number | null;
  tov: number;
}

export interface PlayerView {
  /** Player-season id: what gets drafted. */
  id: number;
  /** Same for every season of a player. */
  playerId: number;
  name: string;
  season: string;
  team: string;
  averages: Averages;
  /** 9-cat value relative to this pool (0 = pool average). */
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

export interface GameState {
  id: number;
  mode: GameMode;
  status: GameStatus;
  createdAt: string;
  settings: GameSettings;
  totalPicks: number;
  teamLabels: Record<Team, string>;
  cpuTeams: Team[];
  currentTurn: { pickNumber: number; round: number; team: Team; label: string } | null;
  draftOrder: { pickNumber: number; round: number; team: Team; playerSeasonId: number | null }[];
  rosters: Record<Team, PlayerView[]>;
  available: PlayerView[];
  picks: PickView[];
  result: { winner: Winner; score: { A: number; B: number } } | null;
}

export interface PickResponse {
  state: GameState;
  autoPicks: PickView[];
}

export interface StatLine {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg3m: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  tov: number;
}

export interface LockedGame extends StatLine {
  gameLogId: number;
  gameId: string;
  gameDate: string;
  team: string;
  opponent: string;
  isHome: boolean;
  minutes: number;
}

export type CategoryKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m' | 'fgPct' | 'ftPct' | 'tov';

export interface CategoryResult {
  key: CategoryKey;
  label: string;
  /** Total, or a 0-1 fraction for FG%/FT% (null = no attempts). */
  A: number | null;
  B: number | null;
  lowerIsBetter: boolean;
  winner: Team | 'tie';
}

export interface RevealResult {
  gameId: number;
  mode: GameMode;
  teamLabels: Record<Team, string>;
  winner: Winner;
  winnerLabel: string;
  score: { A: number; B: number };
  decidedBy: 'categories' | 'points_tiebreak' | 'draw';
  categories: CategoryResult[];
  teams: Record<
    Team,
    {
      label: string;
      totals: StatLine;
      players: (PlayerView & { pickNumber: number; lockedGame: LockedGame })[];
    }
  >;
}

/** ".512" style, or "–" when there were no attempts. */
export function formatPct(p: number | null): string {
  if (p === null) return '–';
  return p >= 1 ? '1.000' : p.toFixed(3).replace(/^0/, '');
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the API server. Is it running on port 4000?');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  createGame: (mode: GameMode, settings: GameSettings) => request<GameState>('POST', '/games', { mode, ...settings }),
  getGame: (id: number) => request<GameState>('GET', `/games/${id}`),
  pick: (id: number, playerSeasonId: number, team: Team) =>
    request<PickResponse>('POST', `/games/${id}/picks`, { playerSeasonId, team }),
  reveal: (id: number) => request<RevealResult>('POST', `/games/${id}/reveal`),
};
