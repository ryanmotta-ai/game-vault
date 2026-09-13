import React, { useState, useEffect } from 'react';
import { StorageAccount, StorageQuotaSummary, StorageProviderType, SyncProgress, CacheBreakdown, Game } from '../../core/types';
import { formatBytes } from '../components/StorageIndicator';

interface StorageScreenProps {
  accounts: StorageAccount[];
  quotaSummary: StorageQuotaSummary | null;
  games?: Game[];
  onRefreshData?: () => Promise<void>;
  onClearCache: () => Promise<void>;
  onConnectAccount: (type: StorageProviderType, name?: string) => Promise<void>;
  onDisconnectAccount: (accountId: string) => Promise<void>;
  onReconnectAccount: (accountId: string) => Promise<void>;
}

export const StorageScreen: React.FC<StorageScreenProps> = ({
  accounts,
  quotaSummary,
  games = [],
  onRefreshData,
  onClearCache,
  onConnectAccount,
  onDisconnectAccount,
  onReconnectAccount
}) => {
  const [clearing, setClearing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accountActionLoading, setAccountActionLoading] = useState<string | null>(null);
  const [cacheBreakdown, setCacheBreakdown] = useState<CacheBreakdown | null>(null);
  const [verifyingGameId, setVerifyingGameId] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<Record<string, { valid: boolean; missingFiles?: string[]; checkedAt?: string }>>({});
  const [evictingGameId, setEvictingGameId] = useState<string | null>(null);

  const [newAccountName, setNewAccountName] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<StorageProviderType>('google_drive');

  // Sync state
  const [syncProgressMap, setSyncProgressMap] = useState<Record<string, SyncProgress>>({});
  const [syncSummaryMap, setSyncSummaryMap] = useState<
    Record<string, { fileCount: number; folderCount: number; lastSyncAt: string | null }>
  >({});
  const [isScanningAll, setIsScanningAll] = useState(false);

  const refreshCacheBreakdown = async () => {
    if (!window.gameVault?.getCacheBreakdown) return;
    try {
      const breakdown = await window.gameVault.getCacheBreakdown();
      setCacheBreakdown(breakdown);
    } catch (err) {
      console.error('Failed to get cache breakdown:', err);
    }
  };

  const refreshSyncSummaries = async () => {
    if (!window.gameVault) return;
    try {
      const summary = await window.gameVault.getSyncSummary();
      const map: Record<string, { fileCount: number; folderCount: number; lastSyncAt: string | null }> = {};
      for (const item of summary.accounts) {
        map[item.accountId] = {
          fileCount: item.fileCount,
          folderCount: item.folderCount,
          lastSyncAt: item.lastSyncAt
        };
      }
      setSyncSummaryMap(map);
    } catch (err) {
      console.error('Failed to fetch sync summary:', err);
    }
  };

  useEffect(() => {
    refreshSyncSummaries();
    refreshCacheBreakdown();

    if (!window.gameVault) return;
    const unsub = window.gameVault.onSyncProgress((progress: SyncProgress) => {
      setSyncProgressMap((prev) => ({
        ...prev,
        [progress.accountId]: progress
      }));

      if (progress.status === 'COMPLETED' || progress.status === 'FAILED' || progress.status === 'CANCELLED') {
        refreshSyncSummaries();
        refreshCacheBreakdown();
        setTimeout(() => {
          setSyncProgressMap((prev) => {
            const next = { ...prev };
            delete next[progress.accountId];
            return next;
          });
        }, 5000);
      }
    });

    return () => {
      unsub();
    };
  }, []);

  const handleScanAccount = async (accountId: string) => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.scanAccount(accountId);
    } catch (err) {
      console.error('Failed to scan account:', err);
    }
  };

  const handleScanAll = async () => {
    if (!window.gameVault) return;
    setIsScanningAll(true);
    try {
      await window.gameVault.scanAllAccounts();
    } catch (err) {
      console.error('Failed to scan all accounts:', err);
    } finally {
      setIsScanningAll(false);
    }
  };

  const handleCancelScan = async (accountId?: string) => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.cancelScan(accountId);
    } catch (err) {
      console.error('Failed to cancel scan:', err);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClearCache();
      await refreshCacheBreakdown();
    } finally {
      setClearing(false);
    }
  };

  const handleRemoveLocalCopy = async (gameId: string) => {
    if (!window.gameVault?.removeLocalCopy) return;
    setEvictingGameId(gameId);
    try {
      await window.gameVault.removeLocalCopy(gameId);
      await refreshCacheBreakdown();
      await onRefreshData?.();
    } catch (err) {
      console.error('Failed to evict game:', err);
    } finally {
      setEvictingGameId(null);
    }
  };

  const handleTogglePinned = async (gameId: string, pinned: boolean) => {
    if (!window.gameVault?.setGamePinned) return;
    try {
      await window.gameVault.setGamePinned(gameId, pinned);
      await onRefreshData?.();
    } catch (err) {
      console.error('Failed to toggle pinned:', err);
    }
  };

  const handleVerifyGame = async (gameId: string) => {
    if (!window.gameVault?.verifyLocalGame) return;
    setVerifyingGameId(gameId);
    try {
      const res = await window.gameVault.verifyLocalGame(gameId, false);
      setVerificationResult((prev) => ({
        ...prev,
        [gameId]: {
          valid: res.valid,
          missingFiles: res.missingFiles,
          checkedAt: new Date().toLocaleTimeString()
        }
      }));
    } catch (err) {
      console.error('Failed to verify game:', err);
    } finally {
      setVerifyingGameId(null);
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
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Local Disk Cache (V2)</h3>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Smart Cache & Sandbox Manager</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowManageModal(true)}
                className="btn btn-primary"
                style={{ fontSize: '11px', padding: '4px 10px' }}
                title="Manage local game files, pinning, and disk eviction"
              >
                ⚡ Manage Cache
              </button>
              <button
                onClick={handleClear}
                disabled={clearing}
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '4px 10px' }}
              >
                {clearing ? 'Clearing...' : 'Clear All'}
              </button>
            </div>
          </div>

          {/* Usage vs Limit Progress Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Cache Usage / Limit:</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatBytes(cacheBreakdown?.totalBytes ?? (quotaSummary?.localCacheUsedBytes || 0))} / {formatBytes(cacheBreakdown?.configuredLimitBytes || 536870912000)}
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '8px',
                background: 'var(--bg-surface)',
                borderRadius: '4px',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.round(((cacheBreakdown?.totalBytes ?? (quotaSummary?.localCacheUsedBytes || 0)) / (cacheBreakdown?.configuredLimitBytes || 536870912000)) * 100))}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #10b981, #3b82f6)',
                  borderRadius: '4px',
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
          </div>

          {/* Breakdown Mini Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '8px',
              fontSize: '11px'
            }}
          >
            <div style={{ background: 'var(--bg-surface)', padding: '8px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px' }}>🎮 Games</span>
              <strong style={{ color: 'var(--text-primary)' }}>{formatBytes(cacheBreakdown?.gameBytes || 0)}</strong>
            </div>
            <div style={{ background: 'var(--bg-surface)', padding: '8px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px' }}>📥 Partials</span>
              <strong style={{ color: 'var(--text-primary)' }}>{formatBytes(cacheBreakdown?.partialBytes || 0)}</strong>
            </div>
            <div style={{ background: 'var(--bg-surface)', padding: '8px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px' }}>⚙️ Sandbox</span>
              <strong style={{ color: 'var(--text-primary)' }}>{formatBytes(cacheBreakdown?.tempBytes || 0)}</strong>
            </div>
            <div style={{ background: 'var(--bg-surface)', padding: '8px', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '10px' }}>🖼️ Artwork</span>
              <strong style={{ color: 'var(--text-primary)' }}>{formatBytes(cacheBreakdown?.artworkBytes || 0)}</strong>
            </div>
          </div>

          <div
            style={{
              padding: '10px 12px',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              display: 'flex',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Drive Free Space</span>
              <strong style={{ color: 'var(--accent-green)' }}>
                {formatBytes(cacheBreakdown?.freeDiskBytes ?? (quotaSummary?.localCacheAvailableBytes || 0))}
              </strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', display: 'block' }}>Safety Buffer</span>
              <strong style={{ color: 'var(--text-primary)' }}>512 MB</strong>
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

          <div style={{ display: 'flex', gap: '10px' }}>
            {activeAccounts.length > 0 && (
              <button
                onClick={handleScanAll}
                disabled={isScanningAll}
                className="btn btn-secondary"
                style={{ fontSize: '13px' }}
              >
                {isScanningAll ? '⏳ Scanning All...' : '🔍 Scan All Accounts'}
              </button>
            )}
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
            const accSummary = syncSummaryMap[acc.id];
            const accProgress = syncProgressMap[acc.id];
            const isScanning = accProgress && accProgress.status === 'RUNNING';

            return (
              <div
                key={acc.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '16px 20px',
                  background: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  opacity: isConnected ? 1 : 0.7,
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
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
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        <span>{acc.accountEmail || 'No email specified'} • Google Drive</span>
                        {accSummary && (
                          <span style={{ marginLeft: '8px' }}>
                            • <strong>{accSummary.fileCount}</strong> files indexed
                            {accSummary.lastSyncAt ? ` (Synced: ${new Date(accSummary.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ' (Never scanned)'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Quota Bar */}
                  <div style={{ flex: 1, maxWidth: '280px' }}>
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

                  {/* Actions: Scan / Reconnect / Disconnect */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {isConnected ? (
                      <>
                        <button
                          onClick={() => handleScanAccount(acc.id)}
                          disabled={isScanning || isActionLoading}
                          className="btn btn-secondary"
                          style={{
                            fontSize: '12px',
                            padding: '6px 14px',
                            borderColor: isScanning ? 'var(--accent-blue)' : undefined
                          }}
                        >
                          {isScanning ? 'Scanning...' : '🔍 Scan Library'}
                        </button>
                        <button
                          onClick={() => handleReconnect(acc)}
                          disabled={isActionLoading || isScanning}
                          className="btn btn-secondary"
                          style={{ fontSize: '12px', padding: '6px 14px' }}
                        >
                          {isActionLoading ? 'Connecting...' : 'Reconnect'}
                        </button>
                        <button
                          onClick={() => handleDisconnect(acc)}
                          disabled={isActionLoading || isScanning}
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

                {/* Live Scanning Progress Banner */}
                {isScanning && accProgress && (
                  <div
                    style={{
                      padding: '10px 14px',
                      background: 'rgba(59, 130, 246, 0.08)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '16px', animation: 'spin 2s linear infinite' }}>🔄</span>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontSize: '10px',
                              fontWeight: 800,
                              background: 'var(--accent-blue)',
                              color: '#fff',
                              padding: '2px 6px',
                              borderRadius: '3px'
                            }}
                          >
                            {accProgress.phase}
                          </span>
                          <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '11px' }}>
                            {accProgress.currentPath || '/'}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          Files Scanned: <strong>{accProgress.filesScanned}</strong> • Folders: <strong>{accProgress.foldersScanned}</strong> • Games Identified: <strong>{accProgress.gamesDetected}</strong>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleCancelScan(acc.id)}
                      className="btn btn-secondary"
                      style={{ fontSize: '11px', padding: '4px 10px', color: 'var(--accent-red)' }}
                    >
                      Cancel Scan
                    </button>
                  </div>
                )}
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

      {/* Manage Cache Modal */}
      {showManageModal && (
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
          onClick={() => setShowManageModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '28px',
              width: '680px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>💾</span>
                  <span>Manage Local Cache & Installed Games</span>
                </h3>
                <button
                  onClick={() => setShowManageModal(false)}
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '12px' }}
                >
                  ✕
                </button>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                View and manage locally installed game files. Pinned games are exempt from LRU cache eviction.
              </p>
            </div>

            {/* Info alert */}
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '11px',
                color: 'var(--text-primary)',
                lineHeight: 1.4
              }}
            >
              💡 <strong>Preservation Guarantee:</strong> Removing a local copy frees disk space immediately. Your cloud save files, inventory entry, and playtime records are always preserved.
            </div>

            {/* Installed Games List */}
            <div
              style={{
                overflowY: 'auto',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                paddingRight: '4px'
              }}
            >
              {(() => {
                const installedGames = games.filter((g) => g.state === 'READY');
                if (installedGames.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                      <p style={{ fontSize: '28px', marginBottom: '8px' }}>📦</p>
                      <p style={{ fontSize: '13px', fontWeight: 600 }}>No games currently installed in local cache.</p>
                      <p style={{ fontSize: '11px', marginTop: '4px' }}>Download games from your library to play them offline.</p>
                    </div>
                  );
                }

                return installedGames.map((game) => {
                  const verification = verificationResult[game.id];
                  const isVerifying = verifyingGameId === game.id;
                  const isEvicting = evictingGameId === game.id;

                  return (
                    <div
                      key={game.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        background: 'var(--bg-surface)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)',
                        gap: '14px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                        <div
                          style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '4px',
                            background: '#151d2c',
                            backgroundImage: game.coverUrl ? `url(${game.coverUrl})` : undefined,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '18px',
                            flexShrink: 0
                          }}
                        >
                          {!game.coverUrl && '🎮'}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <h4
                            style={{
                              fontSize: '14px',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              color: 'var(--text-primary)'
                            }}
                            title={game.title}
                          >
                            {game.title}
                          </h4>
                          <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                            <span style={{ color: 'var(--accent-blue)' }}>{game.platform}</span>
                            <span>•</span>
                            <span style={{ fontWeight: 600 }}>{formatBytes(game.sizeBytes)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right Action buttons */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        {/* Verify button or status */}
                        {verification ? (
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              color: verification.valid ? 'var(--accent-green)' : 'var(--accent-red)',
                              background: verification.valid ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                              padding: '3px 8px',
                              borderRadius: '4px'
                            }}
                            title={verification.valid ? 'All manifest files verified intact' : `Missing: ${verification.missingFiles?.join(', ')}`}
                          >
                            {verification.valid ? '✓ Verified' : '⚠️ Missing'}
                          </span>
                        ) : (
                          <button
                            onClick={() => handleVerifyGame(game.id)}
                            disabled={isVerifying}
                            className="btn btn-secondary"
                            style={{ fontSize: '11px', padding: '3px 8px' }}
                            title="Verify local manifest files on disk"
                          >
                            {isVerifying ? 'Checking...' : '🔍 Verify'}
                          </button>
                        )}

                        {/* Pin button */}
                        <button
                          onClick={() => handleTogglePinned(game.id, !game.pinned)}
                          className="btn btn-secondary"
                          style={{
                            fontSize: '11px',
                            padding: '3px 8px',
                            background: game.pinned ? 'rgba(234, 179, 8, 0.15)' : undefined,
                            borderColor: game.pinned ? 'rgba(234, 179, 8, 0.4)' : undefined,
                            color: game.pinned ? '#facc15' : 'var(--text-secondary)'
                          }}
                          title={game.pinned ? 'Pinned (protected from auto-eviction). Click to unpin.' : 'Pin to protect from auto-eviction'}
                        >
                          📌 {game.pinned ? 'Pinned' : 'Pin'}
                        </button>

                        {/* Evict button */}
                        <button
                          onClick={() => {
                            if (window.confirm(`Remove local copy of "${game.title}"?\n\nThis frees up ${formatBytes(game.sizeBytes)} on your disk. Cloud record and playtime are preserved.`)) {
                              handleRemoveLocalCopy(game.id);
                            }
                          }}
                          disabled={isEvicting}
                          className="btn btn-secondary"
                          style={{ fontSize: '11px', padding: '3px 8px', color: 'var(--accent-red)' }}
                          title="Evict local files and return to cloud state"
                        >
                          {isEvicting ? 'Evicting...' : '🗑 Evict'}
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
              <button onClick={() => setShowManageModal(false)} className="btn btn-secondary" style={{ padding: '7px 18px' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
