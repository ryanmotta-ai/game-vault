import React, { useState } from 'react';
import { StorageAccount, StorageQuotaSummary, StorageProviderType } from '../../core/types';
import { formatBytes } from '../components/StorageIndicator';

interface StorageScreenProps {
  accounts: StorageAccount[];
  quotaSummary: StorageQuotaSummary | null;
  onClearCache: () => Promise<void>;
  onAddAccount: (name: string, type: StorageProviderType, email?: string) => Promise<void>;
}

export const StorageScreen: React.FC<StorageScreenProps> = ({
  accounts,
  quotaSummary,
  onClearCache,
  onAddAccount
}) => {
  const [clearing, setClearing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountEmail, setNewAccountEmail] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<StorageProviderType>('google_drive');

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClearCache();
    } finally {
      setClearing(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccountName) return;
    await onAddAccount(newAccountName, selectedProvider, newAccountEmail || undefined);
    setNewAccountName('');
    setNewAccountEmail('');
    setShowAddModal(false);
  };

  const cloudTotal = quotaSummary?.cloudTotalBytes || 0;
  const cloudUsed = quotaSummary?.cloudUsedBytes || 0;
  const cloudFree = Math.max(0, cloudTotal - cloudUsed);
  const cloudPercent = cloudTotal > 0 ? Math.round((cloudUsed / cloudTotal) * 100) : 0;

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800 }}>🗄 Storage & Cloud Accounts</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Manage your cloud vault providers, disk cache allocation, and connected services.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        {/* 1. Cloud Storage Card */}
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
              <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Cloud Storage</h3>
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
              Google Drive
            </span>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Total Space Used:</span>
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
                  borderRadius: '5px'
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
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Accounts Linked</span>
              <strong style={{ color: 'var(--text-primary)' }}>{accounts.length} active</strong>
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
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Cache Mode</span>
              <strong style={{ color: 'var(--accent-blue)' }}>On-Demand Transfer</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Connected Accounts Section */}
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
              Link your cloud storage providers to index and stream your game library.
            </p>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary"
            style={{ fontSize: '13px' }}
          >
            + Connect New Account
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {accounts.map((acc) => (
            <div
              key={acc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '8px',
                    background: 'rgba(59, 130, 246, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px'
                  }}
                >
                  📁
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 700 }}>{acc.accountName}</h4>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: acc.status === 'ACTIVE' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: acc.status === 'ACTIVE' ? 'var(--accent-green)' : 'var(--accent-red)',
                        fontWeight: 700
                      }}
                    >
                      {acc.status}
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {acc.accountEmail || 'No email specified'} • Provider: {acc.providerType}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, display: 'block' }}>
                    {formatBytes(acc.quotaUsedBytes)} / {formatBytes(acc.quotaTotalBytes)}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Quota Consumption
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '28px',
              width: '420px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Connect Storage Provider</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Add a new cloud or network storage account to your Game Vault library.
            </p>

            <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Storage Provider
                </label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value as StorageProviderType)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                >
                  <option value="google_drive">Google Drive</option>
                  <option value="onedrive" disabled>OneDrive (Phase Roadmap)</option>
                  <option value="dropbox" disabled>Dropbox (Phase Roadmap)</option>
                  <option value="nas" disabled>NAS / Network Storage (Phase Roadmap)</option>
                  <option value="local" disabled>Local Folder (Phase Roadmap)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Account Friendly Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Google Drive Secondary"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Email / Identifier
                </label>
                <input
                  type="email"
                  placeholder="e.g. user@gmail.com"
                  value={newAccountEmail}
                  onChange={(e) => setNewAccountEmail(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Connect Provider
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
