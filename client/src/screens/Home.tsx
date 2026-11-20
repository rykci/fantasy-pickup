import { type ChangeEvent, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  LIMITS,
  PICK_CLOCKS,
  SEASONS,
  api,
  savedName,
  seasonLabel,
  seasonRange,
  type GameMode,
  type GameSettings,
} from '../api';
import HowItWorks from '../components/HowItWorks';

const MODES: { value: GameMode; title: string; blurb: string }[] = [
  { value: 'vs_cpu', title: 'Solo vs CPU', blurb: 'A coin flip decides who picks first. The CPU drafts the best available player — mostly.' },
  { value: 'online', title: 'Online with a friend', blurb: 'Each on your own device. Create a game and send your friend the link.' },
  { value: 'pass_and_play', title: 'Pass-and-play', blurb: 'Two players on one screen. A coin flip decides who picks first.' },
];

const clockLabel = (s: number | null) => (s === null ? 'Off' : `${s}s`);

/** Join a friend's online game by code (an invite link fills the code in). */
function JoinGame({ invite, onJoined }: { invite?: string; onJoined: (gameId: number) => void }) {
  const [code, setCode] = useState(invite ?? '');
  const [name, setName] = useState(savedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const g = await api.join(code, name);
      onJoined(g.gameId);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className={`panel join-game ${invite ? 'invited' : ''}`} onSubmit={join}>
      <h2>{invite ? `You're invited to game ${invite}` : 'Join a friend’s game'}</h2>
      <div className="join-fields">
        {!invite && (
          <label className="setting">
            <span className="setting-label">Room code</span>
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="KX7P"
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
            />
          </label>
        )}
        <label className="setting">
          <span className="setting-label">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Name" autoFocus={!!invite} />
        </label>
        <button className="btn btn-primary" disabled={busy || !code.trim() || !name.trim()}>
          {busy ? 'Joining…' : 'Join game'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

const VISIBILITY: { key: 'showSeasonTeam' | 'showGameDate' | 'showAverages'; label: string; hint: string }[] = [
  { key: 'showSeasonTeam', label: 'Season & team', hint: 'e.g. 1986-87 · CHI. Off: just the name.' },
  {
    key: 'showGameDate',
    label: 'Chosen game date & opponent',
    hint: 'A clue, e.g. Dec 25, 1996 vs BOS. The stats from that game stay secret.',
  },
  { key: 'showAverages', label: 'Season averages', hint: 'All 9 categories plus VAL, the 9-cat value vs. this pool.' },
];

/** Quick picks for the season range. */
const ERAS: { label: string; from: number; to: number }[] = [
  { label: 'All', from: SEASONS.first, to: SEASONS.last },
  { label: '80s', from: SEASONS.first, to: 1989 },
  { label: '90s', from: 1990, to: 1999 },
  { label: '2000s', from: 2000, to: 2009 },
  { label: '2010s+', from: 2010, to: SEASONS.last },
];
const YEARS = Array.from({ length: SEASONS.last - SEASONS.first + 1 }, (_, i) => SEASONS.first + i);

/** One line for the collapsed settings, e.g. "Teams of 5 · pool of 15 · you see name, season & team". */
function settingsSummary(s: GameSettings): string {
  const shown = [
    'name',
    ...(s.showSeasonTeam ? ['season', 'team'] : []),
    s.showGameDate && 'game date',
    s.showAverages && 'averages',
  ].filter(Boolean) as string[];
  const seen = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} & ${shown.at(-1)}` : shown[0];
  const size = (n: number) => (Number.isNaN(n) ? '?' : n);
  return [
    `Teams of ${size(s.rosterSize)}`,
    `pool of ${size(s.poolSize)}`,
    seasonRange(s),
    s.uniquePlayers && 'one season per player',
    `you see ${seen}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function Home({ onStart, invite }: { onStart: (gameId: number) => void; invite?: string }) {
  const [mode, setMode] = useState<GameMode>('vs_cpu');
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [name, setName] = useState(savedName);
  const [pickSeconds, setPickSeconds] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minPool = settings.rosterSize * 2;
  const settingsError =
    !Number.isInteger(settings.rosterSize) || settings.rosterSize < LIMITS.minRoster || settings.rosterSize > LIMITS.maxRoster
      ? `Team size must be ${LIMITS.minRoster}–${LIMITS.maxRoster}.`
      : !Number.isInteger(settings.poolSize) || settings.poolSize < minPool || settings.poolSize > LIMITS.maxPool
        ? `Pool size must be ${minPool}–${LIMITS.maxPool} for teams of ${settings.rosterSize}.`
        : null;

  const setNumber = (key: 'poolSize' | 'rosterSize') => (e: ChangeEvent<HTMLInputElement>) =>
    setSettings((s) => ({ ...s, [key]: e.target.value === '' ? NaN : Number(e.target.value) }));

  const online = mode === 'online';
  const blocked = !!settingsError || (online && !name.trim());

  async function start() {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      const id = online
        ? (await api.createOnline(name, settings, pickSeconds)).gameId
        : (await api.createGame(mode as Exclude<GameMode, 'online'>, settings)).id;
      onStart(id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (invite) {
    return (
      <div className="home">
        <JoinGame invite={invite} onJoined={onStart} />
      </div>
    );
  }

  return (
    <div className="home">
      <section className="hero">
        <h1>Draft a team. Play one night.</h1>
        <p className="lede">
          A snake draft from a random pool of real player-seasons from 1983-84 to 2025-26. Every player-season already
          has one random real game from that season chosen — you just don't know which one until the draft ends.
        </p>
      </section>

      <section className="mode-picker" role="radiogroup" aria-label="Game mode">
        {MODES.map((m) => (
          <button
            key={m.value}
            role="radio"
            aria-checked={mode === m.value}
            className={`mode-card ${mode === m.value ? 'selected' : ''}`}
            onClick={() => setMode(m.value)}
          >
            <span className="mode-title">{m.title}</span>
            <span className="mode-blurb">{m.blurb}</span>
          </button>
        ))}
      </section>

      {online && (
        <section className="panel online-setup" aria-label="Online game">
          <label className="setting">
            <span className="setting-label">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Name" />
          </label>
          <div className="setting">
            <span className="setting-label">Pick clock</span>
            <div className="segmented" role="radiogroup" aria-label="Pick clock">
              {PICK_CLOCKS.map((c) => (
                <button
                  key={String(c)}
                  role="radio"
                  aria-checked={pickSeconds === c}
                  className={pickSeconds === c ? 'active' : ''}
                  onClick={() => setPickSeconds(c)}
                >
                  {clockLabel(c)}
                </button>
              ))}
            </div>
            <span className="setting-hint">When time runs out, the best available player is picked for you.</span>
          </div>
        </section>
      )}

      <details
        className="settings-details"
        open={settingsOpen || !!settingsError}
        onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
      >
        <summary>
          <span className="setting-label">Game settings</span>
          <span className="setting-hint">{settingsSummary(settings)}</span>
        </summary>
      <section className="settings" aria-label="Game settings">
        <label className="setting">
          <span className="setting-label">Team size</span>
          <input
            type="number"
            min={LIMITS.minRoster}
            max={LIMITS.maxRoster}
            value={Number.isNaN(settings.rosterSize) ? '' : settings.rosterSize}
            onChange={setNumber('rosterSize')}
          />
          <span className="setting-hint">players each, {LIMITS.minRoster}–{LIMITS.maxRoster}</span>
        </label>
        <label className="setting">
          <span className="setting-label">Pool size</span>
          <input
            type="number"
            min={minPool}
            max={LIMITS.maxPool}
            value={Number.isNaN(settings.poolSize) ? '' : settings.poolSize}
            onChange={setNumber('poolSize')}
          />
          <span className="setting-hint">player-seasons to draft from</span>
        </label>
        <label className="setting setting-check">
          <input
            type="checkbox"
            checked={settings.uniquePlayers}
            onChange={(e) => setSettings((s) => ({ ...s, uniquePlayers: e.target.checked }))}
          />
          <span>
            <span className="setting-label">One season per player</span>
            <span className="setting-hint">Off: the pool can hold 1988 Jordan and 1996 Jordan together.</span>
          </span>
        </label>
        <fieldset className="setting-group">
          <legend className="setting-label">Seasons</legend>
          <span className="setting-hint">
            Draw the pool from these seasons only. Eras play differently: 80s rosters hit far fewer threes.
          </span>
          <div className="segmented" role="radiogroup" aria-label="Era">
            {ERAS.map((e) => {
              const on = settings.fromSeason === e.from && settings.toSeason === e.to;
              return (
                <button
                  key={e.label}
                  role="radio"
                  aria-checked={on}
                  className={on ? 'active' : ''}
                  onClick={() => setSettings((s) => ({ ...s, fromSeason: e.from, toSeason: e.to }))}
                >
                  {e.label}
                </button>
              );
            })}
          </div>
          <div className="season-range">
            <label>
              <span className="setting-hint">From</span>
              <select
                value={settings.fromSeason}
                onChange={(e) => {
                  const from = Number(e.target.value);
                  setSettings((s) => ({ ...s, fromSeason: from, toSeason: Math.max(from, s.toSeason) }));
                }}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {seasonLabel(y)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="setting-hint">To</span>
              <select
                value={settings.toSeason}
                onChange={(e) => {
                  const to = Number(e.target.value);
                  setSettings((s) => ({ ...s, toSeason: to, fromSeason: Math.min(to, s.fromSeason) }));
                }}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {seasonLabel(y)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset className="setting-group">
          <legend className="setting-label">What you see while drafting</legend>
          <span className="setting-hint">
            Test your ball knowledge: the less you show, the more it comes down to what you know. Everything is
            revealed after the draft.
          </span>
          {VISIBILITY.map((v) => (
            <label key={v.key} className="setting setting-check">
              <input
                type="checkbox"
                checked={settings[v.key]}
                onChange={(e) => setSettings((s) => ({ ...s, [v.key]: e.target.checked }))}
              />
              <span>
                <span className="setting-label">{v.label}</span>
                <span className="setting-hint">{v.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>
      </details>

      <button className="btn btn-primary btn-lg" onClick={start} disabled={busy || blocked}>
        {busy ? 'Choosing games…' : online ? 'Create game' : 'Start Game'}
      </button>
      {(settingsError || error) && <p className="error">{settingsError ?? error}</p>}

      <JoinGame onJoined={onStart} />

      <HowItWorks />
    </div>
  );
}
