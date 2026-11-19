import { useCallback, useEffect, useState } from 'react';
import { api, type GameState, type PlayerView } from '../api';
import DraftOrder from '../components/DraftOrder';
import PlayerTable from '../components/PlayerTable';
import Roster from '../components/Roster';

/** "1986-87 Michael Jordan", or just the name when seasons are hidden. */
function withSeason(season: string | null, name: string): string {
  return season ? `${season} ${name}` : name;
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

  const load = useCallback(async () => {
    try {
      setState(await api.getGame(gameId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [gameId]);

  useEffect(() => {
    load();
  }, [load]);

  async function pick(player: PlayerView) {
    if (!state?.currentTurn) return;
    const picker = state.teamLabels[state.currentTurn.team];
    setBusy(true);
    setError(null);
    try {
      const res = await api.pick(gameId, player.id, state.currentTurn.team);
      setState(res.state);
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
        setNotice(`${picker} drafted ${withSeason(player.season, player.name)}.`);
      }
    } catch (e) {
      setError((e as Error).message);
      await load(); // resync with the server's view of the draft
    } finally {
      setBusy(false);
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

  const turn = state.currentTurn;
  const isCpuTurn = !!turn && state.cpuTeams.includes(turn.team);
  const complete = !turn;
  const pickLabel = turn && state.mode === 'pass_and_play' ? `Draft (${turn.label === 'Player 1' ? 'P1' : 'P2'})` : 'Draft';

  return (
    <div className="draft">
      <div className={`turn-banner ${turn ? `team-${turn.team}` : 'complete'}`} role="status" aria-live="polite">
        {turn ? (
          <>
            <div>
              <div className="turn-kicker">
                Round {turn.round} of {state.settings.rosterSize} · Pick {turn.pickNumber} of {state.totalPicks}
              </div>
              <div className="turn-title">
                {state.mode === 'vs_cpu'
                  ? isCpuTurn
                    ? 'CPU is picking…'
                    : "You're on the clock"
                  : `${turn.label}, you're on the clock`}
              </div>
            </div>
            {notice && <div className="turn-notice">{notice}</div>}
          </>
        ) : (
          <>
            <div>
              <div className="turn-kicker">Draft complete</div>
              <div className="turn-title">Rosters are set. Time to see who showed up.</div>
            </div>
            <button className="btn btn-primary btn-lg" onClick={onComplete}>
              Reveal the games →
            </button>
          </>
        )}
      </div>

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
        />
        {!complete ? (
          <PlayerTable
            players={state.available}
            show={state.settings}
            canPick={!!turn && !isCpuTurn}
            pickLabel={pickLabel}
            busy={busy}
            onPick={pick}
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
        />
      </div>
    </div>
  );
}
