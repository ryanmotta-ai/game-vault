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
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-color)',
        height: '70px',
        zIndex: 10,
        flexShrink: 0
      }}
    >
      {/* Search Bar */}
      <div style={{ position: 'relative', width: '400px' }}>
        <input
          type="text"
          placeholder="Search games, platforms, developers..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 38px 10px 38px',
            fontSize: '13px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-full)',
            color: 'var(--text-primary)',
            outline: 'none',
            transition: 'all var(--transition-fast)',
            boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.3)'
          }}
          onFocus={(e) => {
            e.target.style.borderColor = 'var(--border-focus)';
            e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.25)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'var(--border-color)';
            e.target.style.boxShadow = 'inset 0 1px 3px rgba(0, 0, 0, 0.3)';
          }}
        />
        <span
          style={{
            position: 'absolute',
            left: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            fontSize: '14px',
            pointerEvents: 'none'
          }}
        >
          🔍
        </span>
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '4px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color var(--transition-fast)'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            title="Clear search"
          >
            ✕
          </button>
        )}
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
          onClick={onNavigateToStorage}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '4px 12px 4px 5px',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            boxShadow: 'var(--shadow-sm)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            e.currentTarget.style.background = 'var(--bg-surface-elevated)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-color)';
            e.currentTarget.style.background = 'var(--bg-surface)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
          title="Account & Storage"
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
              fontWeight: 800,
              fontSize: '12px',
              color: '#ffffff',
              boxShadow: '0 0 10px rgba(59, 130, 246, 0.4)'
            }}
          >
            GV
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.2px' }}>
              Vault Player
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--accent-green)',
                  boxShadow: '0 0 6px rgba(16, 185, 129, 0.8)'
                }}
              />
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--accent-green)' }}>Online</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
