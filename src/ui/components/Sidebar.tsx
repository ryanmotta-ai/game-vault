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
        width: '250px',
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '24px 16px',
        flexShrink: 0,
        zIndex: 11
      }}
    >
      <div>
        {/* App Branding */}
        <div style={{ padding: '0 10px 26px 10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              boxShadow: '0 0 20px rgba(59, 130, 246, 0.45)',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}
          >
            🕹
          </div>
          <div>
            <h1
              style={{
                fontSize: '17px',
                fontWeight: 900,
                letterSpacing: '1.2px',
                background: 'linear-gradient(135deg, #ffffff, #94a3b8)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}
            >
              GAME VAULT
            </h1>
            <span
              style={{
                fontSize: '10px',
                color: 'var(--accent-blue)',
                fontWeight: 700,
                letterSpacing: '0.8px',
                textTransform: 'uppercase'
              }}
            >
              Console Edition
            </span>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            const isDownloadsWithCount = item.id === 'downloads' && (item.count ?? 0) > 0;

            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '11px 16px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: isActive
                    ? 'linear-gradient(90deg, rgba(59, 130, 246, 0.18) 0%, rgba(59, 130, 246, 0.04) 100%)'
                    : 'transparent',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                  borderLeft: isActive ? '3px solid var(--accent-blue)' : '3px solid transparent',
                  boxShadow: isActive ? 'inset 1px 0 8px rgba(59, 130, 246, 0.15)' : 'none'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                    e.currentTarget.style.color = '#ffffff';
                    e.currentTarget.style.transform = 'translateX(2px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                    e.currentTarget.style.transform = 'translateX(0)';
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '16px' }}>{item.icon}</span>
                  <span style={{ letterSpacing: '0.2px' }}>{item.label}</span>
                </div>

                {item.count !== undefined && item.count > 0 && (
                  <span
                    style={{
                      fontSize: '11px',
                      background: isDownloadsWithCount
                        ? 'var(--accent-amber)'
                        : isActive
                        ? 'var(--accent-blue)'
                        : 'var(--bg-surface-elevated)',
                      color: isDownloadsWithCount ? '#000000' : '#ffffff',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      fontWeight: 800,
                      boxShadow: isDownloadsWithCount
                        ? '0 0 10px rgba(245, 158, 11, 0.5)'
                        : 'none',
                      transition: 'all var(--transition-fast)'
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

      {/* Footer Info Box */}
      <div
        style={{
          padding: '14px',
          background: 'rgba(10, 13, 20, 0.6)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-color)',
          fontSize: '11px',
          color: 'var(--text-muted)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Active Provider:</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Google Drive</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Transfer Engine:</span>
          <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>Resumable (v2)</span>
        </div>
        <div
          style={{
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            paddingTop: '6px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '10px'
          }}
        >
          <span>Version:</span>
          <span style={{ color: 'var(--text-secondary)' }}>0.3.2-phase3b</span>
        </div>
      </div>
    </aside>
  );
};
