import { formatDate, formatPct, type CategoryResult, type RevealResult, type RevealedPlayer, type Team } from '../api';

const TEAMS: Team[] = ['A', 'B'];

export function headline(r: RevealResult): string {
  if (r.winner === 'draw') return "It's a draw";
  return r.mode === 'vs_cpu' && r.winner === 'A' ? 'You win!' : `${r.winnerLabel} wins`;
}

function bestLine(players: RevealedPlayer[]): RevealedPlayer {
  const score = (p: RevealedPlayer) => {
    const g = p.lockedGame;
    return g.pts + g.reb + g.ast + 2 * (g.stl + g.blk) - g.tov;
  };
  return players.reduce((best, p) => (score(p) > score(best) ? p : best));
}

function lineText(p: RevealedPlayer): string {
  const g = p.lockedGame;
  return `${g.pts} PTS · ${g.reb} REB · ${g.ast} AST · ${g.stl} STL · ${g.blk} BLK · ${g.fgm}-${g.fga} FG`;
}

/** A short summary for group chats. */
export function shareText(r: RevealResult): string {
  const { A, B } = r.teamLabels;
  const lines = [`🏀 Fantasy Pickup: ${A} ${r.score.A}–${r.score.B} ${B} · ${headline(r)}`];
  for (const t of TEAMS) {
    lines.push(`${r.teamLabels[t]}: ${r.teams[t].players.map((p) => `${p.name} (${p.season})`).join(', ')}`);
  }
  for (const t of TEAMS) {
    const p = bestLine(r.teams[t].players);
    lines.push(`Best line, ${r.teamLabels[t]}: ${p.name} — ${lineText(p)}`);
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ image

const C = {
  bg: '#0e1116',
  panel: '#161b22',
  border: '#2a3340',
  text: '#e8ecf1',
  muted: '#8b96a5',
  A: '#f28c28',
  B: '#3fb6d9',
};
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const W = 1120;
const ROW = 34;
const STAT_COLS: { label: string; get: (p: RevealedPlayer) => string }[] = [
  { label: 'PTS', get: (p) => String(p.lockedGame.pts) },
  { label: 'REB', get: (p) => String(p.lockedGame.reb) },
  { label: 'AST', get: (p) => String(p.lockedGame.ast) },
  { label: 'STL', get: (p) => String(p.lockedGame.stl) },
  { label: 'BLK', get: (p) => String(p.lockedGame.blk) },
  { label: '3PM', get: (p) => String(p.lockedGame.fg3m) },
  { label: 'FG', get: (p) => `${p.lockedGame.fgm}-${p.lockedGame.fga}` },
  { label: 'FT', get: (p) => `${p.lockedGame.ftm}-${p.lockedGame.fta}` },
  { label: 'TO', get: (p) => String(p.lockedGame.tov) },
];
const STAT_X = 590;
const STAT_W = 54;

function catValue(c: CategoryResult, side: Team): string {
  const v = c[side];
  return c.key === 'fgPct' || c.key === 'ftPct' ? formatPct(v) : String(v);
}

function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Draws the final box score and downloads it as a PNG. */
export async function downloadImage(r: RevealResult): Promise<void> {
  const rows = r.teams.A.players.length;
  const teamH = 52 + ROW * (rows + 2) + 24;
  const H = 300 + 2 * teamH + 40;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas is not available.');
  g.scale(scale, scale);
  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'middle';

  // Title and score.
  g.fillStyle = C.muted;
  g.font = `600 14px ${FONT}`;
  g.textAlign = 'center';
  g.fillText('🏀 FANTASY PICKUP', W / 2, 36);
  g.font = `800 64px ${FONT}`;
  g.fillStyle = C.A;
  g.textAlign = 'right';
  g.fillText(String(r.score.A), W / 2 - 34, 96);
  g.fillStyle = C.B;
  g.textAlign = 'left';
  g.fillText(String(r.score.B), W / 2 + 34, 96);
  g.fillStyle = C.muted;
  g.textAlign = 'center';
  g.fillText('–', W / 2, 92);
  g.font = `600 18px ${FONT}`;
  g.textAlign = 'right';
  g.fillStyle = C.A;
  g.fillText(r.teamLabels.A, W / 2 - 110, 98);
  g.textAlign = 'left';
  g.fillStyle = C.B;
  g.fillText(r.teamLabels.B, W / 2 + 110, 98);
  g.textAlign = 'center';
  g.fillStyle = C.text;
  g.font = `700 24px ${FONT}`;
  g.fillText(headline(r), W / 2, 148);

  // Categories.
  const catW = (W - 80) / r.categories.length;
  r.categories.forEach((c, i) => {
    const x = 40 + catW * i;
    const cx = x + catW / 2;
    g.fillStyle = C.panel;
    g.fillRect(x + 3, 180, catW - 6, 92);
    if (c.winner !== 'tie') {
      g.fillStyle = C[c.winner];
      g.fillRect(x + 3, 180, catW - 6, 3);
    }
    g.textAlign = 'center';
    g.fillStyle = C.muted;
    g.font = `600 12px ${FONT}`;
    g.fillText(c.label, cx, 200);
    for (const [side, y] of [
      ['A', 228],
      ['B', 254],
    ] as const) {
      g.fillStyle = c.winner === side ? C[side] : C.muted;
      g.font = `${c.winner === side ? 700 : 500} 17px ${FONT}`;
      g.fillText(catValue(c, side), cx, y);
    }
  });

  // Teams.
  let y = 300;
  for (const t of TEAMS) {
    const team = r.teams[t];
    g.textAlign = 'left';
    g.fillStyle = C[t];
    g.font = `700 20px ${FONT}`;
    g.fillText(team.label, 40, y + 20);
    y += 52;
    g.font = `600 12px ${FONT}`;
    g.fillStyle = C.muted;
    g.fillText('PLAYER', 40, y);
    g.fillText('CHOSEN GAME', 340, y);
    g.textAlign = 'right';
    STAT_COLS.forEach((s, i) => g.fillText(s.label, STAT_X + STAT_W * (i + 1), y));
    y += ROW / 2;
    for (const p of team.players) {
      g.strokeStyle = C.border;
      g.beginPath();
      g.moveTo(40, y);
      g.lineTo(W - 40, y);
      g.stroke();
      const mid = y + ROW / 2;
      const gm = p.lockedGame;
      g.textAlign = 'left';
      g.fillStyle = C.text;
      g.font = `600 15px ${FONT}`;
      g.fillText(fit(g, p.name, 180), 40, mid);
      g.fillStyle = C.muted;
      g.font = `400 13px ${FONT}`;
      g.fillText(`${p.season} ${p.team}`, 225, mid);
      g.fillText(fit(g, `${formatDate(gm.gameDate)} ${gm.isHome ? 'vs' : '@'} ${gm.opponent}`, 230), 340, mid);
      g.textAlign = 'right';
      g.fillStyle = C.text;
      g.font = `500 15px ${FONT}`;
      STAT_COLS.forEach((s, i) => g.fillText(s.get(p), STAT_X + STAT_W * (i + 1), mid));
      y += ROW;
    }
    const tot = team.totals;
    g.strokeStyle = C.border;
    g.beginPath();
    g.moveTo(40, y);
    g.lineTo(W - 40, y);
    g.stroke();
    const mid = y + ROW / 2;
    g.textAlign = 'left';
    g.fillStyle = C.muted;
    g.font = `600 14px ${FONT}`;
    g.fillText('Team total', 40, mid);
    g.textAlign = 'right';
    g.fillStyle = C.text;
    [tot.pts, tot.reb, tot.ast, tot.stl, tot.blk, tot.fg3m, `${tot.fgm}-${tot.fga}`, `${tot.ftm}-${tot.fta}`, tot.tov].forEach(
      (v, i) => g.fillText(String(v), STAT_X + STAT_W * (i + 1), mid),
    );
    y += ROW + 24;
  }

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not create the image.');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fantasy-pickup-game-${r.gameId}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
