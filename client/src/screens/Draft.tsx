import { useCallback, useEffect, useRef, useState } from 'react';
import { api, localTime, seasonRange, type GameState, type PickView, type PlayerView, type Team } from '../api';
import CoinFlip from '../components/CoinFlip';
import HowItWorks from '../components/HowItWorks';
import DraftOrder from '../components/DraftOrder';
import PlayerTable from '../components/PlayerTable';
import Roster from '../components/Roster';
import { sound, useMuted } from '../lib/sound';

/** "1986-87 Michael Jordan", or just the name when seasons are hidden. */
function withSeason(season: string | null, name: string): string {
  return season ? `${season} ${name}` : name;
}

const flipKey = (id: number) => `fp-flip-seen-${id}`;
function flipSeen(id: number): boolean {
  try {
    return localStorage.getItem(flipKey(id)) === '1';
  } catch {
    return false;
  }
}

/** Online: poll about once a second, slower while the tab is hidden. */
const POLL_MS = 1000;
const POLL_HIDDEN_MS = 4000;

function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PAGE_TITLE = 'Fantasy Pickup Basketball'; // matches index.html
/** Between two picks landing together (e.g. the CPU's snake double pick). */
const PICK_STAGGER_MS = 350;
/** How long a new roster entry stays highlighted. */
const FRESH_MS = 1600;

/** Ticks while `on`, so countdowns re-render. */
function useNow(on: boolean, every = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(id);
  }, [on, every]);
  return now;
}

interface Props {
  gameId: number;
  onComplete: () => void;
  onHome: () => void;
}

export default function Draft({ gameId, onComplete, onHome }: Props) {
  const [state, setState] = useState<GameState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flipDone, setFlipDone] = useState(() => flipSeen(gameId));
  const myPicks = useRef(new Set<number>());

  const online = state?.mode === 'online';
  const you = state?.online?.you ?? null;

  /** Applies a fresh state, ignoring stale ones, and announces picks made elsewhere. */
  const apply = useCallback((next: GameState) => {
    setState((prev) => {
      if (prev && next.picks.length < prev.picks.length) return prev; // an older poll arriving late
      if (prev && next.mode === 'online') {
        const fresh = next.picks.slice(prev.picks.length);
        const lines = fresh.map((p: PickView) =>
          p.team === next.online?.you
            ? myPicks.current.has(p.pickNumber)
              ? null
              : `Time ran out: you got ${withSeason(p.season, p.playerName)} (#${p.pickNumber}).`
            : `${next.teamLabels[p.team]} drafted ${withSeason(p.season, p.playerName)} (#${p.pickNumber}).`,
        );
        const text = lines.filter(Boolean).join(' ');
        if (text) setNotice(text);
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.getGame(gameId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [gameId, apply]);

  useEffect(() => {
    load();
  }, [load]);

  // Online: keep up with the other player.
  useEffect(() => {
    if (!online) return;
    let stop = false;
    let timer = 0;
    const poll = async () => {
      try {
        apply(await api.getGame(gameId));
      } catch {
        // Keep trying; a blip shouldn't end the game.
      }
      if (!stop) timer = window.setTimeout(poll, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    };
    timer = window.setTimeout(poll, POLL_MS);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [online, gameId, apply]);

  // Online: both players go to the reveal together when the draft ends.
  useEffect(() => {
    if (online && state?.status !== 'lobby' && state?.status !== 'drafting' && state?.online?.revealStartedAt) onComplete();
  }, [online, state?.status, state?.online?.revealStartedAt, onComplete]);

  const turnOpensAt = state?.online?.turnStartedAt ? localTime(state.online.turnStartedAt) : null;
  const deadline = state?.online?.turnDeadline ? localTime(state.online.turnDeadline) : null;
  const now = useNow(online && state?.status === 'drafting');

  const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set());
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [muted, setMuted] = useMuted();

  // New picks (yours, the CPU's, your friend's, or the clock's): a sound each, and they drop into the roster.
  const stateRef = useRef(state);
  stateRef.current = state;
  const seenPicks = useRef<number | null>(null);
  const pickCount = state?.picks.length;
  useEffect(() => {
    const s = stateRef.current;
    if (!s || pickCount === undefined) return;
    const before = seenPicks.current;
    seenPicks.current = pickCount;
    if (before === null || pickCount <= before) return; // first load: no fanfare for old picks
    const added = s.picks.slice(before);
    const timers = added.map((p, i) =>
      window.setTimeout(() => {
        // Lands on your team (online: including picks the clock made for you).
        const mine =
          s.mode === 'pass_and_play' || (s.mode === 'vs_cpu' ? !s.cpuTeams.includes(p.team) : p.team === s.online?.you);
        if (mine) sound.pickMine();
        else sound.pickTheirs();
      }, i * PICK_STAGGER_MS),
    );
    if (s.status !== 'drafting') {
      timers.push(window.setTimeout(() => sound.rostersLocked(), added.length * PICK_STAGGER_MS + 200));
    }
    setFresh(new Set(added.map((p) => p.playerSeasonId)));
    // Scheduled sounds keep playing even if we navigate away (online goes straight to the reveal).
  }, [pickCount]);

  useEffect(() => {
    if (fresh.size === 0) return;
    const id = window.setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => window.clearTimeout(id);
  }, [fresh]);

  // Online: chime when it becomes your turn, and say so in the tab title.
  const turnNow = state?.currentTurn ?? null;
  const flipPending = online && turnOpensAt !== null && now < turnOpensAt;
  const myTurnOpen = !!(online && state?.status === 'drafting' && turnNow && turnNow.team === you && !flipPending);
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (myTurnOpen && !wasMyTurn.current) sound.yourTurn();
    wasMyTurn.current = myTurnOpen;
    document.title = myTurnOpen ? '🏀 Your pick! · Fantasy Pickup' : PAGE_TITLE;
  }, [myTurnOpen]);
  useEffect(() => () => void (document.title = PAGE_TITLE), []);

  // Online: a quiet tick for the last 5 seconds of your pick clock.
  const secondsLeft = deadline !== null ? Math.ceil((deadline - now) / 1000) : null;
  useEffect(() => {
    if (myTurnOpen && secondsLeft !== null && secondsLeft >= 1 && secondsLeft <= 5) sound.clockTick(secondsLeft);
  }, [myTurnOpen, secondsLeft]);

  function finishFlip(s: GameState) {
    try {
      localStorage.setItem(flipKey(gameId), '1');
    } catch {
      // Not remembered; the flip just plays again on refresh.
    }
    setFlipDone(true);
    const cpuFirst = s.picks.filter((p) => s.cpuTeams.includes(p.team));
    if (cpuFirst.length > 0) {
      setNotice(
        `CPU won the flip and drafted ${cpuFirst.map((p) => `${withSeason(p.season, p.playerName)} (#${p.pickNumber})`).join(' and ')}.`,
      );
    }
  }

  async function pick(player: PlayerView) {
    if (!state?.currentTurn) return;
    const picker = state.teamLabels[state.currentTurn.team];
    setBusy(true);
    setError(null);
    setPendingId(player.id);
    myPicks.current.add(state.currentTurn.pickNumber);
    try {
      const res = await api.pick(gameId, player.id, state.currentTurn.team);
      apply(res.state);
      if (res.autoPicks.length > 0) {
        setNotice(`CPU drafted ${res.autoPicks.map((p) => `${withSeason(p.season, p.playerName)} (#${p.pickNumber})`).join(' and ')}.`);
      } else if (res.state.mode === 'pass_and_play' && res.state.currentTurn) {
        const next = res.state.currentTurn;
        setNotice(
          next.team === state.currentTurn.team
            ? `${picker} took ${withSeason(player.season, player.name)} — and picks again (snake turn).`
            : `${picker} took ${withSeason(player.season, player.name)}. Pass the device to ${next.label}.`,
        );
      } else {
        setNotice(`You drafted ${withSeason(player.season, player.name)}.`);
      }
    } catch (e) {
      setError((e as Error).message);
      await load(); // resync with the server's view of the draft
    } finally {
      setBusy(false);
      setPendingId(null);
    }
  }

  if (!state) {
    return error ? (
      <div className="panel center">
        <p className="error">{error}</p>
        <button className="btn" onClick={onHome}>
          Back home
        </button>
      </div>
    ) : (
      <p className="muted center">Loading draft…</p>
    );
  }

  if (state.status === 'lobby') return <Lobby state={state} onStarted={apply} onHome={onHome} />;

  const turn = state.currentTurn;
  const isCpuTurn = !!turn && state.cpuTeams.includes(turn.team);
  const complete = !turn;
  const waitingForFlip = online && turnOpensAt !== null && now < turnOpensAt;
  const myTurn = !!turn && (online ? turn.team === you : !isCpuTurn);
  const canPick = myTurn && !waitingForFlip;
  const pickLabel = turn && state.mode === 'pass_and_play' ? `Draft (${turn.label === 'Player 1' ? 'P1' : 'P2'})` : 'Draft';
  const opponent: Team | null = online && you ? (you === 'A' ? 'B' : 'A') : null;
  const opponentAway = !!opponent && state.online?.seats[opponent]?.connected === false;
  const showFlip =
    state.status === 'drafting' &&
    !flipDone &&
    (!online || (state.online?.flipAt !== null && Date.now() - localTime(state.online!.flipAt!) < 8000));

  let title: string;
  if (!turn) title = '';
  else if (waitingForFlip) title = 'Coin flip…';
  else if (online) title = turn.team === you ? "You're on the clock" : `${turn.label} is picking…`;
  else if (state.mode === 'vs_cpu') title = isCpuTurn ? 'CPU is picking…' : "You're on the clock";
  else title = `${turn.label}, you're on the clock`;

  return (
    <div className="draft">
      {showFlip && (
        <CoinFlip
          winner={state.firstTeam}
          labels={state.teamLabels}
          onDone={() => finishFlip(state)}
          you={you}
          startAt={online ? localTime(state.online!.flipAt!) : undefined}
          closeAt={online && turnOpensAt !== null ? turnOpensAt : undefined}
        />
      )}
      <div className={`turn-banner ${turn ? `team-${turn.team}` : 'complete'}`} role="status" aria-live="polite">
        {turn ? (
          <>
            <div>
              <div className="turn-kicker">
                Round {turn.round} of {state.settings.rosterSize} · Pick {turn.pickNumber} of {state.totalPicks}
                {online && you === null && ' · watching'}
              </div>
              <div className="turn-title">{title}</div>
            </div>
            <button
              className="btn btn-small mute-btn"
              onClick={() => setMuted(!muted)}
              aria-pressed={muted}
              title={muted ? 'Sound off' : 'Sound on'}
            >
              {muted ? '🔇' : '🔊'}
            </button>
            {deadline !== null && !waitingForFlip && (
              <div className={`pick-clock ${deadline - now < 10_000 ? 'urgent' : ''}`} aria-label="Time left for this pick">
                {clockText(deadline - now)}
              </div>
            )}
            {notice && <div className="turn-notice">{notice}</div>}
          </>
        ) : (
          <>
            <div>
              <div className="turn-kicker">Draft complete</div>
              <div className="turn-title">
                {online ? 'Rosters are set. The reveal is starting…' : 'Rosters are set. Time to see who showed up.'}
              </div>
            </div>
            {!online && (
              <button className="btn btn-primary btn-lg" onClick={onComplete}>
                Reveal the games →
              </button>
            )}
          </>
        )}
      </div>

      {opponentAway && turn && (
        <p className="muted small center away-note">
          {state.teamLabels[opponent!]} seems to be offline. The game waits for them
          {state.online?.pickSeconds ? ', and the pick clock keeps running.' : '.'}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <DraftOrder state={state} />

      <div className="draft-grid">
        <Roster
          team="A"
          label={state.teamLabels.A}
          players={state.rosters.A}
          slots={state.settings.rosterSize}
          onClock={turn?.team === 'A'}
          isCpu={state.cpuTeams.includes('A')}
          fresh={fresh}
        />
        {!complete ? (
          <PlayerTable
            players={state.available}
            show={state.settings}
            canPick={canPick}
            pickLabel={pickLabel}
            busy={busy}
            onPick={pick}
            pendingId={pendingId}
          />
        ) : (
          <div className="panel center pool-done">
            <p>
              All {state.totalPicks} picks are in. {state.available.length} player-seasons went undrafted.
            </p>
            <p className="muted small">
              Each player's game was chosen when this draft was created and hasn't changed since.
            </p>
          </div>
        )}
        <Roster
          team="B"
          label={state.teamLabels.B}
          players={state.rosters.B}
          slots={state.settings.rosterSize}
          onClock={turn?.team === 'B'}
          isCpu={state.cpuTeams.includes('B')}
          fresh={fresh}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ lobby

function Lobby({ state, onStarted, onHome }: { state: GameState; onStarted: (s: GameState) => void; onHome: () => void }) {
  const o = state.online!;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = `${window.location.origin}/?join=${o.roomCode}`;
  const host = o.seats.A;
  const guest = o.seats.B;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the link and copy it yourself.');
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      onStarted(await api.start(state.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (o.expired) {
    return (
      <div className="panel center lobby">
        <h2>This game expired</h2>
        <p className="muted">Games close after 24 hours without a pick.</p>
        <button className="btn btn-primary" onClick={onHome}>
          Start a new one
        </button>
      </div>
    );
  }

  const s = state.settings;
  return (
    <div className="lobby">
      <section className="panel lobby-room">
        <p className="coin-kicker">Room code</p>
        <div className="room-code">{o.roomCode}</div>
        {o.you === 'A' && (
          <div className="invite">
            <input className="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            <button className="btn btn-primary" onClick={copy}>
              {copied ? 'Copied!' : 'Copy invite link'}
            </button>
          </div>
        )}
        <p className="muted small">
          Teams of {s.rosterSize} · pool of {s.poolSize} · {seasonRange(s)}
          {s.uniquePlayers ? ' · one season per player' : ''} · pick clock {o.pickSeconds ? `${o.pickSeconds}s` : 'off'}
        </p>
      </section>

      <section className="panel lobby-seats" aria-label="Players">
        {(['A', 'B'] as Team[]).map((t) => {
          const seat = o.seats[t];
          return (
            <div key={t} className={`lobby-seat team-${t}`}>
              <span className={`presence ${seat?.connected ? 'on' : ''}`} aria-hidden />
              <span className="lobby-name">
                {seat ? seat.name : 'Waiting for your friend…'}
                {o.you === t && <span className="tag">You</span>}
              </span>
              <span className="muted small">{t === 'A' ? 'Host' : seat ? 'Joined' : ''}</span>
            </div>
          );
        })}
      </section>

      {o.you === 'A' ? (
        <button className="btn btn-primary btn-lg" onClick={start} disabled={busy || !guest}>
          {guest ? (busy ? 'Starting…' : 'Start the game') : 'Waiting for your friend to join…'}
        </button>
      ) : o.you === 'B' ? (
        <p className="center">Waiting for {host?.name ?? 'the host'} to start the game…</p>
      ) : (
        <p className="center muted">This game is for {host?.name} and a friend. Ask for an invite to play.</p>
      )}
      {error && <p className="error center">{error}</p>}
      {/* Friends who joined by link skip the home page: show them the rules while they wait. */}
      {o.you === 'B' && <HowItWorks className="lobby-rules" />}
    </div>
  );
}
