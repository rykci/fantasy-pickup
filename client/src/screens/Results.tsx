import { useEffect, useMemo, useRef, useState } from 'react';
import {
  adoptRematch,
  api,
  formatDate,
  localTime,
  type GameState,
  formatPct,
  type CategoryResult,
  type FullPlayerView,
  type LockedGame,
  type RevealResult,
  type RevealedPlayer,
  type StatLine,
  type Team,
} from '../api';
import { downloadImage, headline as headlineFor, shareText } from '../lib/share';
import { addTo, emptyTotals, scoreCategories } from '../lib/score';
import { sound, useMuted, type Outcome } from '../lib/sound';

// The results page reveals itself. Every chosen game was fixed when the game was created;
// this plays them back round by round: both teams' Nth picks roll together, their chosen
// games land, then their stats fill in left to right. The final result shows when the last
// stat lands.

const TEAMS: Team[] = ['A', 'B'];
const STAT_COUNT = 9; // PTS REB AST STL BLK 3PM FG FT TO

type Counting = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m';
const COUNTING_COLS: { key: Counting; label: string }[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'fg3m', label: '3PM' },
];

// ------------------------------------------------------------------ timeline

const MS = { roll: 1100, land: 450, stat: 260, clutchStat: 700, rest: 1000, end: 0 };

type Step =
  | { kind: 'roll' | 'land'; round: number; picks: number[]; ms: number }
  | { kind: 'stat'; round: number; picks: number[]; j: number; ms: number }
  | { kind: 'rest'; ms: number }
  | { kind: 'end'; ms: number };

/** Stats a partly revealed line contributes (the first `shown` of the 9 columns). */
function partialLine(g: LockedGame, shown: number): Partial<StatLine> {
  const out: Partial<StatLine> = {};
  COUNTING_COLS.forEach((c, j) => {
    if (j < shown) out[c.key] = g[c.key];
  });
  if (shown > 6) Object.assign(out, { fgm: g.fgm, fga: g.fga });
  if (shown > 7) Object.assign(out, { ftm: g.ftm, fta: g.fta });
  if (shown > 8) out.tov = g.tov;
  return out;
}

function totalsOf(players: RevealedPlayer[], shownFor: (p: RevealedPlayer) => number): StatLine {
  const t = emptyTotals();
  for (const p of players) addTo(t, partialLine(p.lockedGame, shownFor(p)));
  return t;
}

/** Each team's players in pick order: the Nth entries of A and B make up round N. */
function buildTimeline(r: RevealResult) {
  const byRound = r.teams.A.players.map((_, i) => TEAMS.map((t) => r.teams[t].players[i].pickNumber));
  const lastRoundPicks = new Set(byRound.at(-1));

  // Slow the final round down when it decides something: a close finish or a lead change.
  const before = scoreCategories(
    totalsOf(r.teams.A.players, (p) => (lastRoundPicks.has(p.pickNumber) ? 0 : STAT_COUNT)),
    totalsOf(r.teams.B.players, (p) => (lastRoundPicks.has(p.pickNumber) ? 0 : STAT_COUNT)),
  ).score;
  const lead = (s: Record<Team, number>) => Math.sign(s.A - s.B);
  const clutch =
    byRound.length > 1 && (Math.abs(r.score.A - r.score.B) <= 2 || lead(before) !== lead(r.score));

  const steps: Step[] = [];
  const at = new Map<number, { roll: number; land: number; stats: number[] }>();
  byRound.forEach((picks, i) => {
    const round = i + 1;
    const last = round === byRound.length;
    const statMs = clutch && last ? MS.clutchStat : MS.stat;
    const roll = steps.push({ kind: 'roll', round, picks, ms: MS.roll }) - 1;
    const land = steps.push({ kind: 'land', round, picks, ms: MS.land }) - 1;
    const stats = Array.from(
      { length: STAT_COUNT },
      (_, j) => steps.push({ kind: 'stat', round, picks, j, ms: statMs }) - 1,
    );
    // The final result follows the last stat straight away.
    if (!last) steps.push({ kind: 'rest', ms: MS.rest });
    for (const p of picks) at.set(p, { roll, land, stats });
  });
  steps.push({ kind: 'end', ms: MS.end });
  const finalRoundStart = clutch ? at.get(byRound.at(-1)![0])!.roll : Infinity;
  // When each step starts, from the start of the reveal: both online screens follow this schedule.
  const starts: number[] = [];
  steps.reduce((t, st) => (starts.push(t), t + st.ms), 0);
  return { steps, starts, at, rounds: byRound.length, end: steps.length - 1, before, finalRoundStart };
}

/** The step playing `elapsed` ms into the reveal. */
function stepAt(starts: number[], elapsed: number): number {
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= elapsed) i++;
  return i;
}

// ------------------------------------------------------------------ helpers

const seenKey = (id: number) => `fp-reveal-seen-${id}`;
function wasSeen(id: number): boolean {
  try {
    return localStorage.getItem(seenKey(id)) === '1';
  } catch {
    return false;
  }
}
function markSeen(id: number) {
  try {
    localStorage.setItem(seenKey(id), '1');
  } catch {
    // Not remembered; the reveal just plays again next time.
  }
}

function outcomeFor(r: RevealResult, you: Team | null): Outcome {
  if (r.winner === 'draw') return 'draw';
  if (r.mode === 'online') return you && r.winner !== you ? 'lose' : 'win';
  return r.mode === 'vs_cpu' && r.winner === 'B' ? 'lose' : 'win';
}

/** Green = well above the season average, red = well below (reversed for TO). */
function heat(v: number, avg: number, lowerIsBetter = false): string {
  const hot = v >= avg * 1.25 + 0.5;
  const cold = v <= avg * 0.6 - 0.5;
  if (lowerIsBetter) return cold ? 'hot' : hot ? 'cold' : '';
  return hot ? 'hot' : cold ? 'cold' : '';
}

function catText(c: CategoryResult, side: Team): string {
  const v = c[side];
  if (c.key === 'fgPct' || c.key === 'ftPct') return formatPct(v);
  return String(v ?? 0);
}

/** A believable date and opponent to flash while a chosen game rolls. */
function rollingGame(p: RevealedPlayer, opponents: string[]): { date: string; matchup: string } {
  const y = Number(p.season.slice(0, 4));
  const start = Date.UTC(y, 10, 1);
  const end = Date.UTC(y + 1, 3, 15);
  const d = new Date(start + Math.random() * (end - start)).toISOString().slice(0, 10);
  const opp = opponents[Math.floor(Math.random() * opponents.length)];
  return { date: formatDate(d), matchup: `${Math.random() < 0.5 ? 'vs' : '@'} ${opp}` };
}

// ------------------------------------------------------------------ pieces

interface RowState {
  rolling: boolean;
  landed: boolean;
  shown: number;
}
const FULL: RowState = { rolling: false, landed: true, shown: STAT_COUNT };

function ShotCell({ made, att, avgPct, shown }: { made: number; att: number; avgPct: number | null; shown: boolean }) {
  if (!shown) return <td className="num blank">·</td>;
  const p = att > 0 ? made / att : null;
  // Only colour shooting nights with real volume.
  const cls =
    p === null || avgPct === null || att < 5 ? '' : p >= avgPct + 0.12 ? 'hot' : p <= avgPct - 0.15 ? 'cold' : '';
  return (
    <td className={`num stat-in ${cls}`} title={`${formatPct(p)} (season ${formatPct(avgPct)})`}>
      {made}-{att}
    </td>
  );
}

/** True on phone-width screens: the box score switches to its compact layout. */
function useNarrow(query = '(max-width: 640px)'): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

/** The chosen game: landed, rolling, or not yet. Always two lines, so nothing shifts. */
function GameInfo({ g, state, rollText }: { g: LockedGame; state: RowState; rollText?: { date: string; matchup: string } }) {
  const { rolling, landed } = state;
  if (landed) {
    return (
      <span className="stat-in game-landed">
        <span>{formatDate(g.gameDate)}</span>
        <span className="muted small">
          {g.team} {g.isHome ? 'vs' : '@'} {g.opponent} · {g.minutes} min
        </span>
      </span>
    );
  }
  if (rolling && rollText) {
    // Same two-line shape as a landed game, so nothing shifts while it rolls.
    return (
      <span className="game-rolling">
        <span>{rollText.date}</span>
        <span className="small">{rollText.matchup}</span>
      </span>
    );
  }
  return (
    <span className="game-landed">
      <span className="muted">Not rolled yet</span>
      <span className="small">{'\u00a0'}</span>
    </span>
  );
}

function PlayerRow({
  p,
  g,
  state,
  rollText,
  rowRef,
  compact,
}: {
  p: FullPlayerView & { pickNumber?: number };
  g: LockedGame;
  state: RowState;
  rollText?: { date: string; matchup: string };
  rowRef?: (el: HTMLTableRowElement | null) => void;
  /** Phones: the chosen game goes under the name instead of in its own column. */
  compact?: boolean;
}) {
  const { rolling, landed, shown } = state;
  const meta = `${landed ? `${p.season} · ${p.team}` : 'Season ?'}${p.pickNumber !== undefined ? ` · #${p.pickNumber}` : ''}`;
  return (
    <tr ref={rowRef} className={`box-row ${rolling ? 'rolling' : ''} ${landed && shown < STAT_COUNT ? 'filling' : ''}`}>
      <td className="name">
        {p.name}
        <span className="gp">{compact ? meta : meta.replace(' · #', ' · Pick #')}</span>
        {compact && (
          <span className="gp game-under-name">
            <GameInfo g={g} state={state} rollText={rollText} />
          </span>
        )}
      </td>
      {!compact && (
        <td className="game-cell">
          <GameInfo g={g} state={state} rollText={rollText} />
        </td>
      )}
      {COUNTING_COLS.map((s, j) =>
        j < shown ? (
          <td
            key={s.key}
            className={`num stat-in ${heat(g[s.key], p.averages[s.key])}`}
            title={`Season avg ${p.averages[s.key].toFixed(1)}`}
          >
            {g[s.key]}
          </td>
        ) : (
          <td key={s.key} className="num blank">
            ·
          </td>
        ),
      )}
      <ShotCell made={g.fgm} att={g.fga} avgPct={p.averages.fgPct} shown={shown > 6} />
      <ShotCell made={g.ftm} att={g.fta} avgPct={p.averages.ftPct} shown={shown > 7} />
      {shown > 8 ? (
        <td className={`num stat-in ${heat(g.tov, p.averages.tov, true)}`} title={`Season avg ${p.averages.tov.toFixed(1)}`}>
          {g.tov}
        </td>
      ) : (
        <td className="num blank">·</td>
      )}
    </tr>
  );
}

/**
 * Fixed column widths: the box score keeps its shape while games roll and stats land.
 * Compact (phones): no game column, and percentages so all 9 stats fit the screen.
 */
const COL_WIDTHS = ['200px', '190px', ...COUNTING_COLS.map(() => '56px'), '66px', '66px', '48px'];
const COMPACT_COL_WIDTHS = ['28%', ...COUNTING_COLS.map(() => '7%'), '11%', '10%', '9%'];

function LineTableHead({ compact }: { compact?: boolean }) {
  return (
    <>
      <colgroup>
        {(compact ? COMPACT_COL_WIDTHS : COL_WIDTHS).map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
      <thead>
      <tr>
        <th>Player</th>
        {!compact && <th>Chosen game</th>}
        {COUNTING_COLS.map((s) => (
          <th key={s.key} className="num">
            {s.label}
          </th>
        ))}
        <th className="num">FG</th>
        <th className="num">FT</th>
        <th className="num">TO</th>
      </tr>
      </thead>
    </>
  );
}

function LiveScoreboard({ r, cats, score }: { r: RevealResult; cats: CategoryResult[]; score: Record<Team, number> }) {
  const lead = score.A > score.B ? 'A' : score.B > score.A ? 'B' : null;
  return (
    <div className="live-board">
      <div className="sb-score">
        <span className={`sb-team team-A ${lead === 'A' ? 'leading' : ''}`}>
          <span className="sb-label">{r.teamLabels.A}</span>
          <span className="sb-num" key={`A${score.A}`}>
            {score.A}
          </span>
        </span>
        <span className="sb-dash">–</span>
        <span className={`sb-team team-B ${lead === 'B' ? 'leading' : ''}`}>
          <span className="sb-num" key={`B${score.B}`}>
            {score.B}
          </span>
          <span className="sb-label">{r.teamLabels.B}</span>
        </span>
      </div>
      <div className="sb-cats">
        {cats.map((c) => (
          <div key={c.key} className={`sb-cat ${c.winner === 'tie' ? '' : `win-${c.winner}`}`}>
            <span className="sb-cat-label">{c.label}</span>
            <span className="sb-cat-val team-A-text">{catText(c, 'A')}</span>
            <span className="sb-cat-val team-B-text">{catText(c, 'B')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinalCategories({ r }: { r: RevealResult }) {
  return (
    <div className="final-cats">
      {r.categories.map((c) => (
        <div key={c.key} className={`final-cat ${c.winner === 'tie' ? 'tie' : `win-${c.winner}`}`}>
          <span className="final-cat-label">
            {c.label}
            {c.lowerIsBetter && <span className="final-cat-note">fewer wins</span>}
          </span>
          {TEAMS.map((t) => (
            <span key={t} className={`final-cat-val ${c.winner === t ? `won team-${t}` : ''}`}>
              {catText(c, t)}
            </span>
          ))}
          <span className="final-cat-winner">{c.winner === 'tie' ? 'Tie' : r.teamLabels[c.winner]}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ screen

interface ResultsProps {
  gameId: number;
  onPlayAgain: () => void;
  onRematch: (gameId: number) => void;
}

export default function Results({ gameId, onPlayAgain, onRematch }: ResultsProps) {
  const [result, setResult] = useState<RevealResult | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.reveal(gameId), api.getGame(gameId)]).then(
      ([r, s]) => {
        setState(s);
        setResult(r);
      },
      (e: Error) => setError(e.message),
    );
  }, [gameId]);

  if (error) {
    return (
      <div className="panel center">
        <p className="error">{error}</p>
        <button className="btn" onClick={onPlayAgain}>
          Back home
        </button>
      </div>
    );
  }
  if (!result || !state) return <p className="muted center">Revealing the chosen games…</p>;
  return <RevealedResults result={result} state={state} onPlayAgain={onPlayAgain} onRematch={onRematch} />;
}

function RevealedResults({
  result,
  state,
  onPlayAgain,
  onRematch,
}: {
  result: RevealResult;
  state: GameState;
  onPlayAgain: () => void;
  onRematch: (gameId: number) => void;
}) {
  const tl = useMemo(() => buildTimeline(result), [result]);
  const compact = useNarrow();
  const online = state.online;
  const you = online?.you ?? null;
  // Online: both screens run the reveal from the server's start time. Local: from now, unless already watched.
  const [t0, setT0] = useState(() =>
    online?.revealStartedAt ? localTime(online.revealStartedAt) : wasSeen(result.gameId) ? -Infinity : Date.now(),
  );
  const [cursor, setCursor] = useState(() => (t0 > Date.now() ? 0 : stepAt(tl.starts, Date.now() - t0)));
  const [waiting, setWaiting] = useState(() => t0 > Date.now());
  const [, setFlicker] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [muted, setMuted] = useMuted();
  const [rematchId, setRematchId] = useState<number | null>(online?.rematchGameId ?? null);
  const [rematching, setRematching] = useState(false);
  const live = useRef(cursor < tl.end); // false when we open straight onto the result: no sounds
  const rows = useRef(new Map<number, HTMLTableRowElement>());
  const top = useRef<HTMLDivElement>(null);
  const opponents = useMemo(
    () => [...new Set(TEAMS.flatMap((t) => result.teams[t].players.map((p) => p.lockedGame.opponent)))],
    [result],
  );

  const step = tl.steps[cursor];
  const done = cursor >= tl.end;

  // Online: hold until the shared start time.
  useEffect(() => {
    if (!waiting) return;
    const id = window.setTimeout(() => setWaiting(false), Math.max(0, t0 - Date.now()));
    const tick = window.setInterval(() => setFlicker((n) => n + 1), 250); // redraw the countdown
    return () => {
      window.clearTimeout(id);
      window.clearInterval(tick);
    };
  }, [waiting, t0]);

  // Advance through the timeline, on schedule.
  useEffect(() => {
    if (!live.current || done || waiting) return;
    if (step.kind === 'roll') {
      // Bring both rows into view: B's table is below A's.
      rows.current.get(step.picks.at(-1)!)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (step.kind === 'land') sound.land();
    if (step.kind === 'stat') sound.clack();
    const flick = step.kind === 'roll' ? window.setInterval(() => {
      setFlicker((n) => n + 1);
      sound.tick();
    }, 70) : undefined;
    const nextAt = t0 + tl.starts[cursor + 1];
    // Always move forward at least one step: a timer can fire a millisecond before Date.now() says the
    // next step is due, and setting the same step again would stall the reveal (no re-render, no new timer).
    const id = window.setTimeout(
      () => setCursor((c) => Math.max(c + 1, stepAt(tl.starts, Date.now() - t0))),
      Math.max(0, nextAt - Date.now()),
    );
    return () => {
      window.clearTimeout(id);
      window.clearInterval(flick);
    };
  }, [cursor, done, step, waiting, t0, tl]);

  // Online, after the result: watch for a rematch started by the other player.
  useEffect(() => {
    if (!online || !done || rematchId !== null) return;
    const id = window.setInterval(async () => {
      try {
        const s = await api.getGame(result.gameId);
        if (s.online?.rematchGameId) setRematchId(s.online.rematchGameId);
      } catch {
        // Try again next time.
      }
    }, 2500);
    return () => window.clearInterval(id);
  }, [online, done, rematchId, result.gameId]);

  async function rematch() {
    setRematching(true);
    try {
      if (rematchId !== null) {
        adoptRematch(result.gameId, rematchId);
        onRematch(rematchId);
      } else {
        onRematch((await api.rematch(result.gameId)).gameId);
      }
    } catch (e) {
      setNote((e as Error).message);
      setRematching(false);
    }
  }

  // The end: show the result at the top, play the result sound once, remember the reveal was watched.
  const ended = useRef(false);
  useEffect(() => {
    if (!done || ended.current) return;
    ended.current = true;
    markSeen(result.gameId);
    if (live.current) {
      sound.slam();
      sound.swell(outcomeFor(result, you));
      top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [done, result]);

  function rowState(pick: number): RowState {
    const a = tl.at.get(pick)!;
    return {
      rolling: cursor === a.roll,
      landed: cursor >= a.land,
      shown: a.stats.filter((i) => cursor >= i).length,
    };
  }

  function replay() {
    live.current = true;
    ended.current = false;
    setWaiting(false);
    setT0(Date.now());
    setCursor(0);
    window.scrollTo(0, 0);
  }

  function skip() {
    setWaiting(false);
    setCursor(tl.end);
    top.current?.scrollIntoView({ block: 'start' });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareText(result));
      setNote('Copied to clipboard.');
    } catch {
      setNote('Could not copy. Your browser blocked clipboard access.');
    }
  }

  async function download() {
    try {
      await downloadImage(result);
      setNote(null);
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  const { winner, teamLabels, score } = result;
  const live9 = scoreCategories(
    totalsOf(result.teams.A.players, (p) => rowState(p.pickNumber).shown),
    totalsOf(result.teams.B.players, (p) => rowState(p.pickNumber).shown),
  );
  const nowRolling = step.kind === 'roll' || step.kind === 'land' || step.kind === 'stat' ? step.round : null;
  const inFinalRound = cursor >= tl.finalRoundStart && !done;
  const b = tl.before;
  const finalRoundNote =
    b.A === b.B
      ? `all square at ${b.A}–${b.B}`
      : `${teamLabels[b.A > b.B ? 'A' : 'B']} leads ${Math.max(b.A, b.B)}–${Math.min(b.A, b.B)}`;

  return (
    <div className="results" ref={top}>
      {done ? (
        <section className={`result-banner final ${winner === 'draw' ? 'draw' : `team-${winner}`}`}>
          <div className="final-score" aria-label={`Final score ${score.A} to ${score.B}`}>
            <span className="score-team team-A">
              <span className="score-label">{teamLabels.A}</span>
              <span className="score-num">{score.A}</span>
            </span>
            <span className="score-dash">–</span>
            <span className="score-team team-B">
              <span className="score-num">{score.B}</span>
              <span className="score-label">{teamLabels.B}</span>
            </span>
          </div>
          <h1>{headlineFor(result, you)}</h1>
          {result.decidedBy === 'points_tiebreak' && (
            <p className="tiebreak">Categories split evenly — decided on total points.</p>
          )}
          {result.decidedBy === 'draw' && <p className="tiebreak">Categories and total points were both level.</p>}
          <FinalCategories r={result} />
          <p className="muted small">FG% and FT% are team makes ÷ team attempts. Ties go to nobody.</p>
        </section>
      ) : (
        <section className="reveal-bar">
          <LiveScoreboard r={result} cats={live9.categories} score={live9.score} />
          <div className="reveal-controls">
            <span className="muted">
              {waiting ? (
                `The reveal starts in ${Math.max(1, Math.ceil((t0 - Date.now()) / 1000))}…`
              ) : inFinalRound ? (
                <strong className="clutch-note">Final round · {finalRoundNote}</strong>
              ) : nowRolling ? (
                `Rolling round ${nowRolling} of ${tl.rounds}`
              ) : (
                'Rolling the chosen games…'
              )}
            </span>
            <span className="reveal-buttons">
              <button className="btn btn-small" onClick={() => setMuted(!muted)} aria-pressed={muted}>
                {muted ? '🔇 Sound off' : '🔊 Sound on'}
              </button>
              <button className="btn btn-small" onClick={skip}>
                Skip to result »
              </button>
            </span>
          </div>
        </section>
      )}

      {done && (
        <>
          <div className="result-actions">
            <button className="btn" onClick={replay}>
              ↺ Replay reveal
            </button>
            <button className="btn" onClick={download}>
              ⬇ Download image
            </button>
            <button className="btn" onClick={copy}>
              Copy as text
            </button>
            <button className="btn" onClick={() => setMuted(!muted)} aria-pressed={muted}>
              {muted ? '🔇 Sound off' : '🔊 Sound on'}
            </button>
          </div>
          {note && <p className="muted small center">{note}</p>}
        </>
      )}

      <div className="results-teams">
        {TEAMS.map((t) => {
          const team = result.teams[t];
          const tot = totalsOf(team.players, (p) => rowState(p.pickNumber).shown);
          return (
            <section key={t} className={`panel team-card team-${t}`}>
              <h2>
                <span className="team-dot" aria-hidden />
                {team.label}
              </h2>
              <div className="table-wrap">
                <table className={`line-table ${compact ? 'compact' : ''}`}>
                  <LineTableHead compact={compact} />
                  <tbody>
                    {team.players.map((p) => {
                      const st = rowState(p.pickNumber);
                      return (
                        <PlayerRow
                          key={p.id}
                          p={p}
                          g={p.lockedGame}
                          state={st}
                          rollText={st.rolling ? rollingGame(p, opponents) : undefined}
                          compact={compact}
                          rowRef={(el) => {
                            if (el) rows.current.set(p.pickNumber, el);
                          }}
                        />
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={compact ? 1 : 2}>Team total</td>
                      {COUNTING_COLS.map((s) => (
                        <td key={s.key} className="num">
                          {tot[s.key]}
                        </td>
                      ))}
                      <td className="num" title={formatPct(tot.fga ? tot.fgm / tot.fga : null)}>
                        {tot.fgm}-{tot.fga}
                      </td>
                      <td className="num" title={formatPct(tot.fta ? tot.ftm / tot.fta : null)}>
                        {tot.ftm}-{tot.fta}
                      </td>
                      <td className="num">{tot.tov}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      {done && result.undrafted.length > 0 && (
        <section className="panel team-card undrafted">
          <h2>Undrafted</h2>
          <p className="muted small">
            Their games were chosen too, but don&apos;t count for either team. Best season first.
          </p>
          <div className="table-wrap">
            <table className={`line-table ${compact ? 'compact' : ''}`}>
              <LineTableHead compact={compact} />
              <tbody>
                {result.undrafted.map((p) => (
                  <PlayerRow key={p.id} p={p} g={p.lockedGame} state={FULL} compact={compact} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {done && (
        <div className="center end-actions">
          {online && you ? (
            <>
              <button className="btn btn-primary btn-lg" onClick={rematch} disabled={rematching}>
                {rematchId !== null ? `Join the rematch →` : rematching ? 'Setting up…' : 'Rematch'}
              </button>
              {rematchId !== null && !rematching && (
                <p className="muted small">A rematch is ready, same settings and a new coin flip.</p>
              )}
              <button className="btn" onClick={onPlayAgain}>
                Home
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={onPlayAgain}>
              Play Again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
