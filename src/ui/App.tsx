import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { Header } from './components/Header';
import { LibraryView } from './views/LibraryView';
import { InstalledView } from './views/InstalledView';
import { DownloadsView } from './views/DownloadsView';
import { PlatformsView } from './views/PlatformsView';
import { StorageScreen } from './views/StorageScreen';
import { SettingsView } from './views/SettingsView';
import { GameDetailsModal } from './components/GameDetailsModal';
import { formatBytes } from './components/StorageIndicator';
import {
  Game,
  StorageAccount,
  StorageQuotaSummary,
  DownloadItem,
  DownloadProgressEvent,
  StorageProviderType
} from '../core/types';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [games, setGames] = useState<Game[]>([]);
  const [accounts, setAccounts] = useState<StorageAccount[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [downloadProgressMap, setDownloadProgressMap] = useState<Record<string, DownloadProgressEvent>>({});
  const [preparationProgressMap, setPreparationProgressMap] = useState<Record<string, { step?: string; progressPercentage?: number }>>({});
  const [maxConcurrent, setMaxConcurrent] = useState<number>(2);
  const [quotaSummary, setQuotaSummary] = useState<StorageQuotaSummary | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Phase 4A Launcher State
  const [runningGames, setRunningGames] = useState<Set<string>>(new Set());
  const [selectedGameForDetails, setSelectedGameForDetails] = useState<Game | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadData = useCallback(async () => {
    if (!window.gameVault) return;
    try {
      const [allGames, allAccounts, quota, allDownloads, currentMaxConcurrent, running] = await Promise.all([
        window.gameVault.getAllGames(),
        window.gameVault.getStorageAccounts(),
        window.gameVault.getQuotaSummary(),
        window.gameVault.getAllDownloads(),
        window.gameVault.getMaxConcurrentDownloads ? window.gameVault.getMaxConcurrentDownloads() : Promise.resolve(2),
        window.gameVault.getRunningGames ? window.gameVault.getRunningGames() : Promise.resolve([])
      ]);

      setGames(allGames || []);
      setAccounts(allAccounts || []);
      setQuotaSummary(quota || null);
      setDownloads(allDownloads || []);
      if (typeof currentMaxConcurrent === 'number') {
        setMaxConcurrent(currentMaxConcurrent);
      }
      if (Array.isArray(running)) {
        setRunningGames(new Set(running));
      }
    } catch (err) {
      console.error('Error loading data via IPC:', err);
    }
  }, []);

  useEffect(() => {
    loadData();

    if (!window.gameVault) return;
    const vault = window.gameVault;

    const unsubSync = vault.onSyncProgress?.(async (progress) => {
      if (progress.status === 'COMPLETED') {
        showToast(`✨ Cloud sync complete! Discovered ${progress.gamesDetected} games.`);
        await loadData();
      } else if (progress.status === 'FAILED') {
        showToast(`❌ Sync failed for ${progress.accountName || 'storage'}: ${progress.error || 'Unknown error'}`);
      } else if (progress.status === 'CANCELLED') {
        showToast(`⚠️ Sync cancelled for ${progress.accountName || 'storage'}.`);
      }
    });

    const unsubDownloadProgress = vault.onDownloadProgress?.((progress) => {
      if (progress.gameId) {
        setDownloadProgressMap((prev) => ({ ...prev, [progress.gameId]: progress }));
      }
      setDownloads((prev) =>
        prev.map((d) =>
          d.id === progress.downloadId
            ? {
                ...d,
                downloadedBytes: progress.bytesTransferred,
                totalBytes: progress.totalBytes,
                downloadSpeedBps: progress.speedBps,
                status: progress.status
              }
            : d
        )
      );
    });

    const unsubDownloadState = vault.onDownloadStateChanged?.(async (event) => {
      if (event.status === 'COMPLETED') {
        showToast('⚡ Download complete! Preparing local files...');
        await loadData();
      } else if (event.status === 'FAILED') {
        showToast(`❌ Download failed: ${event.error || 'Transfer error'}`);
        await loadData();
      } else if (event.status === 'CANCELLED') {
        showToast('⚠️ Download cancelled.');
        await loadData();
      } else {
        await loadData();
      }
    });

    const unsubPreparation = vault.onPreparationProgress?.(async (progress: any) => {
      if (progress.gameId) {
        setPreparationProgressMap((prev) => ({
          ...prev,
          [progress.gameId]: {
            step: progress.step,
            progressPercentage: progress.progressPercentage
          }
        }));
      }
      if (progress.status === 'COMPLETED') {
        showToast('🎉 Preparation complete! Game verified and ready to play.');
        await loadData();
      } else if (progress.status === 'FAILED') {
        showToast(`❌ Preparation failed: ${progress.error || 'Extraction error'}`);
        await loadData();
      }
    });

    // Phase 4A: Running state changed event
    const unsubRunning = vault.onGameRunningStateChanged?.(async (event: any) => {
      setRunningGames((prev) => {
        const next = new Set(prev);
        if (event.isRunning) {
          next.add(event.gameId);
        } else {
          next.delete(event.gameId);
        }
        return next;
      });

      if (event.isRunning) {
        showToast(`🎮 Game started! Tracking play session.`);
      } else {
        showToast(`⏹ Game closed. Session duration & playtime recorded.`);
        await loadData();
      }
    });

    return () => {
      unsubSync?.();
      unsubDownloadProgress?.();
      unsubDownloadState?.();
      unsubPreparation?.();
      unsubRunning?.();
    };
  }, [loadData]);

  const handleGameAction = async (game: Game) => {
    if (!window.gameVault) return;

    if (game.state === 'CLOUD') {
      try {
        const strategyRes = await window.gameVault.getPlaybackStrategy(game.id);
        if (strategyRes && strategyRes.strategy === 'INSTANT_HYDRATION') {
          showToast(`⚡ Instant Play: Launching "${game.title}"...`);
          const session = await window.gameVault.hydrateAndLaunchGame(game.id);
          if (session && session.error) {
            showToast(`❌ Launch error: ${session.error.message || session.error}`);
          }
          await loadData();
          return;
        }
      } catch (err: any) {
        console.warn('Instant Play check failed, falling back to queue download:', err);
      }

      try {
        await window.gameVault.queueDownload(game.id);
        showToast(`Queued download for "${game.title}" to local cache.`);
        await loadData();
      } catch (err) {
        console.error('Failed to queue download:', err);
      }
    } else if (game.state === 'READY') {
      if (runningGames.has(game.id)) {
        showToast(`"${game.title}" is already running.`);
        return;
      }

      try {
        showToast(`🚀 Launching "${game.title}"...`);
        const session = await window.gameVault.launchGame(game.id);
        if (session && session.error) {
          showToast(`❌ Launch error: ${session.error.message || session.error}`);
        }
      } catch (err: any) {
        console.error('Failed to launch game:', err);
        showToast(`❌ Launch error: ${err.message || err}`);
      }
    } else if (game.state === 'DOWNLOADING') {
      showToast(`"${game.title}" is currently being transferred.`);
    }
  };

  const handleStopGame = async (game: Game) => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.stopGame(game.id);
      showToast(`Stopping session for "${game.title}"...`);
    } catch (err: any) {
      console.error('Failed to stop game:', err);
    }
  };

  const handlePauseDownload = async (downloadId: string) => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.pauseDownload(downloadId);
      showToast('Download paused.');
      await loadData();
    } catch (err) {
      console.error('Failed to pause download:', err);
    }
  };

  const handleResumeDownload = async (downloadId: string) => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.resumeDownload(downloadId);
      showToast('Resuming download...');
      await loadData();
    } catch (err) {
      console.error('Failed to resume download:', err);
    }
  };

  const handlePrioritizeDownload = async (downloadId: string) => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.prioritizeDownload(downloadId);
      showToast('Download prioritized to top of queue.');
      await loadData();
    } catch (err) {
      console.error('Failed to prioritize download:', err);
    }
  };

  const handleSetMaxConcurrent = async (slots: number) => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.setMaxConcurrentDownloads(slots);
      setMaxConcurrent(slots);
      showToast(`Active download slots set to ${slots}.`);
      await loadData();
    } catch (err) {
      console.error('Failed to update concurrent download limit:', err);
    }
  };

  const handleClearCompleted = async () => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.clearCompletedDownloads();
      showToast('Download history cleared.');
      await loadData();
    } catch (err) {
      console.error('Failed to clear completed downloads:', err);
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
    showToast(`Storage account "${account.accountName}" reconnected successfully.`);
    await loadData();
  };

  const handleRemoveLocalCopy = async (gameId: string) => {
    if (!window.gameVault) return;
    try {
      const res = await window.gameVault.removeLocalCopy(gameId);
      showToast(`Local copy removed (${formatBytes(res.freedBytes)} freed). Cloud entry preserved.`);
      await loadData();
    } catch (err: any) {
      console.error('Failed to remove local copy:', err);
      showToast(`Error: ${err.message || err}`);
    }
  };

  const handleTogglePinned = async (gameId: string, pinned: boolean) => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.setGamePinned(gameId, pinned);
      showToast(pinned ? '📌 Game pinned (protected from auto-eviction).' : 'Unpinned game.');
      await loadData();
    } catch (err: any) {
      console.error('Failed to toggle pinned:', err);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100vw', backgroundColor: 'var(--bg-app)' }}>
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        counts={{
          library: games.length,
          installed: games.filter((g) => g.state === 'READY').length,
          downloads: downloads.filter((d) => d.status === 'DOWNLOADING' || d.status === 'QUEUED').length
        }}
      />

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <Header
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          quotaSummary={quotaSummary}
          onNavigateToStorage={() => setActiveTab('storage')}
        />

        <main style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          {activeTab === 'library' && (
            <LibraryView
              games={games}
              searchQuery={searchQuery}
              onGameAction={handleGameAction}
              runningGames={runningGames}
              onCardClick={(game) => setSelectedGameForDetails(game)}
              downloadProgressMap={downloadProgressMap}
              preparationProgressMap={preparationProgressMap}
              onPauseDownload={handlePauseDownload}
              onResumeDownload={handleResumeDownload}
              onCancelDownload={handleCancelDownload}
              onRemoveLocalCopy={handleRemoveLocalCopy}
              onTogglePinned={handleTogglePinned}
            />
          )}
          {activeTab === 'installed' && (
            <InstalledView
              games={games}
              searchQuery={searchQuery}
              onGameAction={handleGameAction}
              runningGames={runningGames}
              onCardClick={(game) => setSelectedGameForDetails(game)}
              onNavigateToLibrary={() => setActiveTab('library')}
              onRemoveLocalCopy={handleRemoveLocalCopy}
              onTogglePinned={handleTogglePinned}
            />
          )}
          {activeTab === 'downloads' && (
            <DownloadsView
              downloads={downloads}
              games={games}
              preparationProgressMap={preparationProgressMap}
              maxConcurrent={maxConcurrent}
              onSetMaxConcurrent={handleSetMaxConcurrent}
              onPauseDownload={handlePauseDownload}
              onResumeDownload={handleResumeDownload}
              onCancelDownload={handleCancelDownload}
              onPrioritizeDownload={handlePrioritizeDownload}
              onClearCompleted={handleClearCompleted}
            />
          )}
          {activeTab === 'platforms' && <PlatformsView games={games} onGameAction={handleGameAction} />}
          {activeTab === 'storage' && (
            <StorageScreen
              accounts={accounts}
              quotaSummary={quotaSummary}
              games={games}
              onRefreshData={loadData}
              onClearCache={handleClearCache}
              onConnectAccount={handleConnectAccount}
              onDisconnectAccount={handleDisconnectAccount}
              onReconnectAccount={handleReconnectAccount}
            />
          )}
          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Game Details Modal */}
      {selectedGameForDetails && (
        <GameDetailsModal
          game={selectedGameForDetails}
          isRunning={runningGames.has(selectedGameForDetails.id)}
          onClose={() => setSelectedGameForDetails(null)}
          onLaunch={handleGameAction}
          onStop={handleStopGame}
          onOpenSettings={() => {
            setSelectedGameForDetails(null);
            setActiveTab('settings');
          }}
        />
      )}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '28px',
            right: '28px',
            background: 'rgba(23, 31, 48, 0.92)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            color: 'var(--text-primary)',
            padding: '12px 20px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid rgba(59, 130, 246, 0.5)',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6), 0 0 16px rgba(59, 130, 246, 0.25)',
            fontSize: '13px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            zIndex: 9999,
            animation: 'slideUpFade 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          <span style={{ fontSize: '15px' }}>⚡</span>
          <span style={{ letterSpacing: '0.2px' }}>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
