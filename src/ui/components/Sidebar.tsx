import React from 'react';

export type ActiveTab = 'library' | 'installed' | 'downloads' | 'platforms' | 'storage' | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  counts: {
    library: number;
    installed: number;
    downloads: number;
  };
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab, counts }) => {
  const menuItems: Array<{ id: ActiveTab; label: string; icon: string; count?: number }> = [
    { id: 'library', label: 'Library', icon: '🎮', count: counts.library },
    { id: 'installed', label: 'Installed', icon: '⚡', count: counts.installed },
    { id: 'downloads', label: 'Downloads', icon: '↓', count: counts.downloads },
    { id: 'platforms', label: 'Platforms', icon: '🕹' },
    { id: 'storage', label: 'Storage', icon: '🗄' },
    { id: 'settings', label: 'Settings', icon: '⚙' }
  ];

  return (
    <aside
      style={{
        width: '240px',
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '24px 16px',
        flexShrink: 0
      }}
    >
      <div>
        {/* App Branding */}
        <div style={{ padding: '0 12px 24px 12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              boxShadow: '0 0 16px rgba(59, 130, 246, 0.4)'
            }}
          >
            🕹
          </div>
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '1px' }}>GAME VAULT</h1>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>v0.1.0 • FOUNDATION</span>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: isActive ? 'var(--bg-surface)' : 'transparent',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  borderLeft: isActive ? '3px solid var(--accent-blue)' : '3px solid transparent'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    e.currentTarget.style.color = '#ffffff';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '15px' }}>{item.icon}</span>
                  <span>{item.label}</span>
                </div>

                {item.count !== undefined && item.count > 0 && (
                  <span
                    style={{
                      fontSize: '11px',
                      background: isActive ? 'var(--accent-blue)' : 'var(--border-color)',
                      color: '#ffffff',
                      padding: '2px 7px',
                      borderRadius: '10px',
                      fontWeight: 600
                    }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div
        style={{
          padding: '12px',
          background: 'rgba(0, 0, 0, 0.2)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-color)',
          fontSize: '11px',
          color: 'var(--text-muted)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span>Storage Provider:</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Google Drive</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Security IPC:</span>
          <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>Isolated</span>
        </div>
      </div>
    </aside>
  );
};
