import { useState } from 'react';

// The rules as five illustrated steps. Open for first-time visitors; collapsed once
// they've watched a reveal (the results page leaves an fp-reveal-seen-<id> key behind).

function hasPlayed(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith('fp-reveal-seen-')) return true;
    }
  } catch {
    // Storage blocked: treat as new.
  }
  return false;
}

/** Face-down cards fanned out. */
function PoolArt() {
  return (
    <div className="hiw-fan" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="hiw-mini-card" style={{ '--i': i } as React.CSSProperties}>
          <span className="hiw-line" />
          <span className="hiw-line short" />
        </span>
      ))}
    </div>
  );
}

/** A coin, then the snake order. */
function SnakeArt() {
  const order = ['A', 'B', 'B', 'A', 'A', 'B'];
  return (
    <div className="hiw-snake" aria-hidden>
      <span className="hiw-coin">A</span>
      <span className="hiw-order">
        {order.map((t, i) => (
          <span key={i} className={`hiw-chip team-${t}`}>
            {t}
          </span>
        ))}
      </span>
    </div>
  );
}

/** A player card showing only the name. */
function KnowledgeArt() {
  return (
    <div className="hiw-player" aria-hidden>
      <span className="hiw-name">Player name</span>
      <span className="hiw-tags">
        <span className="hiw-tag blurred">1996-97</span>
        <span className="hiw-tag blurred">CHI</span>
      </span>
    </div>
  );
}

/** A hidden game that turns into a stat line. */
function SecretGameArt() {
  return (
    <div className="hiw-secret" aria-hidden>
      <span className="hiw-mystery">?</span>
      <span className="hiw-arrow">→</span>
      <span className="hiw-statline">
        <span className="hot">34</span> PTS · 9 REB · <span className="cold">1</span> AST
      </span>
    </div>
  );
}

/** A 5–4 scoreboard with each category in its winner's color. */
function CategoriesArt() {
  const winners = ['A', 'B', 'A', 'A', 'B', 'B', 'A', 'B', 'A'];
  return (
    <div className="hiw-score" aria-hidden>
      <span className="hiw-result">
        <span className="team-A-text">5</span>–<span className="team-B-text">4</span>
      </span>
      <span className="hiw-cats">
        {winners.map((t, i) => (
          <span key={i} className={`hiw-cat team-${t}`} />
        ))}
      </span>
    </div>
  );
}

const STEPS: { title: string; text: string; Art: () => React.JSX.Element }[] = [
  {
    title: 'A random pool',
    text: 'Drawn from the top 100 player-seasons of each season in your range, ranked by 9-category value.',
    Art: PoolArt,
  },
  {
    title: 'Coin flip, then a snake draft',
    text: 'The winner picks first: A B · B A · A B … until both teams are full.',
    Art: SnakeArt,
  },
  {
    title: 'Draft on what you know',
    text: 'By default you see only names, one season per player. Settings can show season & team, the game date, or averages.',
    Art: KnowledgeArt,
  },
  {
    title: 'One secret game each',
    text: 'Every player-season is locked to one random real game from that season, revealed after the draft. Variance is the point.',
    Art: SecretGameArt,
  },
  {
    title: 'Win the categories',
    text: 'PTS, REB, AST, STL, BLK, 3PM, FG%, FT% and TO, as team totals; fewer turnovers wins TO. Most categories wins; total PTS breaks a tie.',
    Art: CategoriesArt,
  },
];

export default function HowItWorks() {
  const [open, setOpen] = useState(() => !hasPlayed());
  return (
    <details className="settings-details how-it-works" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="setting-label">How it works</span>
        {!open && <span className="setting-hint">Pool, coin flip, snake draft, one secret game each, 9 categories</span>}
      </summary>
      <ol className="hiw-steps">
        {STEPS.map(({ title, text, Art }, i) => (
          <li key={title} className="hiw-step">
            <div className="hiw-art">
              <Art />
            </div>
            <div className="hiw-text">
              <h3>
                <span className="hiw-num">{i + 1}</span> {title}
              </h3>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
