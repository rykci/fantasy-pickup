// Types mirror the server DTOs in server/src/services/gameService.ts.

export type Team = 'A' | 'B';
export type GameMode = 'vs_cpu' | 'pass_and_play';
export type GameStatus = 'drafting' | 'draft_complete' | 'revealed';
export type Winner = Team | 'draw';

export interface GameSettings {
  poolSize: number;
  rosterSize: number;
  uniquePlayers: boolean;
  // What the draft board shows before the reveal.
  showSeasonTeam: boolean;
  /** Date and opponent of each locked game, as a clue. */
  showGameDate: boolean;
  showAverages: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  poolSize: 15,
  rosterSize: 5,
  uniquePlayers: false,
  showSeasonTeam: true,
  showGameDate: false,
  showAverages: false,
};

export interface GameClue {
  gameDate: string;
  opponent: string;
  isHome: boolean;
}
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
  /** null during the draft when the game hides season & team. */
  season: string | null;
  team: string | null;
  /** Locked game date/opponent, when the game shows it during the draft. */
  gameClue: GameClue | null;
  /** null during the draft when the game hides averages. */
  averages: Averages | null;
  /** 9-cat value relative to this pool (0 = pool average). null when stats are hidden. */
  value: number | null;
}

/** Revealed players always carry their stats. */
export type FullPlayerView = PlayerView & { season: string; team: string; averages: Averages; value: number };

export interface PickView {
  pickNumber: number;
  round: number;
  team: Team;
  playerSeasonId: number;
  playerName: string;
  season: string | null;
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
      players: (FullPlayerView & { pickNumber: number; lockedGame: LockedGame })[];
    }
  >;
  /** Pool players nobody drafted, with their chosen game. Best season value first. */
  undrafted: (FullPlayerView & { lockedGame: LockedGame })[];
}

/** "Dec 25, 1996" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
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
