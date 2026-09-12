import React, { useState } from 'react';
import { StorageAccount, StorageQuotaSummary, StorageProviderType } from '../../core/types';
import { formatBytes } from '../components/StorageIndicator';

interface StorageScreenProps {
  accounts: StorageAccount[];
  quotaSummary: StorageQuotaSummary | null;
  onClearCache: () => Promise<void>;
  onConnectAccount: (type: StorageProviderType, name?: string) => Promise<void>;
  onDisconnectAccount: (accountId: string) => Promise<void>;
  onReconnectAccount: (accountId: string) => Promise<void>;
}

export const StorageScreen: React.FC<StorageScreenProps> = ({
  accounts,
  quotaSummary,
  onClearCache,
  onConnectAccount,
  onDisconnectAccount,
  onReconnectAccount
}) => {
  const [clearing, setClearing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accountActionLoading, setAccountActionLoading] = useState<string | null>(null);

  const [newAccountName, setNewAccountName] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<StorageProviderType>('google_drive');

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClearCache();
    } finally {
      setClearing(false);
    }
  };

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setErrorMessage(null);

    try {
      await onConnectAccount(selectedProvider, newAccountName.trim() || undefined);
      setNewAccountName('');
      setShowAddModal(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect storage account.';
      setErrorMessage(msg);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (account: StorageAccount) => {
    const confirm = window.confirm(
      `Disconnect "${account.accountName}"?\n\nThis will remove stored credentials from your device. Your games and files stored on Google Drive will NOT be deleted.`
    );
    if (!confirm) return;

    setAccountActionLoading(account.id);
    try {
      await onDisconnectAccount(account.id);
    } catch (err) {
      console.error('Failed to disconnect account:', err);
    } finally {
      setAccountActionLoading(null);
    }
  };

  const handleReconnect = async (account: StorageAccount) => {
    setAccountActionLoading(account.id);
    try {
      await onReconnectAccount(account.id);
    } catch (err) {
      console.error('Failed to reconnect account:', err);
    } finally {
      setAccountActionLoading(null);
    }
  };

  const cloudTotal = quotaSummary?.cloudTotalBytes || 0;
  const cloudUsed = quotaSummary?.cloudUsedBytes || 0;
  const cloudFree = Math.max(0, cloudTotal - cloudUsed);
  const cloudPercent = cloudTotal > 0 ? Math.round((cloudUsed / cloudTotal) * 100) : 0;
  const activeAccounts = accounts.filter((a) => a.status === 'ACTIVE');

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800 }}>🗄 Storage & Cloud Accounts</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Manage your cloud vault providers, disk cache allocation, and connected services.
        </p>
      </div>

      {/* Top Overview Cards (Cloud Summary & Local Cache) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '24px',
          marginBottom: '32px'
        }}
      >
        {/* 1. Cloud Storage Summary Card */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>☁</span>
              <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Total Cloud Storage</h3>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                background: 'rgba(59, 130, 246, 0.15)',
                color: 'var(--accent-blue)',
                padding: '3px 8px',
                borderRadius: '4px'
              }}
            >
              {activeAccounts.length} Connected
            </span>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Aggregated Space:</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatBytes(cloudUsed)} / {formatBytes(cloudTotal)} ({cloudPercent}%)
              </span>
            </div>

            <div
              style={{
                width: '100%',
                height: '10px',
                background: 'var(--bg-surface)',
                borderRadius: '5px',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  width: `${cloudPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                  borderRadius: '5px',
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '12px',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px'
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Available Remotely</span>
              <strong style={{ color: 'var(--accent-green)' }}>{formatBytes(cloudFree)}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Active Providers</span>
              <strong style={{ color: 'var(--text-primary)' }}>Multi-Account Ready</strong>
            </div>
          </div>
        </div>

        {/* 2. Local Cache Card */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>💾</span>
              <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Local Disk Cache</h3>
            </div>
            <button
              onClick={handleClear}
              disabled={clearing}
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 10px' }}
            >
              {clearing ? 'Clearing...' : 'Clear Cache'}
            </button>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Cache Usage:</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatBytes(quotaSummary?.localCacheUsedBytes || 0)}
              </span>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
              Path: {quotaSummary?.localCachePath || 'Default user AppData'}
            </p>
          </div>

          <div
            style={{
              padding: '12px',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              display: 'flex',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Free Disk Space</span>
              <strong style={{ color: 'var(--text-primary)' }}>
                {formatBytes(quotaSummary?.localCacheAvailableBytes || 0)}
              </strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Security Vault</span>
              <strong style={{ color: 'var(--accent-green)' }}>DPAPI Encrypted</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Connected Storage Accounts Section */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          padding: '24px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 700 }}>Connected Storage Accounts</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Link multiple Google Drive accounts simultaneously. Each account operates independently.
            </p>
          </div>

          <button
            onClick={() => {
              setErrorMessage(null);
              setShowAddModal(true);
            }}
            className="btn btn-primary"
            style={{ fontSize: '13px' }}
          >
            + Connect New Account
          </button>
        </div>

        {/* Accounts List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {accounts.map((acc) => {
            const isActionLoading = accountActionLoading === acc.id;
            const isConnected = acc.status === 'ACTIVE';
            const accPercent =
              acc.quotaTotalBytes > 0
                ? Math.min(100, Math.round((acc.quotaUsedBytes / acc.quotaTotalBytes) * 100))
                : 0;

            return (
              <div
                key={acc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  background: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  opacity: isConnected ? 1 : 0.7,
                  gap: '20px'
                }}
              >
                {/* Account Identity */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: '260px' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '8px',
                      background: 'rgba(59, 130, 246, 0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '22px',
                      flexShrink: 0
                    }}
                  >
                    📁
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                      <h4 style={{ fontSize: '15px', fontWeight: 700 }}>{acc.accountName}</h4>
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: isConnected
                            ? 'rgba(16, 185, 129, 0.15)'
                            : 'rgba(148, 163, 184, 0.15)',
                          color: isConnected ? 'var(--accent-green)' : 'var(--text-muted)',
                          fontWeight: 700
                        }}
                      >
                        {isConnected ? '● Connected' : '○ Disconnected'}
                      </span>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {acc.accountEmail || 'No email specified'} • Google Drive
                    </span>
                  </div>
                </div>

                {/* Quota Bar */}
                <div style={{ flex: 1, maxWidth: '320px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      marginBottom: '4px',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    <span>Quota:</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {formatBytes(acc.quotaUsedBytes)} / {formatBytes(acc.quotaTotalBytes)} ({accPercent}%)
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '6px',
                      background: 'var(--bg-main)',
                      borderRadius: '3px',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        width: `${accPercent}%`,
                        height: '100%',
                        background: isConnected ? 'var(--accent-blue)' : 'var(--text-muted)',
                        borderRadius: '3px'
                      }}
                    />
                  </div>
                </div>

                {/* Actions: Reconnect / Disconnect */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {isConnected ? (
                    <>
                      <button
                        onClick={() => handleReconnect(acc)}
                        disabled={isActionLoading}
                        className="btn btn-secondary"
                        style={{ fontSize: '12px', padding: '6px 14px' }}
                      >
                        {isActionLoading ? 'Connecting...' : 'Reconnect'}
                      </button>
                      <button
                        onClick={() => handleDisconnect(acc)}
                        disabled={isActionLoading}
                        className="btn btn-danger"
                        style={{ fontSize: '12px', padding: '6px 14px' }}
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleReconnect(acc)}
                      disabled={isActionLoading}
                      className="btn btn-primary"
                      style={{ fontSize: '12px', padding: '6px 16px' }}
                    >
                      {isActionLoading ? 'Connecting...' : 'Connect'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {accounts.length === 0 && (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-sm)',
                border: '1px dashed var(--border-color)'
              }}
            >
              <p style={{ fontSize: '28px', marginBottom: '8px' }}>☁</p>
              <h4 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>No storage accounts linked yet</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Click "+ Connect New Account" to authenticate your Google Drive library.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => {
            if (!connecting) setShowAddModal(false);
          }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '28px',
              width: '460px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Connect Storage Account</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '18px' }}>
              Connect your Google Drive account. Authentication happens safely in your default browser via OAuth 2.0 PKCE.
            </p>

            {errorMessage && (
              <div
                style={{
                  padding: '12px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '12px',
                  color: 'var(--accent-red)',
                  marginBottom: '16px'
                }}
              >
                <strong>Authentication Notice:</strong>
                <p style={{ marginTop: '4px', wordBreak: 'break-word' }}>{errorMessage}</p>
                {errorMessage.includes('not configured') && (
                  <p style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Refer to <code>docs/GOOGLE_DRIVE_SETUP.md</code> to set up your Google Cloud Client ID.
                  </p>
                )}
              </div>
            )}

            <form onSubmit={handleConnectSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Storage Provider
                </label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value as StorageProviderType)}
                  disabled={connecting}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                >
                  <option value="google_drive">Google Drive (OAuth 2.0 PKCE)</option>
                  <option value="onedrive" disabled>OneDrive (Upcoming Phase)</option>
                  <option value="dropbox" disabled>Dropbox (Upcoming Phase)</option>
                  <option value="nas" disabled>NAS / Local Storage (Upcoming Phase)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Account Friendly Name (e.g. "Ryan Principal" or "Ryan Archive")
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ryan Principal"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  disabled={connecting}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                />
              </div>

              {connecting && (
                <div
                  style={{
                    padding: '12px',
                    background: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    fontSize: '12px',
                    color: 'var(--status-cloud)'
                  }}
                >
                  <span style={{ fontSize: '18px' }}>🌐</span>
                  <span>
                    Waiting for Google sign-in in your browser... Please approve the permissions and return here.
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={connecting}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" disabled={connecting} className="btn btn-primary">
                  {connecting ? 'Connecting...' : 'Connect with Google'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
