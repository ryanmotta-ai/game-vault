import React from 'react';
import { DownloadItem, Game } from '../../core/types';
import { formatBytes } from '../components/StorageIndicator';
import { formatSpeed } from '../components/GameCard';

interface DownloadsViewProps {
  downloads: DownloadItem[];
  games: Game[];
  preparationProgressMap?: Record<string, { step?: string; progressPercentage?: number }>;
  maxConcurrent?: number;
  onSetMaxConcurrent?: (slots: number) => void;
  onPauseDownload?: (downloadId: string) => void;
  onResumeDownload?: (downloadId: string) => void;
  onCancelDownload: (downloadId: string) => void;
  onPrioritizeDownload?: (downloadId: string) => void;
  onClearCompleted?: () => void;
}

function getFriendlyError(err?: string): string {
  if (!err) return 'Unknown transfer error occurred.';
  if (err.includes('INSUFFICIENT_DISK_SPACE')) {
    return 'Insufficient free disk space in cache directory (requires file size + 512 MB safety buffer).';
  }
  if (err.includes('CHECKSUM_MISMATCH')) {
    return 'Integrity check failed: local MD5 did not match remote cloud checksum.';
  }
  if (err.includes('INTERRUPTED_BY_APP_EXIT')) {
    return 'Download was paused / interrupted by application restart.';
  }
  if (err.includes('REMOTE_FILE_UNAVAILABLE') || err.includes('REMOTE_NOT_FOUND')) {
    return 'Remote file was not found or has been removed in cloud storage.';
  }
  if (err.includes('REMOTE_FILE_CHANGED')) {
    return 'Remote file was modified in cloud storage since download began.';
  }
  if (err.includes('RATE_LIMITED')) {
    return 'Cloud storage rate limit exceeded. Automatically retrying with exponential backoff.';
  }
  if (err.includes('NETWORK_ERROR')) {
    return 'Network connection dropped. Automatically retrying...';
  }
  return err;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({
  downloads,
  games,
  preparationProgressMap,
  maxConcurrent = 2,
  onSetMaxConcurrent,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
  onPrioritizeDownload,
  onClearCompleted
}) => {
  const preparingGames = games.filter((g) => g.state === 'PREPARING');
  const activeDownloads = downloads.filter((d) => d.status === 'DOWNLOADING');
  const pausedDownloads = downloads.filter((d) => d.status === 'PAUSED');
  const queuedDownloads = downloads.filter((d) => d.status === 'QUEUED');
  const completedDownloads = downloads.filter((d) => d.status === 'COMPLETED');
  const failedDownloads = downloads.filter((d) => d.status === 'FAILED' || d.status === 'CANCELLED');

  const isEmpty = downloads.length === 0 && preparingGames.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
      {/* View Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
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
            <span>↓</span>
            <span>Downloads & Transfers</span>
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            High-performance resumable transfer engine with dynamic queue scheduling and concurrent slot control
          </p>
        </div>

        {/* Concurrency Slots Segmented Control */}
        {onSetMaxConcurrent && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: 'var(--bg-surface)',
              padding: '5px 12px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Active Slots:</span>
            <div style={{ display: 'flex', gap: '3px' }}>
              {[1, 2, 3, 4].map((slots) => {
                const isCurrent = maxConcurrent === slots;
                return (
                  <button
                    key={slots}
                    onClick={() => onSetMaxConcurrent(slots)}
                    style={{
                      width: '28px',
                      height: '26px',
                      borderRadius: 'var(--radius-full)',
                      border: 'none',
                      background: isCurrent ? 'var(--accent-blue)' : 'transparent',
                      color: isCurrent ? '#ffffff' : 'var(--text-secondary)',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all var(--transition-fast)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: isCurrent ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none'
                    }}
                    title={`Allow up to ${slots} simultaneous active download(s)`}
                  >
                    {slots}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {isEmpty ? (
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
            ⚡
          </p>
          <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '8px', color: 'var(--text-primary)' }}>
            No active downloads
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', margin: '0 auto' }}>
            Your download queue is currently empty. Browse your cloud library to begin transferring games directly to your local cache.
          </p>
        </div>
      ) : (
        <>
          {/* 0. ACTIVE INSTALL PREPARATIONS */}
          {preparingGames.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#f59e0b',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#f59e0b',
                      boxShadow: '0 0 10px rgba(245, 158, 11, 0.8)'
                    }}
                  />
                  Active Install Preparations & Extractions ({preparingGames.length})
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {preparingGames.map((game) => {
                  const prep = preparationProgressMap?.[game.id];
                  const percentage = prep?.progressPercentage ?? 15;
                  const step = prep?.step || 'Extracting archive & verifying playable assets...';

                  return (
                    <div
                      key={game.id}
                      style={{
                        padding: '20px 24px',
                        background: 'linear-gradient(180deg, rgba(245, 158, 11, 0.08) 0%, var(--bg-card) 100%)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3), 0 0 16px rgba(245, 158, 11, 0.1)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div
                            style={{
                              width: '58px',
                              height: '58px',
                              borderRadius: 'var(--radius-sm)',
                              background: '#1c1811',
                              backgroundImage: game?.coverUrl ? `url(${game.coverUrl})` : undefined,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              flexShrink: 0,
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '22px'
                            }}
                          >
                            {!game?.coverUrl && '📦'}
                          </div>
                          <div>
                            <h3 style={{ fontSize: '17px', fontWeight: 800, marginBottom: '4px', letterSpacing: '-0.2px' }}>
                              {game?.title || 'Unknown Game'}
                            </h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                              <span style={{ color: '#f59e0b', fontWeight: 600 }}>{game?.platform || 'PC'}</span>
                              <span>•</span>
                              <span>{formatBytes(game.sizeBytes)}</span>
                              <span>•</span>
                              <span style={{ color: '#fbbf24', fontWeight: 600 }}>Safe Sandbox Extraction</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '20px', fontWeight: 900, color: '#f59e0b', letterSpacing: '-0.5px' }}>
                              {percentage}%
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                              PREPARING
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div>
                        <div
                          style={{
                            width: '100%',
                            height: '8px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            borderRadius: 'var(--radius-full)',
                            overflow: 'hidden'
                          }}
                        >
                          <div
                            className="animate-shimmer"
                            style={{
                              width: `${percentage}%`,
                              height: '100%',
                              background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                              borderRadius: 'var(--radius-full)',
                              transition: 'width 0.3s ease',
                              boxShadow: '0 0 12px rgba(245, 158, 11, 0.5)'
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                          <span>{step}</span>
                          <span>Writing to local cache</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 1. ACTIVE DOWNLOADS */}
          {activeDownloads.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: 'var(--status-downloading)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: 'var(--accent-amber)',
                      boxShadow: '0 0 10px rgba(245, 158, 11, 0.8)'
                    }}
                  />
                  Active Transfers ({activeDownloads.length}/{maxConcurrent})
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {activeDownloads.map((item) => {
                  const game = games.find((g) => g.id === item.gameId);
                  const percentage =
                    item.totalBytes > 0
                      ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
                      : 0;

                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: '20px 24px',
                        background: 'linear-gradient(180deg, rgba(59, 130, 246, 0.08) 0%, var(--bg-card) 100%)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid rgba(59, 130, 246, 0.4)',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3), 0 0 16px rgba(59, 130, 246, 0.1)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <div
                            style={{
                              width: '58px',
                              height: '58px',
                              borderRadius: 'var(--radius-sm)',
                              background: '#151d2c',
                              backgroundImage: game?.coverUrl ? `url(${game.coverUrl})` : undefined,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              flexShrink: 0,
                              border: '1px solid var(--border-color)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '22px'
                            }}
                          >
                            {!game?.coverUrl && '🎮'}
                          </div>
                          <div>
                            <h3 style={{ fontSize: '17px', fontWeight: 800, marginBottom: '4px', letterSpacing: '-0.2px' }}>
                              {game?.title || 'Unknown Game'}
                            </h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                              <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{game?.platform || 'PC'}</span>
                              <span>•</span>
                              <span>{formatBytes(item.totalBytes)}</span>
                              <span>•</span>
                              <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>Range Resumable</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '20px', fontWeight: 900, color: 'var(--status-downloading)', letterSpacing: '-0.5px' }}>
                              {percentage}%
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                              {formatSpeed(item.downloadSpeedBps)}
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            {onPauseDownload && (
                              <button
                                onClick={() => onPauseDownload(item.id)}
                                className="btn btn-secondary"
                                style={{ fontSize: '12px', padding: '7px 14px', borderRadius: 'var(--radius-sm)' }}
                                title="Pause download"
                              >
                                ⏸ Pause
                              </button>
                            )}
                            <button
                              onClick={() => onCancelDownload(item.id)}
                              className="btn btn-secondary"
                              style={{ fontSize: '12px', padding: '7px 14px', borderRadius: 'var(--radius-sm)' }}
                              title="Cancel download"
                            >
                              ✕ Cancel
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div
                        style={{
                          width: '100%',
                          height: '8px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          borderRadius: 'var(--radius-full)',
                          overflow: 'hidden'
                        }}
                      >
                        <div
                          className="animate-shimmer"
                          style={{
                            width: `${percentage}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                            borderRadius: 'var(--radius-full)',
                            transition: 'width 0.25s ease',
                            boxShadow: '0 0 12px rgba(59, 130, 246, 0.5)'
                          }}
                        />
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
                        <span>
                          {formatBytes(item.downloadedBytes)} of {formatBytes(item.totalBytes)} transferred
                        </span>
                        <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
                          HTTP Range Stream Active
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. PAUSED DOWNLOADS */}
          {pausedDownloads.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: 'var(--status-cloud)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px'
                  }}
                >
                  ⏸ Paused ({pausedDownloads.length})
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {pausedDownloads.map((item) => {
                  const game = games.find((g) => g.id === item.gameId);
                  const percentage =
                    item.totalBytes > 0
                      ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100))
                      : 0;

                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: '14px 18px',
                        background: 'var(--bg-card)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        boxShadow: 'var(--shadow-sm)',
                        flexWrap: 'wrap',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: 'var(--radius-sm)',
                            background: '#151d2c',
                            backgroundImage: game?.coverUrl ? `url(${game.coverUrl})` : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            flexShrink: 0,
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          {!game?.coverUrl && '🎮'}
                        </div>
                        <div>
                          <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '2px' }}>
                            {game?.title || 'Unknown Game'}
                          </h4>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {game?.platform || 'PC'} • {formatBytes(item.downloadedBytes)} / {formatBytes(item.totalBytes)} ({percentage}%)
                            {item.errorMessage ? (
                              <span style={{ color: 'var(--accent-amber)', marginLeft: '6px' }}>
                                • {getFriendlyError(item.errorMessage)}
                              </span>
                            ) : (
                              ' • Ready to resume'
                            )}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {onResumeDownload && (
                          <button
                            onClick={() => onResumeDownload(item.id)}
                            className="btn btn-primary"
                            style={{ fontSize: '12px', padding: '6px 14px', borderRadius: 'var(--radius-sm)' }}
                            title="Resume download"
                          >
                            ▶ Resume
                          </button>
                        )}
                        <button
                          onClick={() => onCancelDownload(item.id)}
                          className="btn btn-secondary"
                          style={{ fontSize: '12px', padding: '6px 12px', borderRadius: 'var(--radius-sm)' }}
                          title="Cancel and remove partial file"
                        >
                          ✕ Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. QUEUED DOWNLOADS */}
          {queuedDownloads.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px'
                  }}
                >
                  ⏳ Queued ({queuedDownloads.length})
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {queuedDownloads.map((item, index) => {
                  const game = games.find((g) => g.id === item.gameId);

                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: '14px 18px',
                        background: 'var(--bg-card)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        boxShadow: 'var(--shadow-sm)',
                        flexWrap: 'wrap',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <span
                          style={{
                            fontSize: '13px',
                            fontWeight: 800,
                            color: 'var(--accent-blue)',
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            background: 'rgba(59, 130, 246, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          #{index + 1}
                        </span>
                        <div
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: 'var(--radius-sm)',
                            background: '#151d2c',
                            backgroundImage: game?.coverUrl ? `url(${game.coverUrl})` : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            flexShrink: 0,
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          {!game?.coverUrl && '🎮'}
                        </div>
                        <div>
                          <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '2px' }}>
                            {game?.title || 'Unknown Game'}
                          </h4>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {game?.platform || 'PC'} • {formatBytes(item.totalBytes)} • Waiting for slot
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {onPrioritizeDownload && (
                          <button
                            onClick={() => onPrioritizeDownload(item.id)}
                            className="btn btn-secondary"
                            style={{ fontSize: '12px', padding: '6px 14px', borderRadius: 'var(--radius-sm)' }}
                            title="Elevate to top of queue"
                          >
                            ⬆ Download Next
                          </button>
                        )}
                        <button
                          onClick={() => onCancelDownload(item.id)}
                          className="btn btn-secondary"
                          style={{ fontSize: '12px', padding: '6px 12px', borderRadius: 'var(--radius-sm)' }}
                          title="Remove from queue"
                        >
                          ✕ Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. COMPLETED DOWNLOADS */}
          {completedDownloads.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: 'var(--status-ready)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px'
                  }}
                >
                  ✓ Completed ({completedDownloads.length})
                </span>
                {onClearCompleted && (
                  <button
                    onClick={onClearCompleted}
                    className="btn btn-secondary"
                    style={{ fontSize: '11px', padding: '4px 12px', borderRadius: 'var(--radius-full)' }}
                    title="Clear completed download history without deleting files"
                  >
                    🗑 Clear History
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {completedDownloads.map((item) => {
                  const game = games.find((g) => g.id === item.gameId);

                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: '14px 18px',
                        background: 'var(--bg-card)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        boxShadow: 'var(--shadow-sm)',
                        flexWrap: 'wrap',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: 'var(--radius-sm)',
                            background: '#151d2c',
                            backgroundImage: game?.coverUrl ? `url(${game.coverUrl})` : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            flexShrink: 0,
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          {!game?.coverUrl && '🎮'}
                        </div>
                        <div>
                          <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '2px' }}>
                            {game?.title || 'Unknown Game'}
                          </h4>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {game?.platform || 'PC'} • {formatBytes(item.totalBytes)} • Verified in local cache
                          </span>
                        </div>
                      </div>

                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 800,
                          color: 'var(--status-ready)',
                          background: 'rgba(16, 185, 129, 0.12)',
                          padding: '4px 12px',
                          borderRadius: 'var(--radius-full)',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span>⚡</span>
                        <span>Ready to play</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 5. FAILED / CANCELLED DOWNLOADS */}
          {failedDownloads.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px'
                  }}
                >
                  History & Errors ({failedDownloads.length})
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {failedDownloads.map((item) => {
                  const game = games.find((g) => g.id === item.gameId);
                  const isCancelled = item.status === 'CANCELLED';

                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: '14px 18px',
                        background: 'var(--bg-card)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        boxShadow: 'var(--shadow-sm)',
                        flexWrap: 'wrap',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div
                          style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: 'var(--radius-sm)',
                            background: '#151d2c',
                            backgroundImage: game?.coverUrl ? `url(${game.coverUrl})` : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            flexShrink: 0,
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          {!game?.coverUrl && '🎮'}
                        </div>
                        <div>
                          <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '2px' }}>
                            {game?.title || 'Unknown Game'}
                          </h4>
                          <span style={{ fontSize: '12px', color: isCancelled ? 'var(--text-muted)' : 'var(--accent-red)' }}>
                            {isCancelled ? 'Cancelled by user' : getFriendlyError(item.errorMessage)}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {!isCancelled && onResumeDownload && (
                          <button
                            onClick={() => onResumeDownload(item.id)}
                            className="btn btn-secondary"
                            style={{ fontSize: '12px', padding: '5px 12px', borderRadius: 'var(--radius-sm)' }}
                            title="Retry download"
                          >
                            Retry
                          </button>
                        )}
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: isCancelled ? 'var(--text-muted)' : 'var(--accent-red)',
                            background: isCancelled ? 'rgba(255, 255, 255, 0.05)' : 'rgba(239, 68, 68, 0.12)',
                            padding: '4px 10px',
                            borderRadius: 'var(--radius-full)',
                            border: `1px solid ${isCancelled ? 'rgba(255, 255, 255, 0.1)' : 'rgba(239, 68, 68, 0.3)'}`
                          }}
                        >
                          {isCancelled ? '⊘ Cancelled' : '✕ Failed'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
