import { useEffect, useState } from 'react';
import { api, formatDate, formatPct, type CategoryResult, type FullPlayerView, type LockedGame, type RevealResult, type Team } from '../api';

type Counting = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m' | 'tov';
const COUNTING_COLS: { key: Counting; label: string }[] = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'fg3m', label: '3PM' },
];

/** Green = well above the season average, red = well below (reversed for TO). */
function heat(v: number, avg: number, lowerIsBetter = false): string {
  const hot = v >= avg * 1.25 + 0.5;
  const cold = v <= avg * 0.6 - 0.5;
  if (lowerIsBetter) return cold ? 'hot' : hot ? 'cold' : '';
  return hot ? 'hot' : cold ? 'cold' : '';
}

function categoryValue(c: CategoryResult, side: Team): string {
  const v = c[side];
  if (c.key === 'fgPct' || c.key === 'ftPct') return formatPct(v);
  return String(v);
}

function ShotCell({ made, att, avgPct }: { made: number; att: number; avgPct: number | null }) {
  const p = att > 0 ? made / att : null;
  // Only colour shooting nights with real volume.
  const cls =
    p === null || avgPct === null || att < 5 ? '' : p >= avgPct + 0.12 ? 'hot' : p <= avgPct - 0.15 ? 'cold' : '';
  return (
    <td className={`num ${cls}`} title={`${formatPct(p)} (season ${formatPct(avgPct)})`}>
      {made}-{att}
    </td>
  );
}

function PlayerRow({ p, g, delay }: { p: FullPlayerView & { pickNumber?: number }; g: LockedGame; delay: number }) {
  return (
    <tr className="reveal-row" style={{ animationDelay: `${delay}ms` }}>
      <td className="name">
        {p.name}
        <span className="gp">
          {p.season} · {p.team}
          {p.pickNumber !== undefined && ` · Pick #${p.pickNumber}`}
        </span>
      </td>
      <td className="game-cell">
        <span>{formatDate(g.gameDate)}</span>
        <span className="muted small">
          {g.team} {g.isHome ? 'vs' : '@'} {g.opponent} · {g.minutes} min
        </span>
      </td>
      {COUNTING_COLS.map((s) => (
        <td key={s.key} className={`num ${heat(g[s.key], p.averages[s.key])}`} title={`Season avg ${p.averages[s.key].toFixed(1)}`}>
          {g[s.key]}
        </td>
      ))}
      <ShotCell made={g.fgm} att={g.fga} avgPct={p.averages.fgPct} />
      <ShotCell made={g.ftm} att={g.fta} avgPct={p.averages.ftPct} />
      <td className={`num ${heat(g.tov, p.averages.tov, true)}`} title={`Season avg ${p.averages.tov.toFixed(1)}`}>
        {g.tov}
      </td>
    </tr>
  );
}

function LineTableHead() {
  return (
    <thead>
      <tr>
        <th>Player</th>
        <th>Chosen game</th>
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
  );
}

export default function Results({ gameId, onPlayAgain }: { gameId: number; onPlayAgain: () => void }) {
  const [result, setResult] = useState<RevealResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.reveal(gameId).then(setResult, (e: Error) => setError(e.message));
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
  if (!result) return <p className="muted center">Revealing the chosen games…</p>;

  const { winner, teamLabels, score } = result;
  const headline =
    winner === 'draw' ? "It's a draw" : result.mode === 'vs_cpu' && winner === 'A' ? 'You win!' : `${result.winnerLabel} wins`;

  return (
    <div className="results">
      <section className={`result-banner ${winner === 'draw' ? 'draw' : `team-${winner}`}`}>
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
        <h1>{headline}</h1>
        {result.decidedBy === 'points_tiebreak' && (
          <p className="tiebreak">Categories split evenly — decided on total points.</p>
        )}
        {result.decidedBy === 'draw' && <p className="tiebreak">Categories and total points were both level.</p>}
      </section>

      <section className="panel">
        <h2>Categories</h2>
        <table className="cat-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num team-A-text">{teamLabels.A}</th>
              <th className="num team-B-text">{teamLabels.B}</th>
            </tr>
          </thead>
          <tbody>
            {result.categories.map((c, i) => (
              <tr key={c.key} className="reveal-row" style={{ animationDelay: `${i * 100}ms` }}>
                <td>
                  {c.label}
                  {c.lowerIsBetter && <span className="muted small"> (fewer wins)</span>}
                </td>
                <td className={`num ${c.winner === 'A' ? 'cat-win team-A' : ''}`}>{categoryValue(c, 'A')}</td>
                <td className={`num ${c.winner === 'B' ? 'cat-win team-B' : ''}`}>{categoryValue(c, 'B')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Highlighted = category winner. Ties go to nobody. FG% and FT% are team makes ÷ team attempts.
        </p>
      </section>

      <div className="results-teams">
        {(['A', 'B'] as Team[]).map((t) => {
          const team = result.teams[t];
          return (
            <section key={t} className={`panel team-card team-${t}`}>
              <h2>
                <span className="team-dot" aria-hidden />
                {team.label}
              </h2>
              <div className="table-wrap">
                <table className="line-table">
                  <LineTableHead />
                  <tbody>
                    {team.players.map((p, i) => (
                      <PlayerRow key={p.id} p={p} g={p.lockedGame} delay={300 + i * 120} />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Team total</td>
                      {COUNTING_COLS.map((s) => (
                        <td key={s.key} className="num">
                          {team.totals[s.key]}
                        </td>
                      ))}
                      <td className="num" title={formatPct(team.totals.fga ? team.totals.fgm / team.totals.fga : null)}>
                        {team.totals.fgm}-{team.totals.fga}
                      </td>
                      <td className="num" title={formatPct(team.totals.fta ? team.totals.ftm / team.totals.fta : null)}>
                        {team.totals.ftm}-{team.totals.fta}
                      </td>
                      <td className="num">{team.totals.tov}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      {result.undrafted.length > 0 && (
        <section className="panel team-card undrafted">
          <h2>Undrafted</h2>
          <p className="muted small">
            Their games were chosen too, but don&apos;t count for either team. Best season first.
          </p>
          <div className="table-wrap">
            <table className="line-table">
              <LineTableHead />
              <tbody>
                {result.undrafted.map((p, i) => (
                  <PlayerRow key={p.id} p={p} g={p.lockedGame} delay={600 + i * 60} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="center">
        <button className="btn btn-primary btn-lg" onClick={onPlayAgain}>
          Play Again
        </button>
      </div>
    </div>
  );
}
