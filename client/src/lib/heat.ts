// Box-score colors: how a chosen game compares with that player's season.
// Used by the results page and the downloadable image, so they always agree.

export type Heat = 'hot' | 'cold' | '';

/** Green ("hot") = well above the season average, red ("cold") = well below. Reversed for TO. */
export function heat(v: number, avg: number, lowerIsBetter = false): Heat {
  const hot = v >= avg * 1.25 + 0.5;
  const cold = v <= avg * 0.6 - 0.5;
  if (lowerIsBetter) return cold ? 'hot' : hot ? 'cold' : '';
  return hot ? 'hot' : cold ? 'cold' : '';
}

/** Shooting: only nights with real volume (5+ attempts) get a color. */
export function shotHeat(made: number, att: number, avgPct: number | null): Heat {
  const p = att > 0 ? made / att : null;
  if (p === null || avgPct === null || att < 5) return '';
  return p >= avgPct + 0.12 ? 'hot' : p <= avgPct - 0.15 ? 'cold' : '';
}
