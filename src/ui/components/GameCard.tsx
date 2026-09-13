import React, { useState } from 'react';
import { Game } from '../../core/types';
import { StatusBadge } from './StatusBadge';
import { formatBytes } from './StorageIndicator';

export function formatSpeed(bps: number): string {
  if (!bps || bps <= 0) return '0 B/s';
  return `${formatBytes(bps)}/s`;
}

function getPlatformGradient(platform: string): string {
  const p = platform.toLowerCase();
  if (p.includes('playstation')) {
    return 'radial-gradient(circle at center, rgba(37, 99, 235, 0.25) 0%, rgba(15, 23, 42, 0.95) 100%)';
  }
  if (p.includes('nintendo') || p.includes('switch') || p.includes('game boy') || p.includes('gamecube')) {
    return 'radial-gradient(circle at center, rgba(239, 68, 68, 0.22) 0%, rgba(15, 23, 42, 0.95) 100%)';
  }
  if (p.includes('xbox')) {
    return 'radial-gradient(circle at center, rgba(16, 185, 129, 0.22) 0%, rgba(15, 23, 42, 0.95) 100%)';
  }
  if (p.includes('sega')) {
    return 'radial-gradient(circle at center, rgba(139, 92, 246, 0.25) 0%, rgba(15, 23, 42, 0.95) 100%)';
  }
  return 'radial-gradient(circle at center, rgba(59, 130, 246, 0.2) 0%, rgba(15, 23, 42, 0.95) 100%)';
}

function getPlatformIcon(platform: string): string {
  const p = platform.toLowerCase();
  if (p.includes('playstation')) return '🎮';
  if (p.includes('nintendo') || p.includes('gamecube')) return '🕹';
  if (p.includes('pc') || p.includes('windows')) return '💻';
  if (p.includes('handheld') || p.includes('game boy') || p.includes('psp')) return '📱';
  return '👾';
}

interface GameCardProps {
  game: Game;
  onAction: (game: Game) => void;
  downloadProgress?: {
    bytesTransferred: number;
    totalBytes: number;
    speedBps: number;
    percentage: number;
    downloadId?: string;
    status?: string;
    nextRetryInSeconds?: number;
    errorReason?: string;
  };
  onPauseDownload?: (downloadId: string) => void;
  onResumeDownload?: (downloadId: string) => void;
  onCancelDownload?: (downloadId: string) => void;
  preparationProgress?: {
    step?: string;
    progressPercentage?: number;
  };
  isRunning?: boolean;
  onCardClick?: (game: Game) => void;
  onRemoveLocalCopy?: (gameId: string) => void;
  onTogglePinned?: (gameId: string, pinned: boolean) => void;
}

export const GameCard: React.FC<GameCardProps> = ({
  game,
  onAction,
  downloadProgress,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
  preparationProgress,
  isRunning = false,
  onCardClick,
  onRemoveLocalCopy,
  onTogglePinned
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const isReady = game.state === 'READY';
  const isDownloading = game.state === 'DOWNLOADING';
  const isPreparing = game.state === 'PREPARING';
  const isPaused = downloadProgress?.status === 'PAUSED';
  const isRetrying = (downloadProgress?.nextRetryInSeconds ?? 0) > 0;
  const isInstantEligible =
    game.state === 'CLOUD' &&
    game.sizeBytes > 0 &&
    game.sizeBytes <= 128 * 1024 * 1024 &&
    [
      'NES',
      'SNES',
      'Game Boy',
      'Game Boy Color',
      'Game Boy Advance',
      'Nintendo 64',
      'Nintendo DS',
      'Retro'
    ].includes(game.platform);

  const coverImage = game.localCoverPath
    ? `local-artwork://${encodeURIComponent(game.localCoverPath.replace(/\\/g, '/'))}`
    : game.coverUrl;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: isRunning ? '1px solid #10b981' : '1px solid var(--border-color)',
        overflow: 'hidden',
        transition: 'all var(--transition-normal)',
        cursor: onCardClick ? 'pointer' : 'default',
        transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: isRunning
          ? '0 0 20px rgba(16, 185, 129, 0.25)'
          : isHovered
          ? 'var(--shadow-card), 0 0 20px rgba(59, 130, 246, 0.15)'
          : 'var(--shadow-sm)',
        borderColor: isRunning ? '#10b981' : isHovered ? 'rgba(255, 255, 255, 0.18)' : 'var(--border-color)'
      }}
      onClick={() => onCardClick?.(game)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Cover / Image Box */}
      <div
        style={{
          position: 'relative',
          height: '260px',
          width: '100%',
          backgroundColor: '#121722',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '12px'
        }}
      >
        {/* Background Artwork with smooth zoom */}
        {coverImage ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url("${coverImage}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              transform: isHovered ? 'scale(1.05)' : 'scale(1)',
              transition: 'transform var(--transition-smooth)'
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              background: getPlatformGradient(game.platform),
              transform: isHovered ? 'scale(1.03)' : 'scale(1)',
              transition: 'transform var(--transition-smooth)',
              zIndex: 0
            }}
          >
            <span style={{ fontSize: '48px', filter: 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.6))' }}>
              {getPlatformIcon(game.platform)}
            </span>
            <span
              style={{
                fontSize: '11px',
                color: 'rgba(255, 255, 255, 0.65)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '3px 10px',
                borderRadius: 'var(--radius-full)',
                backdropFilter: 'blur(6px)'
              }}
            >
              {game.platform}
            </span>
          </div>
        )}

        {/* Top Badges */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', zIndex: 2 }}>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 800,
              background: 'rgba(10, 13, 20, 0.85)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              padding: '3px 9px',
              borderRadius: 'var(--radius-full)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              letterSpacing: '0.4px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)'
            }}
          >
            {game.platform}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {game.pinned && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  background: 'rgba(234, 179, 8, 0.2)',
                  color: '#facc15',
                  border: '1px solid rgba(234, 179, 8, 0.4)',
                  padding: '2px 7px',
                  borderRadius: 'var(--radius-full)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
                }}
                title="Pinned - Excluded from automatic cache eviction"
              >
                📌 Pinned
              </span>
            )}
            {isInstantEligible && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  background: 'rgba(139, 92, 246, 0.25)',
                  color: '#c084fc',
                  border: '1px solid rgba(139, 92, 246, 0.5)',
                  padding: '2px 7px',
                  borderRadius: 'var(--radius-full)',
                  boxShadow: '0 2px 8px rgba(139, 92, 246, 0.3)'
                }}
                title="Instant Play Available: Starts in seconds directly from cloud"
              >
                ⚡ Instant
              </span>
            )}
            {game.rating !== undefined && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  background: 'rgba(234, 179, 8, 0.2)',
                  color: '#fbbf24',
                  border: '1px solid rgba(234, 179, 8, 0.4)',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-full)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
                }}
                title={`Community Rating: ${game.rating} / 10`}
              >
                ★ {game.rating.toFixed(1)}
              </span>
            )}
            <StatusBadge state={game.state} />
          </div>
        </div>

        {/* Bottom Gradient Shade Overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '90px',
            background: 'linear-gradient(to top, var(--bg-card) 0%, transparent 100%)',
            pointerEvents: 'none',
            zIndex: 1
          }}
        />
      </div>

      {/* Content Info */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, zIndex: 2 }}>
        <div>
          <h3
            style={{
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: '3px',
              letterSpacing: '0.1px'
            }}
            title={game.title}
          >
            {game.title}
          </h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
            <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={game.genres?.join(', ') || game.developer}>
              {game.genres && game.genres.length > 0
                ? game.genres.slice(0, 2).join(' • ')
                : game.developer || game.publisher || 'Vault Original'}
            </span>
            <span style={{ fontWeight: 600 }}>{formatBytes(game.sizeBytes)}</span>
          </div>
        </div>

        {/* Action Button & Transfer / Preparation Progress */}
        <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
          {isReady ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(game);
                }}
                className={isRunning ? 'btn btn-secondary' : 'btn btn-ready'}
                style={{
                  width: '100%',
                  padding: '9px 14px',
                  background: isRunning ? 'rgba(16, 185, 129, 0.2)' : undefined,
                  borderColor: isRunning ? '#10b981' : undefined,
                  color: isRunning ? '#34d399' : undefined,
                  fontWeight: isRunning ? 700 : undefined
                }}
                title={isRunning ? 'Game session is currently running' : 'Launch game (Native Launcher / Emulator)'}
              >
                {isRunning ? '● Playing' : '▶ Play Now'}
              </button>
              {(onRemoveLocalCopy || onTogglePinned) && (
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between' }}>
                  {onTogglePinned && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePinned(game.id, !game.pinned);
                      }}
                      className="btn btn-secondary"
                      style={{
                        flex: 1,
                        fontSize: '11px',
                        padding: '4px 6px',
                        background: game.pinned ? 'rgba(234, 179, 8, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                        borderColor: game.pinned ? 'rgba(234, 179, 8, 0.4)' : 'var(--border-color)',
                        color: game.pinned ? '#facc15' : 'var(--text-secondary)'
                      }}
                      title={game.pinned ? 'Game is pinned (protected from auto-eviction). Click to unpin.' : 'Pin game to prevent auto-eviction'}
                    >
                      📌 {game.pinned ? 'Pinned' : 'Pin'}
                    </button>
                  )}
                  {onRemoveLocalCopy && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Remove local copy of "${game.title}"?\n\nThis frees up local disk space. Your cloud save, record, and metadata are preserved.`)) {
                          onRemoveLocalCopy(game.id);
                        }
                      }}
                      className="btn btn-secondary"
                      style={{
                        flex: 1,
                        fontSize: '11px',
                        padding: '4px 6px',
                        color: 'var(--text-muted)'
                      }}
                      title="Delete local files and free disk space (preserves cloud game record)"
                    >
                      🗑 Evict
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : isPreparing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {/* Preparing Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                <span
                  style={{
                    color: 'var(--status-preparing, #f59e0b)',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  ⚙️ Preparing ({preparationProgress?.progressPercentage ?? 0}%)
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {preparationProgress?.step || 'Extracting...'}
                </span>
              </div>

              {/* Preparing Progress Bar */}
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: 'var(--radius-full)',
                  overflow: 'hidden'
                }}
              >
                <div
                  className="animate-shimmer"
                  style={{
                    width: `${preparationProgress?.progressPercentage ?? 10}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                    borderRadius: 'var(--radius-full)',
                    transition: 'width 0.25s ease',
                    boxShadow: '0 0 10px rgba(245, 158, 11, 0.4)'
                  }}
                />
              </div>

              <span style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
                Validating & preparing local files
              </span>
            </div>
          ) : isDownloading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {/* Progress Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                <span
                  style={{
                    color: isPaused ? 'var(--status-cloud)' : 'var(--status-downloading)',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  {isPaused ? (
                    <>⏸ Paused</>
                  ) : isRetrying ? (
                    <>⚠️ Retry in {downloadProgress?.nextRetryInSeconds}s</>
                  ) : (
                    <>↓ {downloadProgress?.percentage ?? 0}%</>
                  )}
                </span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                  {isPaused ? '' : formatSpeed(downloadProgress?.speedBps ?? 0)}
                </span>
              </div>

              {/* Progress Bar Container */}
              <div
                style={{
                  width: '100%',
                  height: '6px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: 'var(--radius-full)',
                  overflow: 'hidden'
                }}
              >
                <div
                  className={!isPaused && !isRetrying ? 'animate-shimmer' : undefined}
                  style={{
                    width: `${downloadProgress?.percentage ?? 0}%`,
                    height: '100%',
                    background: isPaused
                      ? 'rgba(148, 163, 184, 0.5)'
                      : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                    borderRadius: 'var(--radius-full)',
                    transition: 'width 0.25s ease',
                    boxShadow: !isPaused ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none'
                  }}
                />
              </div>

              {/* Bottom Transfer Info & Contextual Buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {formatBytes(downloadProgress?.bytesTransferred ?? 0)} / {formatBytes(downloadProgress?.totalBytes ?? game.sizeBytes)}
                </span>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {downloadProgress?.downloadId && (
                    <>
                      {isPaused ? (
                        onResumeDownload && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onResumeDownload(downloadProgress.downloadId!);
                            }}
                            className="btn btn-primary"
                            style={{ fontSize: '10px', padding: '3px 8px', height: '24px', borderRadius: '4px' }}
                            title="Resume download"
                          >
                            ▶ Resume
                          </button>
                        )
                      ) : (
                        onPauseDownload && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onPauseDownload(downloadProgress.downloadId!);
                            }}
                            className="btn btn-secondary"
                            style={{ fontSize: '10px', padding: '3px 8px', height: '24px', borderRadius: '4px' }}
                            title="Pause download"
                          >
                            ⏸ Pause
                          </button>
                        )
                      )}
                      {onCancelDownload && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onCancelDownload(downloadProgress.downloadId!);
                          }}
                          className="btn btn-secondary"
                          style={{ fontSize: '10px', padding: '3px 8px', height: '24px', borderRadius: '4px' }}
                          title="Cancel download"
                        >
                          ✕
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : game.state === 'QUEUED' ? (
            <button
              disabled
              className="btn btn-secondary"
              style={{ width: '100%', padding: '9px 14px', opacity: 0.8 }}
            >
              ⏳ Queued
            </button>
          ) : isInstantEligible ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction(game);
              }}
              className="btn btn-ready"
              style={{
                width: '100%',
                padding: '9px 14px',
                background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)',
                borderColor: '#8b5cf6',
                color: '#ffffff',
                fontWeight: 700,
                boxShadow: '0 0 14px rgba(124, 58, 237, 0.35)'
              }}
              title="Instant Play: hydrates small retro ROM and launches immediately"
            >
              ⚡ Instant Play
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAction(game);
              }}
              className="btn btn-primary"
              style={{ width: '100%', padding: '9px 14px' }}
            >
              ☁ Download
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
