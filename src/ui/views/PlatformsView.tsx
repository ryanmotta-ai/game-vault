import React from 'react';
import { Game, GamePlatform } from '../../core/types';
import { GameCard } from '../components/GameCard';

interface PlatformsViewProps {
  games: Game[];
  onGameAction: (game: Game) => void;
}

export const PlatformsView: React.FC<PlatformsViewProps> = ({ games, onGameAction }) => {
  // Group games by platform
  const platformsMap = games.reduce((acc, game) => {
    const plat = game.platform;
    if (!acc[plat]) acc[plat] = [];
    acc[plat].push(game);
    return acc;
  }, {} as Record<GamePlatform, Game[]>);

  const platforms = Object.keys(platformsMap) as GamePlatform[];

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800 }}>🕹 Platforms & Systems</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Browse games grouped by PC platforms and emulated consoles.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {platforms.map((plat) => {
          const list = platformsMap[plat] || [];
          return (
            <div key={plat}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '14px',
                  borderBottom: '1px solid var(--border-color)',
                  paddingBottom: '8px'
                }}
              >
                <h3 style={{ fontSize: '18px', fontWeight: 700 }}>{plat}</h3>
                <span
                  style={{
                    fontSize: '11px',
                    background: 'var(--bg-surface)',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    color: 'var(--text-muted)'
                  }}
                >
                  {list.length} {list.length === 1 ? 'game' : 'games'}
                </span>
              </div>

              <div className="games-grid">
                {list.map((game) => (
                  <GameCard key={game.id} game={game} onAction={onGameAction} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
