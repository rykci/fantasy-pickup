import { formatDate, type PlayerView, type Team } from '../api';

/** "1986-87 · CHI · Dec 25, 1986 vs BOS · VAL 4.2", with whatever the game shows. */
function rosterMeta(p: PlayerView): string {
  const parts = [
    p.season && p.team ? `${p.season} · ${p.team}` : null,
    p.gameClue ? `${formatDate(p.gameClue.gameDate)} ${p.gameClue.isHome ? 'vs' : '@'} ${p.gameClue.opponent}` : null,
    p.value !== null ? `VAL ${p.value.toFixed(1)}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

interface Props {
  team: Team;
  label: string;
  players: PlayerView[];
  slots: number;
  onClock: boolean;
  isCpu: boolean;
  /** Player-seasons that just landed here: they drop in and flash. */
  fresh?: ReadonlySet<number>;
}

export default function Roster({ team, label, players, slots, onClock, isCpu, fresh }: Props) {
  const hidden = players.some((p) => p.value === null);
  const total = players.reduce((sum, p) => sum + (p.value ?? 0), 0);
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
            <li key={i} className={p ? `filled ${fresh?.has(p.id) ? 'just-picked' : ''}` : 'empty-slot'}>
              {p ? (
                <>
                  <span className="slot-name">{p.name}</span>
                  {rosterMeta(p) && <span className="slot-meta">{rosterMeta(p)}</span>}
                </>
              ) : (
                <span className="slot-name muted">Player {i + 1}</span>
              )}
            </li>
          );
        })}
      </ol>
      {!hidden && players.length > 0 && (
        <footer className="roster-foot muted small" title="Sum of 9-cat values vs. this pool, from season averages">
          Team VAL {total.toFixed(1)}
        </footer>
      )}
    </section>
  );
}
