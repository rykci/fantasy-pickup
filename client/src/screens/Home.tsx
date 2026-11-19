import { type ChangeEvent, useState } from 'react';
import { DEFAULT_SETTINGS, LIMITS, api, type GameMode, type GameSettings } from '../api';

const MODES: { value: GameMode; title: string; blurb: string }[] = [
  { value: 'vs_cpu', title: 'Solo vs CPU', blurb: 'You pick first. The CPU drafts the best available player — mostly.' },
  { value: 'pass_and_play', title: '2-Player', blurb: 'Pass-and-play on one screen. Player 1 picks first.' },
];

const VISIBILITY: { key: 'showSeasonTeam' | 'showGameDate' | 'showAverages'; label: string; hint: string }[] = [
  { key: 'showSeasonTeam', label: 'Season & team', hint: 'e.g. 1986-87 · CHI. Off: just the name.' },
  {
    key: 'showGameDate',
    label: 'Chosen game date & opponent',
    hint: 'A clue, e.g. Dec 25, 1996 vs BOS. The stats from that game stay secret.',
  },
  { key: 'showAverages', label: 'Season averages', hint: 'All 9 categories plus VAL, the 9-cat value vs. this pool.' },
];

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
    s.uniquePlayers && 'one season per player',
    `you see ${seen}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function Home({ onStart }: { onStart: (gameId: number) => void }) {
  const [mode, setMode] = useState<GameMode>('vs_cpu');
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
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

  async function start() {
    if (settingsError) return;
    setBusy(true);
    setError(null);
    try {
      const game = await api.createGame(mode, settings);
      onStart(game.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <section className="hero">
        <h1>Draft a team. Play one night.</h1>
        <p className="lede">
          A snake draft from a random pool of real player-seasons from 1983-84 to 2022-23. Every player-season already
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

      <button className="btn btn-primary btn-lg" onClick={start} disabled={busy || !!settingsError}>
        {busy ? 'Choosing games…' : 'Start Game'}
      </button>
      {(settingsError || error) && <p className="error">{settingsError ?? error}</p>}

      <section className="rules">
        <h2>How it works</h2>
        <ol>
          <li>
            <strong>A random pool.</strong> Drawn from the top 100 player-seasons of every season since 1983-84, ranked
            by 9-category value.
          </li>
          <li>
            <strong>Snake draft.</strong> Order: A B · B A · A B · … until both teams are full.
          </li>
          <li>
            <strong>Draft on what you know.</strong> By default you see each player&apos;s name, season and team. You can
            hide those too, or show the date of their chosen game or their season averages.
          </li>
          <li>
            <strong>One chosen game decides it.</strong> When the game is created, each player-season gets one random
            regular-season game from that season, hidden until the draft is over. Variance is the point.
          </li>
          <li>
            <strong>Nine categories:</strong> PTS, REB, AST, STL, BLK, 3PM, FG%, FT% and TO, team totals. FG% and FT%
            are team makes ÷ attempts; fewer turnovers wins TO. Win the most categories to win. If category wins are
            level, total PTS breaks the tie; if that's level too, it's a draw.
          </li>
        </ol>
      </section>
    </div>
  );
}
