import { useMemo, useState } from 'react';
import { formatDate, formatPct, type Averages, type GameSettings, type PlayerView } from '../api';

type StatKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m' | 'fgPct' | 'ftPct' | 'tov';
type SortKey = 'name' | 'season' | 'team' | 'clue' | StatKey | 'value';

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
  title?: string;
  lowerIsBetter?: boolean;
}

const NAME_COLUMN: Column = { key: 'name', label: 'Player' };
const SEASON_TEAM_COLUMNS: Column[] = [
  { key: 'season', label: 'Season' },
  { key: 'team', label: 'Team' },
];
const CLUE_COLUMN: Column = {
  key: 'clue',
  label: 'Game',
  title: 'Date and opponent of the chosen game that will count. Its stats stay hidden until the reveal.',
};
const STAT_COLUMNS: Column[] = [
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

function sortValue(p: PlayerView, key: SortKey): string | number {
  if (key === 'name') return p.name;
  if (key === 'season' || key === 'team') return p[key] ?? '';
  if (key === 'clue') return p.gameClue?.gameDate ?? '';
  if (key === 'value') return p.value ?? 0;
  return p.averages?.[key] ?? -1;
}

type Visibility = Pick<GameSettings, 'showSeasonTeam' | 'showGameDate' | 'showAverages'>;

interface Props {
  players: PlayerView[];
  show: Visibility;
  canPick: boolean;
  pickLabel: string;
  busy: boolean;
  onPick: (player: PlayerView) => void;
}

function StatCells({ a, value }: { a: Averages; value: number | null }) {
  return (
    <>
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
      <td className="num strong">{(value ?? 0).toFixed(1)}</td>
    </>
  );
}

/** What's hidden, for the toolbar note. */
function hiddenNote(show: Visibility): string | null {
  const hidden = [
    !show.showSeasonTeam && 'season & team',
    !show.showAverages && 'averages',
    !show.showGameDate && 'game dates',
  ].filter(Boolean);
  return hidden.length ? `${hidden.join(', ')} hidden until the reveal` : null;
}

export default function PlayerTable({ players, show, canPick, pickLabel, busy, onPick }: Props) {
  const columns = [
    NAME_COLUMN,
    ...(show.showSeasonTeam ? SEASON_TEAM_COLUMNS : []),
    ...(show.showGameDate ? [CLUE_COLUMN] : []),
    ...(show.showAverages ? STAT_COLUMNS : []),
  ];
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(
    show.showAverages ? { key: 'value', dir: -1 } : { key: 'name', dir: 1 },
  );
  const [query, setQuery] = useState('');
  const note = hiddenNote(show);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (p: PlayerView) =>
      !q || [p.name, p.team, p.season, p.gameClue?.opponent].some((f) => f?.toLowerCase().includes(q));
    // Server order is the tiebreak (it's shuffled for same names when seasons are hidden).
    const index = new Map(players.map((p, i) => [p.id, i]));
    return players.filter(matches).sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      const cmp = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb));
      return cmp * sort.dir || index.get(a.id)! - index.get(b.id)!;
    });
  }, [players, query, sort]);

  function toggleSort(key: SortKey, numeric?: boolean, lowerIsBetter?: boolean) {
    // Numeric columns sort best-first on the first click.
    const first: 1 | -1 = numeric ? (lowerIsBetter ? 1 : -1) : 1;
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: first }));
  }

  const placeholder = `Search player${show.showSeasonTeam ? ', team or season' : ''}${show.showGameDate ? ', opponent' : ''}…`;

  return (
    <div className="pool">
      <div className="pool-toolbar">
        <input
          className="search"
          type="search"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search players"
        />
        <span className="muted small">
          {players.length} available{note && ` · ${note}`}
        </span>
      </div>

      <div className="table-wrap">
        <table className="player-table">
          <thead>
            <tr>
              {columns.map((c) => (
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
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="name">
                  {p.name}
                  {p.averages && (
                    <span className="gp">
                      {p.averages.gamesPlayed} GP · {p.averages.minutes.toFixed(0)} MPG
                    </span>
                  )}
                </td>
                {show.showSeasonTeam && (
                  <>
                    <td>{p.season}</td>
                    <td>{p.team}</td>
                  </>
                )}
                {show.showGameDate && (
                  <td className="game-cell">
                    {p.gameClue && (
                      <>
                        <span>{formatDate(p.gameClue.gameDate)}</span>
                        <span className="muted small">
                          {p.gameClue.isHome ? 'vs' : '@'} {p.gameClue.opponent}
                        </span>
                      </>
                    )}
                  </td>
                )}
                {show.showAverages && p.averages && <StatCells a={p.averages} value={p.value} />}
                <td className={show.showAverages ? undefined : 'pick-cell'}>
                  <button className="btn btn-pick" disabled={!canPick || busy} onClick={() => onPick(p)}>
                    {pickLabel}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="empty">
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
