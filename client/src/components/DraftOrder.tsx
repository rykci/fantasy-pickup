import type { GameState } from '../api';

export default function DraftOrder({ state }: { state: GameState }) {
  const names = new Map(state.picks.map((p) => [p.pickNumber, p.playerName]));
  const current = state.currentTurn?.pickNumber;
  return (
    <ol className="draft-order" aria-label="Draft order">
      {state.draftOrder.map((s) => {
        const name = names.get(s.pickNumber);
        return (
          <li
            key={s.pickNumber}
            className={`order-chip team-${s.team} ${name ? 'done' : ''} ${s.pickNumber === current ? 'current' : ''}`}
            title={`Round ${s.round}, pick ${s.pickNumber}: ${state.teamLabels[s.team]}`}
          >
            <span className="chip-num">{s.pickNumber}</span>
            <span className="chip-label">{name ? lastName(name) : state.teamLabels[s.team]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function lastName(name: string): string {
  const parts = name.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}
