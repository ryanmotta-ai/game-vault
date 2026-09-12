import React, { useEffect, useState } from 'react';

export const SettingsView: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<{
    appName: string;
    version: string;
    phase: string;
    platform: string;
    arch: string;
    nodeVersion: string;
    electronVersion: string;
  } | null>(null);

  useEffect(() => {
    if (window.gameVault) {
      window.gameVault.getSystemInfo().then(setSystemInfo).catch(console.error);
    }
  }, []);

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800 }}>⚙ System & Application Settings</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Configure Game Vault engine preferences, cache paths, and runtime parameters.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
        {/* Foundation Status Card */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            padding: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <span style={{ fontSize: '20px' }}>🛡</span>
            <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Architecture & Security Status</h3>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
            Game Vault operates under zero-trust Electron architecture with IPC isolation, native SQLite database, and abstract storage providers.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
              fontSize: '12px'
            }}
          >
            <div style={{ padding: '10px', background: 'var(--bg-surface)', borderRadius: '6px' }}>
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Context Isolation</span>
              <strong style={{ color: 'var(--accent-green)' }}>Enabled (Secure)</strong>
            </div>
            <div style={{ padding: '10px', background: 'var(--bg-surface)', borderRadius: '6px' }}>
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Node Integration</span>
              <strong style={{ color: 'var(--accent-green)' }}>Disabled (Sandboxed)</strong>
            </div>
            <div style={{ padding: '10px', background: 'var(--bg-surface)', borderRadius: '6px' }}>
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>rclone Dependency</span>
              <strong style={{ color: 'var(--accent-green)' }}>None (Pure Node/API)</strong>
            </div>
            <div style={{ padding: '10px', background: 'var(--bg-surface)', borderRadius: '6px' }}>
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Database Engine</span>
              <strong style={{ color: 'var(--accent-blue)' }}>SQLite (WAL Mode)</strong>
            </div>
          </div>
        </div>

        {/* Runtime Diagnostics Card */}
        {systemInfo && (
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              padding: '20px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span style={{ fontSize: '20px' }}>💻</span>
              <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Diagnostics & Environment</h3>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                fontSize: '12px'
              }}
            >
              <div style={{ padding: '10px', background: 'var(--bg-surface)', borderRadius: '6px' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>App Name & Version</span>
                <strong>{systemInfo.appName} v{systemInfo.version}</strong>
              </div>
              <div style={{ padding: '10px', background: 'var(--bg-surface)', borderRadius: '6px' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Platform / Arch</span>
                <strong>{systemInfo.platform} ({systemInfo.arch})</strong>
              </div>
              <div style={{ padding: '10px', background: 'var(--bg-surface)', borderRadius: '6px' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Electron Runtime</span>
                <strong>v{systemInfo.electronVersion}</strong>
              </div>
              <div style={{ padding: '10px', background: 'var(--bg-surface)', borderRadius: '6px' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Node Runtime</span>
                <strong>{systemInfo.nodeVersion}</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
