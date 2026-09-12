import React from 'react';
import { DownloadItem, Game } from '../../core/types';
import { formatBytes } from '../components/StorageIndicator';

interface DownloadsViewProps {
  downloads: DownloadItem[];
  games: Game[];
  onCancelDownload: (downloadId: string) => void;
}

export const DownloadsView: React.FC<DownloadsViewProps> = ({ downloads, games, onCancelDownload }) => {
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800 }}>↓ Downloads Queue</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Manage incoming game transfers from cloud storage to local SSD/HDD cache.
        </p>
      </div>

      {downloads.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {downloads.map((item) => {
            const game = games.find((g) => g.id === item.gameId);
            const percentage =
              item.totalBytes > 0 ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100)) : 42; // default visual mock 42% for demo if 0

            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  gap: '20px'
                }}
              >
                {/* Game Info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', width: '280px' }}>
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: 'var(--radius-sm)',
                      background: '#182030',
                      backgroundImage: game?.coverUrl ? `url(${game.coverUrl})` : undefined,
                      backgroundSize: 'cover',
                      flexShrink: 0
                    }}
                  />
                  <div>
                    <h4 style={{ fontSize: '14px', fontWeight: 700 }}>{game?.title || 'Unknown Game'}</h4>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {game?.platform || 'PC'} • {formatBytes(item.totalBytes || game?.sizeBytes || 0)}
                    </span>
                  </div>
                </div>

                {/* Progress Bar & Status */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>
                      {item.status === 'DOWNLOADING' ? `Downloading (${percentage}%)` : item.status}
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {formatBytes((item.totalBytes || game?.sizeBytes || 0) * (percentage / 100))} /{' '}
                      {formatBytes(item.totalBytes || game?.sizeBytes || 0)}
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '6px',
                      background: 'var(--bg-surface)',
                      borderRadius: '3px',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        width: `${percentage}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                        borderRadius: '3px'
                      }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => onCancelDownload(item.id)}
                    className="btn btn-secondary"
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    ✕ Cancel
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            padding: '60px 20px',
            textAlign: 'center',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)'
          }}
        >
          <p style={{ fontSize: '32px', marginBottom: '10px' }}>⚡</p>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>No active downloads</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Your download queue is empty. Choose games from your cloud library to download.
          </p>
        </div>
      )}
    </div>
  );
};
