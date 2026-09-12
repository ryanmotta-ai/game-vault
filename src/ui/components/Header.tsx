import React from 'react';
import { StorageIndicator } from './StorageIndicator';
import { StorageQuotaSummary } from '../../core/types';

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  quotaSummary: StorageQuotaSummary | null;
  onNavigateToStorage: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  searchQuery,
  onSearchChange,
  quotaSummary,
  onNavigateToStorage
}) => {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 36px',
        background: 'var(--bg-header)',
        borderBottom: '1px solid var(--border-color)',
        height: '68px'
      }}
    >
      {/* Search Bar */}
      <div style={{ position: 'relative', width: '380px' }}>
        <input
          type="text"
          placeholder="Search games, platforms, developers..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{
            width: '100%',
            padding: '9px 14px 9px 36px',
            fontSize: '13px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            outline: 'none',
            transition: 'border-color 0.2s'
          }}
          onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)')}
          onBlur={(e) => (e.target.style.borderColor = 'var(--border-color)')}
        />
        <span
          style={{
            position: 'absolute',
            left: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            fontSize: '14px'
          }}
        >
          🔍
        </span>
      </div>

      {/* Right Controls: Storage Indicator + Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        {quotaSummary && (
          <StorageIndicator
            usedBytes={quotaSummary.cloudUsedBytes}
            totalBytes={quotaSummary.cloudTotalBytes}
            label="Google Drive"
            onClick={onNavigateToStorage}
          />
        )}

        {/* Profile Avatar / Status */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '4px 10px 4px 4px',
            background: 'var(--bg-surface)',
            borderRadius: '24px',
            border: '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '13px',
              color: '#ffffff'
            }}
          >
            GV
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Vault User</span>
            <span style={{ fontSize: '10px', color: 'var(--accent-green)' }}>● Online</span>
          </div>
        </div>
      </div>
    </header>
  );
};
