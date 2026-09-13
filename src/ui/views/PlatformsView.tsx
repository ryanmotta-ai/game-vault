import React from 'react';
import { Game, GamePlatform } from '../../core/types';
import { GameCard } from '../components/GameCard';

interface PlatformsViewProps {
  games: Game[];
  onGameAction: (game: Game) => void;
}

function getPlatformIcon(platform: string): string {
  const p = platform.toLowerCase();
  if (p.includes('playstation')) return '🎮';
  if (p.includes('nintendo') || p.includes('gamecube')) return '🕹';
  if (p.includes('pc') || p.includes('windows')) return '💻';
  if (p.includes('handheld') || p.includes('game boy') || p.includes('psp')) return '📱';
  return '👾';
}

export const PlatformsView: React.FC<PlatformsViewProps> = ({ games, onGameAction }) => {
  // Group games by platform
  const platformsMap = games.reduce((acc, game) => {
    const plat = game.platform;
    if (!acc[plat]) acc[plat] = [];
    acc[plat].push(game);
    return acc;
  }, {} as Record<GamePlatform, Game[]>);

  const platforms = (Object.keys(platformsMap) as GamePlatform[]).sort((a, b) =>
    a.localeCompare(b)
  );

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2
          style={{
            fontSize: '26px',
            fontWeight: 900,
            letterSpacing: '-0.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          <span>🕹</span>
          <span>Platforms & Systems</span>
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Explore your unified game vault organized across emulated consoles and native PC platforms
        </p>

        {/* Quick Jump Bar */}
        {platforms.length > 1 && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            {platforms.map((plat) => (
              <a
                key={plat}
                href={`#platform-${plat}`}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all var(--transition-fast)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent-blue)';
                  e.currentTarget.style.color = '#ffffff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                <span>{getPlatformIcon(plat)}</span>
                <span>{plat}</span>
                <span
                  style={{
                    fontSize: '10px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    padding: '1px 5px',
                    borderRadius: 'var(--radius-full)'
                  }}
                >
                  {platformsMap[plat]?.length || 0}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      {platforms.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '36px' }}>
          {platforms.map((plat) => {
            const list = platformsMap[plat] || [];
            return (
              <div key={plat} id={`platform-${plat}`} style={{ scrollMarginTop: '20px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '16px',
                    borderBottom: '1px solid var(--border-color)',
                    paddingBottom: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>{getPlatformIcon(plat)}</span>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.2px' }}>{plat}</h3>
                    <span
                      style={{
                        fontSize: '11px',
                        background: 'var(--bg-surface)',
                        padding: '3px 10px',
                        borderRadius: 'var(--radius-full)',
                        color: 'var(--accent-blue)',
                        fontWeight: 700,
                        border: '1px solid var(--border-color)'
                      }}
                    >
                      {list.length} {list.length === 1 ? 'game' : 'games'}
                    </span>
                  </div>
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
      ) : (
        <div
          style={{
            padding: '80px 20px',
            textAlign: 'center',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <p style={{ fontSize: '42px', marginBottom: '14px', filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.4))' }}>
            🕹
          </p>
          <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '8px', color: 'var(--text-primary)' }}>
            No platforms detected
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', margin: '0 auto' }}>
            Connect a cloud storage account and run a library scan to discover games organized by console and PC platforms.
          </p>
        </div>
      )}
    </div>
  );
};
