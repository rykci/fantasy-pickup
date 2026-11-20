// Types mirror the server DTOs in server/src/services/gameService.ts.

export type Team = 'A' | 'B';
export type GameMode = 'vs_cpu' | 'pass_and_play' | 'online';
/** `lobby` is online-only: waiting for the friend to join and the host to start. */
export type GameStatus = 'lobby' | 'drafting' | 'draft_complete' | 'revealed';
export type Winner = Team | 'draw';

export interface GameSettings {
  poolSize: number;
  rosterSize: number;
  uniquePlayers: boolean;
  /** Seasons the pool is drawn from, by starting year (1995 = 1995-96), inclusive. */
  fromSeason: number;
  toSeason: number;
  // What the draft board shows before the reveal.
  showSeasonTeam: boolean;
  /** Date and opponent of each locked game, as a clue. */
  showGameDate: boolean;
  showAverages: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  poolSize: 15,
  rosterSize: 5,
  uniquePlayers: true,
  fromSeason: 1983,
  toSeason: 2022,
  showSeasonTeam: false,
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
/** Mirrors server/src/domain/draft.ts SEASONS: the data covers 1983-84 to 2022-23. */
export const SEASONS = { first: 1983, last: 2022 } as const;

/** 1995 → "1995-96". */
export function seasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** "1990-91 to 1999-00", "1995-96", or "all seasons". */
export function seasonRange(s: Pick<GameSettings, 'fromSeason' | 'toSeason'>): string {
  if (s.fromSeason === SEASONS.first && s.toSeason === SEASONS.last) return 'all seasons';
  if (s.fromSeason === s.toSeason) return seasonLabel(s.fromSeason);
  return `${seasonLabel(s.fromSeason)} to ${seasonLabel(s.toSeason)}`;
}

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

/** Online games: the room, seats, and server timestamps both screens schedule from. */
export interface OnlineView {
  roomCode: string;
  /** Your team, or null if you're just looking. */
  you: Team | null;
  seats: Record<Team, { name: string; connected: boolean } | null>;
  pickSeconds: number | null;
  flipAt: string | null;
  turnStartedAt: string | null;
  turnDeadline: string | null;
  revealStartedAt: string | null;
  /** Each player's answer to "rematch?": true, false (said no or left), or null (not yet). */
  rematch: Record<Team, boolean | null>;
  /** Set once both said yes: the new game, already started. */
  rematchGameId: number | null;
  expired: boolean;
}

export const PICK_CLOCKS = [null, 30, 60, 90] as const;

export interface GameState {
  id: number;
  mode: GameMode;
  status: GameStatus;
  createdAt: string;
  settings: GameSettings;
  totalPicks: number;
  teamLabels: Record<Team, string>;
  cpuTeams: Team[];
  /** Coin-flip winner: picks first. */
  firstTeam: Team;
  currentTurn: { pickNumber: number; round: number; team: Team; label: string } | null;
  draftOrder: { pickNumber: number; round: number; team: Team; playerSeasonId: number | null }[];
  rosters: Record<Team, PlayerView[]>;
  available: PlayerView[];
  picks: PickView[];
  result: { winner: Winner; score: { A: number; B: number } } | null;
  online: OnlineView | null;
  serverNow: string;
}

export interface SeatGrant {
  gameId: number;
  token: string;
  team: Team;
  state: GameState;
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

export type RevealedPlayer = RevealResult['teams']['A']['players'][number];

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

// ------------------------------------------------------------ online seat tokens

// Your seat in an online game is a random token from the server. It's kept per tab (so two
// tabs in one browser can be two players, handy for testing) and per browser (so reopening
// the link later still finds your seat). The tab's copy wins.
const tokenKey = (gameId: number) => `fp-token-${gameId}`;

export function getToken(gameId: number): string | undefined {
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      const t = store().getItem(tokenKey(gameId));
      if (t) return t;
    } catch {
      // Storage blocked: try the next one.
    }
  }
  return undefined;
}

function setToken(gameId: number, token: string) {
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      store().setItem(tokenKey(gameId), token);
    } catch {
      // Private mode etc.: the in-memory copy below keeps the seat until the tab closes.
    }
  }
  memoryTokens.set(gameId, token);
}
const memoryTokens = new Map<number, string>();
const tokenFor = (gameId: number) => memoryTokens.get(gameId) ?? getToken(gameId);

const NAME_KEY = 'fp-name';
export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    // Not remembered.
  }
}

// ------------------------------------------------------------ server clock

// Online timings (coin flip, pick clock, reveal) are server timestamps. Each response carries
// the server's time, so we can convert them to this browser's clock.
let clockOffset = 0;
function syncClock(serverNow: string, sentAt: number) {
  const roundTrip = Date.now() - sentAt;
  clockOffset = Date.parse(serverNow) + roundTrip / 2 - Date.now();
}
/** A server timestamp in this browser's Date.now() terms. */
export const localTime = (iso: string) => Date.parse(iso) - clockOffset;

// ------------------------------------------------------------ requests

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  const sentAt = Date.now();
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Player-Token': token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the API server. Is it running on port 4000?');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? res.statusText);
  }
  const serverNow = (data as { serverNow?: string; state?: { serverNow?: string } })?.serverNow ?? data?.state?.serverNow;
  if (serverNow) syncClock(serverNow, sentAt);
  return data as T;
}

async function seat(path: string, body: unknown, name: string): Promise<SeatGrant> {
  const grant = await request<SeatGrant>('POST', path, body);
  setToken(grant.gameId, grant.token);
  saveName(name);
  return grant;
}

export const api = {
  createGame: (mode: Exclude<GameMode, 'online'>, settings: GameSettings) =>
    request<GameState>('POST', '/games', { mode, ...settings }),
  createOnline: (name: string, settings: GameSettings, pickSeconds: number | null) =>
    seat('/online/games', { name, pickSeconds, ...settings }, name),
  join: (code: string, name: string) => seat('/online/join', { code, name }, name),
  getGame: (id: number) => request<GameState>('GET', `/games/${id}`, undefined, tokenFor(id)),
  start: (id: number) => request<GameState>('POST', `/games/${id}/start`, undefined, tokenFor(id)),
  pick: (id: number, playerSeasonId: number, team: Team) =>
    request<PickResponse>('POST', `/games/${id}/picks`, { playerSeasonId, team }, tokenFor(id)),
  reveal: (id: number) => request<RevealResult>('POST', `/games/${id}/reveal`),
  /**
   * Your answer to "rematch?". Returns the new game's id once both said yes (your seat token
   * carries over to it), otherwise null.
   */
  rematch: async (id: number, accept = true) => {
    const r = await request<{ gameId: number | null }>('POST', `/games/${id}/rematch`, { accept }, tokenFor(id));
    if (r.gameId !== null) adoptRematch(id, r.gameId);
    return r;
  },
};

/** The rematch uses the same seat token as the game before it. */
export function adoptRematch(fromGameId: number, toGameId: number) {
  const t = tokenFor(fromGameId);
  if (t) setToken(toGameId, t);
}
