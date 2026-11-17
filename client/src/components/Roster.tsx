import type { PlayerView, Team } from '../api';

interface Props {
  team: Team;
  label: string;
  players: PlayerView[];
  slots: number;
  onClock: boolean;
  isCpu: boolean;
}

export default function Roster({ team, label, players, slots, onClock, isCpu }: Props) {
  const total = players.reduce((sum, p) => sum + p.value, 0);
  return (
    <section className={`roster team-${team} ${onClock ? 'on-clock' : ''}`} aria-label={`${label} roster`}>
      <header className="roster-head">
        <span className="team-dot" aria-hidden />
        <h3>
          {label}
          {isCpu && <span className="tag">CPU</span>}
        </h3>
        {onClock && <span className="on-clock-badge">On the clock</span>}
      </header>
      <ol className="roster-slots">
        {Array.from({ length: slots }, (_, i) => {
          const p = players[i];
          return (
            <li key={i} className={p ? 'filled' : 'empty-slot'}>
              {p ? (
                <>
                  <span className="slot-name">{p.name}</span>
                  <span className="slot-meta">
                    {p.season} · {p.team} · VAL {p.value.toFixed(1)}
                  </span>
                </>
              ) : (
                <span className="slot-name muted">Player {i + 1}</span>
              )}
            </li>
          );
        })}
      </ol>
      <footer className="roster-foot muted small" title="Sum of 9-cat values vs. this pool, from season averages">
        Team VAL {total.toFixed(1)}
      </footer>
    </section>
  );
}
