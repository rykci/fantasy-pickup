import { useCallback, useEffect, useState } from 'react';
import Draft from './screens/Draft';
import Home from './screens/Home';
import Results from './screens/Results';

type Screen =
  | { name: 'home'; invite?: string }
  | { name: 'draft'; gameId: number }
  | { name: 'results'; gameId: number };

/** Screen is mirrored in the URL (?game=12 / ?game=12&view=results) so a refresh keeps your game. */
function readUrl(): Screen {
  const params = new URLSearchParams(window.location.search);
  const invite = params.get('join');
  if (invite) return { name: 'home', invite: invite.toUpperCase() };
  const id = Number(params.get('game'));
  if (!Number.isInteger(id) || id <= 0) return { name: 'home' };
  return params.get('view') === 'results' ? { name: 'results', gameId: id } : { name: 'draft', gameId: id };
}

function writeUrl(screen: Screen) {
  const params = new URLSearchParams();
  if (screen.name !== 'home') params.set('game', String(screen.gameId));
  if (screen.name === 'results') params.set('view', 'results');
  const qs = params.toString();
  window.history.pushState(null, '', qs ? `?${qs}` : window.location.pathname);
}

export default function App() {
  const [screen, setScreen] = useState<Screen>(readUrl);

  useEffect(() => {
    const onPop = () => setScreen(readUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((next: Screen) => {
    writeUrl(next);
    setScreen(next);
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => go({ name: 'home' })}>
          <span aria-hidden>🏀</span> Fantasy Pickup
        </button>
      </header>
      <main>
        {screen.name === 'home' && (
          <Home key={screen.invite ?? 'home'} invite={screen.invite} onStart={(gameId) => go({ name: 'draft', gameId })} />
        )}
        {screen.name === 'draft' && (
          <Draft
            key={screen.gameId}
            gameId={screen.gameId}
            onComplete={() => go({ name: 'results', gameId: screen.gameId })}
            onHome={() => go({ name: 'home' })}
          />
        )}
        {screen.name === 'results' && (
          <Results
            key={screen.gameId}
            gameId={screen.gameId}
            onPlayAgain={() => go({ name: 'home' })}
            onRematch={(gameId) => go({ name: 'draft', gameId })}
          />
        )}
      </main>
    </div>
  );
}
