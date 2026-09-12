import React from 'react';

interface StorageIndicatorProps {
  usedBytes: number;
  totalBytes: number;
  label?: string;
  onClick?: () => void;
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export const StorageIndicator: React.FC<StorageIndicatorProps> = ({
  usedBytes,
  totalBytes,
  label = 'Cloud Storage',
  onClick
}) => {
  const percentage = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '6px 12px',
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        cursor: onClick ? 'pointer' : 'default',
        minWidth: '180px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
        </span>
      </div>
      <div
        style={{
          width: '100%',
          height: '5px',
          background: 'var(--border-color)',
          borderRadius: '3px',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: `${percentage}%`,
            height: '100%',
            background: percentage > 90 ? 'var(--accent-red)' : 'var(--accent-blue)',
            borderRadius: '3px',
            transition: 'width 0.3s ease'
          }}
        />
      </div>
    </div>
  );
};
