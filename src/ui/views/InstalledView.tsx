import React from 'react';
import { Game } from '../../core/types';
import { GameCard } from '../components/GameCard';
import { formatBytes } from '../components/StorageIndicator';

interface InstalledViewProps {
  games: Game[];
  searchQuery: string;
  onGameAction: (game: Game) => void;
  runningGames?: Set<string>;
  onCardClick?: (game: Game) => void;
  onNavigateToLibrary?: () => void;
  onRemoveLocalCopy?: (gameId: string) => void;
  onTogglePinned?: (gameId: string, pinned: boolean) => void;
}

export const InstalledView: React.FC<InstalledViewProps> = ({
  games,
  searchQuery,
  onGameAction,
  runningGames,
  onCardClick,
  onNavigateToLibrary,
  onRemoveLocalCopy,
  onTogglePinned
}) => {
  const installedGames = games.filter(
    (g) =>
      g.state === 'READY' &&
      (g.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.platform.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalInstalledBytes = installedGames.reduce((acc, g) => acc + (g.sizeBytes || 0), 0);

  return (
    <div>
      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '22px',
          flexWrap: 'wrap',
          gap: '14px'
        }}
      >
        <div>
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
            <span>⚡</span>
            <span>Installed & Ready to Play</span>
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {installedGames.length} titles cached and cryptographically verified on your local drive
          </p>
        </div>

        {/* Local Disk Usage Widget */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '7px 16px',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Local Cache Usage:</span>
          <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--accent-green)' }}>
            {formatBytes(totalInstalledBytes)}
          </span>
        </div>
      </div>

      {/* Grid */}
      {installedGames.length > 0 ? (
        <div className="games-grid">
          {installedGames.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              onAction={onGameAction}
              isRunning={runningGames?.has(game.id)}
              onCardClick={onCardClick}
              onRemoveLocalCopy={onRemoveLocalCopy}
              onTogglePinned={onTogglePinned}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: '80px 20px',
            textAlign: 'center',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            marginTop: '20px',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <p style={{ fontSize: '42px', marginBottom: '14px', filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.4))' }}>
            📦
          </p>
          <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '8px', color: 'var(--text-primary)' }}>
            No games installed yet
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', margin: '0 auto 18px auto' }}>
            Your local cache has no installed titles. Go to the Library tab and click "Download" on any cloud game to start transferring it for offline play.
          </p>
          {onNavigateToLibrary && (
            <button onClick={onNavigateToLibrary} className="btn btn-primary" style={{ padding: '8px 20px' }}>
              🎮 Browse Cloud Library
            </button>
          )}
        </div>
      )}
    </div>
  );
};
