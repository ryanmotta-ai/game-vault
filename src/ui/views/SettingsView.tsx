import React, { useEffect, useState } from 'react';
<<<<<<< Updated upstream
=======
import { Emulator } from '../../core/types';
import { IntegrationsHubView } from './IntegrationsHubView';
import { MetadataReviewModal } from '../components/MetadataReviewModal';
import { formatBytes } from '../components/StorageIndicator';

const DEFAULT_EMULATOR_TEMPLATES = [
  {
    id: 'emu_pcsx2',
    name: 'PCSX2',
    adapterType: 'pcsx2',
    platforms: ['PlayStation 2']
  },
  {
    id: 'emu_duckstation',
    name: 'DuckStation',
    adapterType: 'duckstation',
    platforms: ['PlayStation']
  },
  {
    id: 'emu_dolphin',
    name: 'Dolphin',
    adapterType: 'dolphin',
    platforms: ['GameCube', 'Wii']
  },
  {
    id: 'emu_ppsspp',
    name: 'PPSSPP',
    adapterType: 'ppsspp',
    platforms: ['PSP']
  },
  {
    id: 'emu_retroarch',
    name: 'RetroArch',
    adapterType: 'retroarch',
    platforms: ['NES', 'SNES', 'Game Boy', 'Game Boy Color', 'Game Boy Advance', 'Nintendo 64']
  }
];
>>>>>>> Stashed changes

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

<<<<<<< Updated upstream
  useEffect(() => {
    if (window.gameVault) {
      window.gameVault.getSystemInfo().then(setSystemInfo).catch(console.error);
    }
  }, []);

=======
  const [emulators, setEmulators] = useState<Emulator[]>([]);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [hydrationLimitMb, setHydrationLimitMb] = useState<number>(128);
  const [cacheMaxGb, setCacheMaxGb] = useState<number>(50);
  const [finishCaching, setFinishCaching] = useState<boolean>(true);
  const [readAheadBlocks, setReadAheadBlocks] = useState<number>(2);
  const [currentSection, setCurrentSection] = useState<'integrations' | 'metadata' | 'system'>('integrations');
  const [preferredProvider, setPreferredProvider] = useState<string>('screenscraper');
  const [preferredLanguage, setPreferredLanguage] = useState<string>('en');
  const [preferredRegion, setPreferredRegion] = useState<string>('NA');
  const [artworkStats, setArtworkStats] = useState<any>(null);
  const [reviewQueueCount, setReviewQueueCount] = useState<number>(0);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [isClearingCache, setIsClearingCache] = useState<boolean>(false);
  const [isBatchRefreshing, setIsBatchRefreshing] = useState<boolean>(false);

  const loadEmulators = async () => {
    if (!window.gameVault) return;
    try {
      const all = await window.gameVault.getAllEmulators();
      setEmulators(all);
    } catch (err) {
      console.error('Failed to load emulators:', err);
    }
  };

  const loadStreamingSettings = async () => {
    if (!window.gameVault) return;
    try {
      const settings = await window.gameVault.getSettings();
      if (settings.instant_hydration_max_size_mb) {
        setHydrationLimitMb(Number(settings.instant_hydration_max_size_mb));
      }
      if (settings.streaming_cache_max_bytes) {
        setCacheMaxGb(Math.round(Number(settings.streaming_cache_max_bytes) / (1024 * 1024 * 1024)));
      }
      if (settings.finish_caching_streamed_games !== undefined) {
        setFinishCaching(settings.finish_caching_streamed_games === 'true' || settings.finish_caching_streamed_games === true);
      }
      if (settings.streaming_read_ahead_blocks) {
        setReadAheadBlocks(Number(settings.streaming_read_ahead_blocks));
      }
    } catch (e) {
      console.error('Failed to load streaming settings:', e);
    }
  };

  const loadMetadataSettings = async () => {
    if (!window.gameVault) return;
    try {
      const settings = await window.gameVault.getSettings();
      if (settings.metadata_preferred_provider) {
        setPreferredProvider(String(settings.metadata_preferred_provider));
      }
      if (settings.metadata_preferred_language) {
        setPreferredLanguage(String(settings.metadata_preferred_language));
      }
      if (settings.metadata_preferred_region) {
        setPreferredRegion(String(settings.metadata_preferred_region));
      }

      const stats = await window.gameVault.getArtworkCacheStats();
      setArtworkStats(stats);

      const queue = await window.gameVault.getMetadataReviewQueue(100);
      setReviewQueueCount(queue ? queue.length : 0);
    } catch (e) {
      console.error('Failed to load metadata settings:', e);
    }
  };

  useEffect(() => {
    if (window.gameVault) {
      window.gameVault.getSystemInfo().then(setSystemInfo).catch(console.error);
      loadEmulators();
      loadStreamingSettings();
      loadMetadataSettings();
    }
  }, []);

  const handleUpdateHydrationLimit = async (mb: number) => {
    setHydrationLimitMb(mb);
    await window.gameVault?.setSetting('instant_hydration_max_size_mb', mb.toString());
  };

  const handleUpdateCacheMaxGb = async (gb: number) => {
    setCacheMaxGb(gb);
    await window.gameVault?.setSetting('streaming_cache_max_bytes', (gb * 1024 * 1024 * 1024).toString());
  };

  const handleToggleFinishCaching = async (val: boolean) => {
    setFinishCaching(val);
    await window.gameVault?.setSetting('finish_caching_streamed_games', val.toString());
  };

  const handleUpdateReadAhead = async (blocks: number) => {
    setReadAheadBlocks(blocks);
    await window.gameVault?.setSetting('streaming_read_ahead_blocks', blocks.toString());
  };

  const handleClearStreamingCache = async () => {
    if (!window.gameVault) return;
    try {
      await window.gameVault.clearStreamingCache();
      setFeedbackMessage('Streaming block cache cleared successfully.');
      setTimeout(() => setFeedbackMessage(null), 4000);
    } catch (err: any) {
      setFeedbackMessage(`Failed to clear streaming cache: ${err.message || err}`);
    }
  };

  const handleClearArtworkCache = async () => {
    if (!window.gameVault || isClearingCache) return;
    setIsClearingCache(true);
    try {
      await window.gameVault.clearArtworkCache();
      await loadMetadataSettings();
      setFeedbackMessage('Artwork cache cleared successfully.');
      setTimeout(() => setFeedbackMessage(null), 3500);
    } catch (err: any) {
      setFeedbackMessage(`Failed to clear artwork cache: ${err.message || err}`);
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleBatchRefreshMetadata = async () => {
    if (!window.gameVault || isBatchRefreshing) return;
    setIsBatchRefreshing(true);
    try {
      setFeedbackMessage('Starting background metadata batch refresh...');
      await window.gameVault.scrapeAllMetadata({ overwrite: false });
      setFeedbackMessage('Metadata batch retrieval queued.');
      setTimeout(() => setFeedbackMessage(null), 3500);
      await loadMetadataSettings();
    } catch (err: any) {
      setFeedbackMessage(`Failed to refresh metadata: ${err.message || err}`);
    } finally {
      setIsBatchRefreshing(false);
    }
  };

  const handleUpdateProvider = async (val: string) => {
    setPreferredProvider(val);
    await window.gameVault?.setSetting('metadata_preferred_provider', val);
  };

  const handleUpdateLanguage = async (val: string) => {
    setPreferredLanguage(val);
    await window.gameVault?.setSetting('metadata_preferred_language', val);
  };

  const handleUpdateRegion = async (val: string) => {
    setPreferredRegion(val);
    await window.gameVault?.setSetting('metadata_preferred_region', val);
  };

  const handleAutoDetect = async () => {
    if (!window.gameVault) return;
    setIsDetecting(true);
    setFeedbackMessage('Scanning system for installed emulators...');
    try {
      const detected = await window.gameVault.autoDetectEmulators();
      await loadEmulators();
      if (detected.length > 0) {
        setFeedbackMessage(`Auto-detected ${detected.length} emulator(s) successfully!`);
      } else {
        setFeedbackMessage('No new emulators detected in standard directories. You can browse manually.');
      }
    } catch (err: any) {
      setFeedbackMessage(`Error detecting emulators: ${err.message || err}`);
    } finally {
      setIsDetecting(false);
      setTimeout(() => setFeedbackMessage(null), 5000);
    }
  };

  const handleBrowseForEmulator = async (tpl: typeof DEFAULT_EMULATOR_TEMPLATES[0]) => {
    if (!window.gameVault) return;
    try {
      const res = await window.gameVault.browseEmulatorExecutable(`Select ${tpl.name} Executable`);
      if (res && !res.canceled && res.filePath) {
        const existing = emulators.find((e) => e.id === tpl.id || e.adapterType === tpl.adapterType);
        const updated: Emulator = {
          id: existing?.id || tpl.id,
          name: tpl.name,
          adapterType: tpl.adapterType as any,
          executablePath: res.filePath,
          supportedPlatforms: tpl.platforms as any,
          detected: false,
          enabled: true,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await window.gameVault.upsertEmulator(updated);
        await loadEmulators();
        setFeedbackMessage(`Configured ${tpl.name} -> ${res.filePath}`);
        setTimeout(() => setFeedbackMessage(null), 4000);
      }
    } catch (err: any) {
      setFeedbackMessage(`Failed to set executable: ${err.message || err}`);
    }
  };

>>>>>>> Stashed changes
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800 }}>⚙ System & Application Settings</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          Configure Game Vault engine preferences, cache paths, and runtime parameters.
        </p>
      </div>

<<<<<<< Updated upstream
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
        {/* Foundation Status Card */}
=======
      {/* Settings Section Switcher */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px', marginBottom: '24px' }}>
        <button
          onClick={() => setCurrentSection('integrations')}
          style={{
            padding: '8px 18px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            border: currentSection === 'integrations' ? '1px solid var(--accent-blue, #3b82f6)' : '1px solid transparent',
            background: currentSection === 'integrations' ? 'rgba(59, 130, 246, 0.18)' : 'rgba(255, 255, 255, 0.03)',
            color: currentSection === 'integrations' ? '#60a5fa' : 'var(--text-secondary, #94a3b8)',
            transition: 'all 0.15s ease'
          }}
        >
          🔌 Connected Services & Integrations
        </button>
        <button
          onClick={() => {
            setCurrentSection('metadata');
            loadMetadataSettings();
          }}
          style={{
            padding: '8px 18px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            border: currentSection === 'metadata' ? '1px solid var(--accent-blue, #3b82f6)' : '1px solid transparent',
            background: currentSection === 'metadata' ? 'rgba(59, 130, 246, 0.18)' : 'rgba(255, 255, 255, 0.03)',
            color: currentSection === 'metadata' ? '#60a5fa' : 'var(--text-secondary, #94a3b8)',
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>🎨 Metadata & Artwork</span>
          {reviewQueueCount > 0 && (
            <span
              style={{
                backgroundColor: '#f59e0b',
                color: '#000',
                padding: '2px 6px',
                borderRadius: '10px',
                fontSize: '11px',
                fontWeight: 800
              }}
            >
              {reviewQueueCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setCurrentSection('system')}
          style={{
            padding: '8px 18px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            border: currentSection === 'system' ? '1px solid var(--accent-blue, #3b82f6)' : '1px solid transparent',
            background: currentSection === 'system' ? 'rgba(59, 130, 246, 0.18)' : 'rgba(255, 255, 255, 0.03)',
            color: currentSection === 'system' ? '#60a5fa' : 'var(--text-secondary, #94a3b8)',
            transition: 'all 0.15s ease'
          }}
        >
          ⚙ System & Engines
        </button>
      </div>

      {currentSection === 'integrations' ? (
        <IntegrationsHubView />
      ) : currentSection === 'metadata' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', maxWidth: '840px' }}>
          {/* Metadata Review Queue Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-md)',
              border: reviewQueueCount > 0 ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid var(--border-color)',
              padding: '24px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>⚖️</span>
                <div>
                  <h3 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
                    Match Review Queue
                  </h3>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Resolve ambiguous titles and confirm candidate matches safely
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '13px', color: reviewQueueCount > 0 ? '#fbbf24' : '#10b981', fontWeight: 600 }}>
                  {reviewQueueCount > 0 ? `${reviewQueueCount} games pending review` : 'All matches confirmed'}
                </span>
                <button
                  onClick={() => setIsReviewModalOpen(true)}
                  className="btn btn-primary"
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: 600,
                    backgroundColor: reviewQueueCount > 0 ? '#f59e0b' : '#3b82f6',
                    color: reviewQueueCount > 0 ? '#000' : '#fff'
                  }}
                >
                  Open Review Queue
                </button>
              </div>
            </div>
          </div>

          {/* Preferences Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              padding: '24px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
              <span style={{ fontSize: '24px' }}>⚙️</span>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
                  Pipeline Preferences
                </h3>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Prioritization rules, default languages, and regional mappings
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                  Preferred Provider
                </label>
                <select
                  value={preferredProvider}
                  onChange={(e) => handleUpdateProvider(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: '#1e293b',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontSize: '13px'
                  }}
                >
                  <option value="screenscraper">ScreenScraper (Recommended for ROMs)</option>
                  <option value="igdb">IGDB (Twitch / Multiplatform)</option>
                  <option value="steam">Steam Storefront (PC Games)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                  Preferred Region
                </label>
                <select
                  value={preferredRegion}
                  onChange={(e) => handleUpdateRegion(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: '#1e293b',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontSize: '13px'
                  }}
                >
                  <option value="NA">North America (USA / NTSC-U)</option>
                  <option value="EU">Europe (PAL / Multi5)</option>
                  <option value="JP">Japan (NTSC-J)</option>
                  <option value="WORLD">World / Global</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                  Preferred Language
                </label>
                <select
                  value={preferredLanguage}
                  onChange={(e) => handleUpdateLanguage(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: '#1e293b',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontSize: '13px'
                  }}
                >
                  <option value="en">English (en)</option>
                  <option value="pt-BR">Português - Brasil (pt-BR)</option>
                  <option value="es">Español (es)</option>
                  <option value="fr">Français (fr)</option>
                  <option value="de">Deutsch (de)</option>
                  <option value="ja">Japanese (ja)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Artwork Cache & Storage Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              padding: '24px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>🖼</span>
                <div>
                  <h3 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
                    Artwork Cache & Disk Storage
                  </h3>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Local offline media storage with automatic alpha channel preservation
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={handleBatchRefreshMetadata}
                  disabled={isBatchRefreshing}
                  className="btn btn-secondary"
                  style={{ padding: '8px 14px', fontSize: '12px' }}
                >
                  {isBatchRefreshing ? '⏳ Refreshing...' : '🔄 Refresh All Games'}
                </button>
                <button
                  onClick={handleClearArtworkCache}
                  disabled={isClearingCache}
                  className="btn btn-secondary"
                  style={{ padding: '8px 14px', fontSize: '12px', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                >
                  {isClearingCache ? 'Purging...' : 'Purge Artwork Cache'}
                </button>
              </div>
            </div>

            {artworkStats ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
                <div style={{ padding: '12px', background: '#1e293b', borderRadius: '8px', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Total Size</span>
                  <strong style={{ fontSize: '16px', color: '#fff' }}>{formatBytes(artworkStats.totalSizeBytes || 0)}</strong>
                </div>
                <div style={{ padding: '12px', background: '#1e293b', borderRadius: '8px', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Total Files</span>
                  <strong style={{ fontSize: '16px', color: '#fff' }}>{artworkStats.totalFiles || 0}</strong>
                </div>
                <div style={{ padding: '12px', background: '#1e293b', borderRadius: '8px', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Covers</span>
                  <strong style={{ fontSize: '16px', color: '#60a5fa' }}>{artworkStats.coversCount || 0}</strong>
                </div>
                <div style={{ padding: '12px', background: '#1e293b', borderRadius: '8px', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Logos / Wheels</span>
                  <strong style={{ fontSize: '16px', color: '#a78bfa' }}>{artworkStats.logosCount || 0}</strong>
                </div>
                <div style={{ padding: '12px', background: '#1e293b', borderRadius: '8px', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Backgrounds</span>
                  <strong style={{ fontSize: '16px', color: '#34d399' }}>{artworkStats.bannersCount || 0}</strong>
                </div>
                <div style={{ padding: '12px', background: '#1e293b', borderRadius: '8px', textAlign: 'center' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block' }}>Screenshots</span>
                  <strong style={{ fontSize: '16px', color: '#f59e0b' }}>{artworkStats.screenshotsCount || 0}</strong>
                </div>
              </div>
            ) : (
              <div style={{ color: '#64748b', fontSize: '13px' }}>Loading artwork cache stats...</div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px', maxWidth: '840px' }}>
        {/* Emulators & Launchers Subsystem (Phase 4A) */}
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
=======
      )}

      {/* Metadata Review Queue Modal */}
      <MetadataReviewModal
        isOpen={isReviewModalOpen}
        onClose={() => {
          setIsReviewModalOpen(false);
          loadMetadataSettings();
        }}
        onReviewResolved={loadMetadataSettings}
      />
>>>>>>> Stashed changes
    </div>
  );
};
