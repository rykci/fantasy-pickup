import { useEffect, useRef, useState } from 'react';
import type { Team } from '../api';
import { sound } from '../lib/sound';

// Plays back the coin flip the server made when the game was created.
// The sound follows the animation itself: a "ting" each time the coin turns edge-on
// (read from its actual rotation every frame), and the landing on animationend.

const FLIP_MS = 2000; // matches the CSS animation

export default function CoinFlip({
  winner,
  labels,
  onDone,
  startAt,
  closeAt,
  you,
}: {
  winner: Team;
  labels: Record<Team, string>;
  onDone: () => void;
  /** Online: when to start (Date.now() terms), so both screens flip together. Default: now. */
  startAt?: number;
  /** Online: close automatically when the first turn opens. */
  closeAt?: number;
  /** Online: your team, for "You pick first!". */
  you?: Team | null;
}) {
  // A positive delay waits; a negative one joins the flip partway through.
  const [delay] = useState(() => (startAt === undefined ? 0 : startAt - Date.now()));
  const [landed, setLanded] = useState(() => delay < -FLIP_MS);
  const coin = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (closeAt === undefined) return;
    const id = window.setTimeout(() => done.current(), Math.max(0, closeAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [closeAt]);

  useEffect(() => {
    let frame = 0;
    let lastSign = 1;
    const watch = () => {
      const el = coin.current;
      if (el) {
        // rotateX(θ): the matrix's m22 is cos θ. It changes sign whenever the coin is edge-on.
        const t = getComputedStyle(el).transform;
        const cos = t && t !== 'none' ? new DOMMatrixReadOnly(t).m22 : 1;
        const sign = cos < 0 ? -1 : 1;
        if (sign !== lastSign) sound.coinTick();
        lastSign = sign;
      }
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(frame);
  }, []);

  function onLand(e: React.AnimationEvent) {
    if (landed || !e.animationName.startsWith('coin-spin')) return;
    setLanded(true);
    sound.coinLand();
  }

  const label = labels[winner];
  const result = label === 'You' || you === winner ? 'You pick first!' : `${label} picks first`;
  const timing = { animationDelay: `${delay}ms` };

  return (
    <div className="coin-overlay" role="dialog" aria-modal="true" aria-label="Coin flip for the first pick">
      <div className="coin-card">
        <p className="coin-kicker">Coin flip for the first pick</p>
        <div className="coin-stage">
          <div className="coin-toss" style={timing}>
            <div ref={coin} className={`coin land-${winner}`} style={timing} onAnimationEnd={onLand}>
              <div className="coin-face face-A">{labels.A}</div>
              <div className="coin-face face-B">{labels.B}</div>
            </div>
          </div>
        </div>
        <p className={`coin-result ${landed ? `shown team-${winner}-text` : ''}`} aria-live="polite">
          {landed ? result : ' '}
        </p>
        {closeAt === undefined ? (
          <button className="btn btn-primary btn-lg" onClick={onDone} disabled={!landed}>
            Start the draft
          </button>
        ) : (
          <p className="muted small">{landed ? 'The draft opens in a moment…' : '\u00a0'}</p>
        )}
      </div>
    </div>
  );
}
