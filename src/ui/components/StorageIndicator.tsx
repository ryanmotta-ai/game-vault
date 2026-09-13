import React from 'react';

interface StorageIndicatorProps {
  usedBytes: number;
  totalBytes: number;
  label?: string;
  onClick?: () => void;
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
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

  const barColor =
    percentage > 90
      ? 'linear-gradient(90deg, #f87171, #ef4444)'
      : percentage > 75
      ? 'linear-gradient(90deg, #fbbf24, #f59e0b)'
      : 'linear-gradient(90deg, #60a5fa, #3b82f6)';

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '7px 14px',
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        cursor: onClick ? 'pointer' : 'default',
        minWidth: '200px',
        transition: 'all var(--transition-fast)',
        boxShadow: 'var(--shadow-sm)'
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
          e.currentTarget.style.background = 'var(--bg-surface-elevated)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }
      }}
      onMouseLeave={(e) => {
        if (onClick) {
          e.currentTarget.style.borderColor = 'var(--border-color)';
          e.currentTarget.style.background = 'var(--bg-surface)';
          e.currentTarget.style.transform = 'translateY(0)';
        }
      }}
      title={onClick ? 'Click to manage storage accounts and cache' : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-secondary)' }}>
          <span>☁</span>
          <span style={{ fontWeight: 600 }}>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(255, 255, 255, 0.08)',
              color: percentage > 90 ? 'var(--accent-red)' : 'var(--text-secondary)',
              fontWeight: 700
            }}
          >
            {percentage}%
          </span>
        </div>
      </div>
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
          style={{
            width: `${percentage}%`,
            height: '100%',
            background: barColor,
            borderRadius: 'var(--radius-full)',
            transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: percentage > 90 ? '0 0 8px rgba(239, 68, 68, 0.6)' : '0 0 8px rgba(59, 130, 246, 0.4)'
          }}
        />
      </div>
    </div>
  );
};
