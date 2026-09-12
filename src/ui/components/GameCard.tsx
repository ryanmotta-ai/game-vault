import React from 'react';
import { Game } from '../../core/types';
import { StatusBadge } from './StatusBadge';
import { formatBytes } from './StorageIndicator';

interface GameCardProps {
  game: Game;
  onAction: (game: Game) => void;
}

export const GameCard: React.FC<GameCardProps> = ({ game, onAction }) => {
  const isReady = game.state === 'READY';
  const isDownloading = game.state === 'DOWNLOADING';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
        cursor: 'pointer'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 12px 24px rgba(0, 0, 0, 0.4)';
        e.currentTarget.style.borderColor = 'var(--accent-blue)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = 'var(--border-color)';
      }}
    >
      {/* Cover / Image Box */}
      <div
        style={{
          position: 'relative',
          height: '260px',
          width: '100%',
          backgroundColor: '#182030',
          backgroundImage: game.coverUrl ? `url(${game.coverUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '12px'
        }}
      >
        {/* Top Badges */}
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              background: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(4px)',
              padding: '3px 8px',
              borderRadius: '4px',
              color: '#ffffff'
            }}
          >
            {game.platform}
          </span>
          <StatusBadge state={game.state} />
        </div>

        {/* Fallback Artwork Display when no coverUrl is available */}
        {!game.coverUrl && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              background: 'radial-gradient(circle at center, rgba(59, 130, 246, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)',
              zIndex: 0
            }}
          >
            <span style={{ fontSize: '42px', opacity: 0.5 }}>🎮</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Vault Catalog
            </span>
          </div>
        )}

        {/* Bottom Shade Overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '80px',
            background: 'linear-gradient(to top, var(--bg-card), transparent)',
            pointerEvents: 'none'
          }}
        />
      </div>

      {/* Content Info */}
      <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        <div>
          <h3
            style={{
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: '2px'
            }}
            title={game.title}
          >
            {game.title}
          </h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
            <span>{game.developer || game.publisher || 'Unknown'}</span>
            <span>{formatBytes(game.sizeBytes)}</span>
          </div>
        </div>

        {/* Action Button */}
        <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
          {isReady ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction(game);
              }}
              className="btn btn-ready"
              style={{ width: '100%' }}
            >
              ▶ Play
            </button>
          ) : isDownloading ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction(game);
              }}
              className="btn btn-secondary"
              style={{ width: '100%', color: 'var(--status-downloading)' }}
            >
              ↓ Downloading...
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction(game);
              }}
              className="btn btn-primary"
              style={{ width: '100%' }}
            >
              ☁ Download
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
