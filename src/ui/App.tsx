import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { Header } from './components/Header';
import { LibraryView } from './views/LibraryView';
import { InstalledView } from './views/InstalledView';
import { DownloadsView } from './views/DownloadsView';
import { PlatformsView } from './views/PlatformsView';
import { StorageScreen } from './views/StorageScreen';
import { SettingsView } from './views/SettingsView';
import { Game, StorageAccount, StorageQuotaSummary, DownloadItem, StorageProviderType } from '../core/types';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [games, setGames] = useState<Game[]>([]);
  const [accounts, setAccounts] = useState<StorageAccount[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [quotaSummary, setQuotaSummary] = useState<StorageQuotaSummary | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = useCallback(async () => {
    if (!window.gameVault) return;
    try {
      const [allGames, allAccounts, quota, allDownloads] = await Promise.all([
        window.gameVault.getAllGames(),
        window.gameVault.getStorageAccounts(),
        window.gameVault.getQuotaSummary(),
        window.gameVault.getAllDownloads()
      ]);

      setGames(allGames || []);
      setAccounts(allAccounts || []);
      setQuotaSummary(quota || null);
      setDownloads(allDownloads || []);
    } catch (err) {
      console.error('Error loading data via IPC:', err);
    }
  }, []);

  useEffect(() => {
    loadData();

    if (!window.gameVault) return;
    const unsub = window.gameVault.onSyncProgress(async (progress) => {
      if (progress.status === 'COMPLETED') {
        showToast(`✨ Cloud sync complete! Discovered ${progress.gamesDetected} games.`);
        await loadData();
      } else if (progress.status === 'FAILED') {
        showToast(`❌ Sync failed for ${progress.accountName || 'storage'}: ${progress.error || 'Unknown error'}`);
      } else if (progress.status === 'CANCELLED') {
        showToast(`⚠️ Sync cancelled for ${progress.accountName || 'storage'}.`);
      }
    });

    return () => {
      unsub();
    };
  }, [loadData]);

  const handleGameAction = async (game: Game) => {
    if (!window.gameVault) return;

    if (game.state === 'CLOUD') {
      try {
        await window.gameVault.queueDownload(game.id);
        showToast(`Queued download for "${game.title}" to local cache.`);
        await loadData();
      } catch (err) {
        console.error('Failed to queue download:', err);
      }
    } else if (game.state === 'READY') {
      showToast(`Launching "${game.title}"! (Execution Engine will connect in Phase 4)`);
    } else if (game.state === 'DOWNLOADING') {
      showToast(`"${game.title}" is currently being transferred.`);
    }
  };

  const handleCancelDownload = async (downloadId: string) => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.cancelDownload(downloadId);
      showToast('Download cancelled.');
      await loadData();
    } catch (err) {
      console.error('Failed to cancel download:', err);
    }
  };

  const handleClearCache = async () => {
    if (!window.gameVault) return;
    try {
      const updatedQuota = await window.gameVault.clearCache();
      setQuotaSummary(updatedQuota);
      showToast('Local cache cleared successfully.');
    } catch (err) {
      console.error('Failed to clear cache:', err);
    }
  };

  const handleConnectAccount = async (type: StorageProviderType, name?: string) => {
    if (!window.gameVault) return;
    const account = await window.gameVault.connectStorageAccount({ type, name });
    showToast(`Storage account "${account.accountName}" connected successfully.`);
    await loadData();
  };

  const handleDisconnectAccount = async (accountId: string) => {
    if (!window.gameVault) return;
    await window.gameVault.disconnectStorageAccount(accountId);
    showToast('Storage account disconnected.');
    await loadData();
  };

  const handleReconnectAccount = async (accountId: string) => {
    if (!window.gameVault) return;
    const account = await window.gameVault.reconnectStorageAccount(accountId);
    showToast(`Storage account "${account.accountName}" reconnected.`);
    await loadData();
  };

  const installedCount = games.filter((g) => g.state === 'READY').length;
  const downloadingCount = downloads.filter((d) => d.status === 'DOWNLOADING' || d.status === 'QUEUED').length;

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        counts={{
          library: games.length,
          installed: installedCount,
          downloads: downloadingCount
        }}
      />

      {/* Main Viewport */}
      <div className="main-wrapper">
        <Header
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          quotaSummary={quotaSummary}
          onNavigateToStorage={() => setActiveTab('storage')}
        />

        <main className="content-viewport">
          {activeTab === 'library' && (
            <LibraryView games={games} searchQuery={searchQuery} onGameAction={handleGameAction} />
          )}
          {activeTab === 'installed' && (
            <InstalledView games={games} searchQuery={searchQuery} onGameAction={handleGameAction} />
          )}
          {activeTab === 'downloads' && (
            <DownloadsView downloads={downloads} games={games} onCancelDownload={handleCancelDownload} />
          )}
          {activeTab === 'platforms' && <PlatformsView games={games} onGameAction={handleGameAction} />}
          {activeTab === 'storage' && (
            <StorageScreen
              accounts={accounts}
              quotaSummary={quotaSummary}
              onClearCache={handleClearCache}
              onConnectAccount={handleConnectAccount}
              onDisconnectAccount={handleDisconnectAccount}
              onReconnectAccount={handleReconnectAccount}
            />
          )}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            padding: '12px 20px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--accent-blue)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            fontSize: '13px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            zIndex: 9999,
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <span>⚡</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
