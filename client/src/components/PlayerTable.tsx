import { useMemo, useState } from 'react';
import { formatPct, type PlayerView } from '../api';

type SortKey =
  | 'name'
  | 'season'
  | 'team'
  | 'pts'
  | 'reb'
  | 'ast'
  | 'stl'
  | 'blk'
  | 'fg3m'
  | 'fgPct'
  | 'ftPct'
  | 'tov'
  | 'value';

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; title?: string; lowerIsBetter?: boolean }[] = [
  { key: 'name', label: 'Player' },
  { key: 'season', label: 'Season' },
  { key: 'team', label: 'Team' },
  { key: 'pts', label: 'PTS', numeric: true },
  { key: 'reb', label: 'REB', numeric: true },
  { key: 'ast', label: 'AST', numeric: true },
  { key: 'stl', label: 'STL', numeric: true },
  { key: 'blk', label: 'BLK', numeric: true },
  { key: 'fg3m', label: '3PM', numeric: true },
  { key: 'fgPct', label: 'FG%', numeric: true, title: 'Season FG% (attempts per game in the tooltip)' },
  { key: 'ftPct', label: 'FT%', numeric: true, title: 'Season FT% (attempts per game in the tooltip)' },
  { key: 'tov', label: 'TO', numeric: true, lowerIsBetter: true, title: 'Turnovers per game (fewer is better)' },
  {
    key: 'value',
    label: 'VAL',
    numeric: true,
    title:
      '9-cat value vs. this pool: sum of z-scores across all 9 categories (FG%/FT% weighted by attempts, TO reversed). 0 = pool average.',
  },
];

function value(p: PlayerView, key: SortKey): string | number {
  if (key === 'name' || key === 'season' || key === 'team') return p[key];
  if (key === 'value') return p.value;
  return p.averages[key] ?? -1;
}

interface Props {
  players: PlayerView[];
  canPick: boolean;
  pickLabel: string;
  busy: boolean;
  onPick: (player: PlayerView) => void;
}

export default function PlayerTable({ players, canPick, pickLabel, busy, onPick }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 });
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players
      .filter(
        (p) =>
          !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q) || p.season.includes(q),
      )
      .sort((a, b) => {
        const va = value(a, sort.key);
        const vb = value(b, sort.key);
        const cmp = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb));
        return cmp * sort.dir;
      });
  }, [players, query, sort]);

  function toggleSort(key: SortKey, numeric?: boolean, lowerIsBetter?: boolean) {
    // Numeric columns sort best-first on the first click.
    const first: 1 | -1 = numeric ? (lowerIsBetter ? 1 : -1) : 1;
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: first }));
  }

  return (
    <div className="pool">
      <div className="pool-toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search player, team or season…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search players"
        />
        <span className="muted small">{players.length} available</span>
      </div>

      <div className="table-wrap">
        <table className="player-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={c.numeric ? 'num' : undefined}
                  title={c.title}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                >
                  <button className="th-btn" onClick={() => toggleSort(c.key, c.numeric, c.lowerIsBetter)}>
                    {c.label}
                    {sort.key === c.key && <span className="sort-arrow">{sort.dir === 1 ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
              <th aria-label="Action" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const a = p.averages;
              return (
                <tr key={p.id}>
                  <td className="name">
                    {p.name}
                    <span className="gp">
                      {a.gamesPlayed} GP · {a.minutes.toFixed(0)} MPG
                    </span>
                  </td>
                  <td>{p.season}</td>
                  <td>{p.team}</td>
                  <td className="num">{a.pts.toFixed(1)}</td>
                  <td className="num">{a.reb.toFixed(1)}</td>
                  <td className="num">{a.ast.toFixed(1)}</td>
                  <td className="num">{a.stl.toFixed(1)}</td>
                  <td className="num">{a.blk.toFixed(1)}</td>
                  <td className="num">{a.fg3m.toFixed(1)}</td>
                  <td className="num" title={`${a.fgm.toFixed(1)}/${a.fga.toFixed(1)} per game`}>
                    {formatPct(a.fgPct)}
                  </td>
                  <td className="num" title={`${a.ftm.toFixed(1)}/${a.fta.toFixed(1)} per game`}>
                    {formatPct(a.ftPct)}
                  </td>
                  <td className="num">{a.tov.toFixed(1)}</td>
                  <td className="num strong">{p.value.toFixed(1)}</td>
                  <td>
                    <button className="btn btn-pick" disabled={!canPick || busy} onClick={() => onPick(p)}>
                      {pickLabel}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="empty">
                  No players match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
