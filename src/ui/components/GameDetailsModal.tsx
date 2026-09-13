import React, { useState, useEffect } from 'react';
import { Game, LaunchProfile, Emulator, PlaybackMode } from '../../core/types';

interface GameDetailsModalProps {
  game: Game | null;
  isRunning?: boolean;
  onClose: () => void;
  onLaunch: (game: Game) => void;
  onStop?: (game: Game) => void;
  onOpenSettings?: () => void;
}

export const GameDetailsModal: React.FC<GameDetailsModalProps> = ({
  game,
  isRunning = false,
  onClose,
  onLaunch,
  onStop,
  onOpenSettings
}) => {
  const [currentGame, setCurrentGame] = useState<Game | null>(game);
  const [_profile, setProfile] = useState<LaunchProfile | null>(null);
  const [emulator, setEmulator] = useState<Emulator | null>(null);
  const [canLaunch, setCanLaunch] = useState<boolean>(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState<boolean>(true);
  const [customArgs, setCustomArgs] = useState<string>('');
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('auto');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [isScraping, setIsScraping] = useState<boolean>(false);
  const [scrapeSuccess, setScrapeSuccess] = useState<boolean>(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);

  useEffect(() => {
    setCurrentGame(game);
  }, [game]);

  useEffect(() => {
    if (!currentGame || !window.gameVault) return;

    window.gameVault
      .getLaunchProfile(currentGame.id)
      .then((res: any) => {
        if (res && res.profile) {
          setProfile(res.profile);
          setFullscreen(res.profile.fullscreen !== false);
          setCustomArgs(res.profile.argumentsTemplate || '');
          setPlaybackMode(res.profile.playbackMode || 'auto');
        }
        if (res && res.emulator) {
          setEmulator(res.emulator);
        }
        setCanLaunch(res.canLaunch !== false);
        setValidationError(res.validationError || null);
      })
      .catch((err: any) => {
        console.error('Failed to load launch profile:', err);
      });
  }, [currentGame]);

  if (!currentGame) return null;

  const isInstantEligible =
    currentGame.state === 'CLOUD' &&
    currentGame.sizeBytes > 0 &&
    currentGame.sizeBytes <= 128 * 1024 * 1024 &&
    [
      'NES',
      'SNES',
      'Game Boy',
      'Game Boy Color',
      'Game Boy Advance',
      'Nintendo 64',
      'Nintendo DS',
      'Retro'
    ].includes(currentGame.platform);

  const formatPlayTime = (seconds: number): string => {
    if (!seconds || seconds <= 0) return 'Never played';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  const formatLastPlayed = (isoString?: string): string => {
    if (!isoString) return 'Never';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 3600 * 24));
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      return date.toLocaleDateString();
    } catch {
      return isoString;
    }
  };

  const handleSaveProfile = async () => {
    if (!window.gameVault || !currentGame) return;
    setIsSaving(true);
    try {
      await window.gameVault.saveLaunchProfile({
        gameId: currentGame.id,
        fullscreen,
        argumentsTemplate: customArgs.trim() || undefined,
        playbackMode
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to save profile:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleScrapeMetadata = async () => {
    if (!window.gameVault || !currentGame || isScraping) return;
    setIsScraping(true);
    try {
      const updated = await window.gameVault.scrapeGameMetadata(currentGame.id);
      if (updated && !updated.error) {
        setCurrentGame(updated);
        setScrapeSuccess(true);
        setTimeout(() => setScrapeSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Failed to scrape metadata:', err);
    } finally {
      setIsScraping(false);
    }
  };

  const handleCustomCover = async () => {
    if (!window.gameVault || !currentGame) return;
    try {
      const filePath = await window.gameVault.browseArtworkFile();
      if (!filePath) return;
      const res = await window.gameVault.saveCustomArtwork(currentGame.id, 'COVER_FRONT', filePath);
      if (res && res.success) {
        const updated = await window.gameVault.getGameById(currentGame.id);
        if (updated) {
          setCurrentGame({
            ...updated,
            localCoverPath: res.path
          });
        }
      }
    } catch (err) {
      console.error('Failed to set custom cover:', err);
    }
  };

  // Resolve banner / cover with offline local priority
  const bannerImage = currentGame.localBannerPath
    ? `local-artwork://${encodeURIComponent(currentGame.localBannerPath.replace(/\\/g, '/'))}`
    : currentGame.bannerUrl ||
      (currentGame.localCoverPath
        ? `local-artwork://${encodeURIComponent(currentGame.localCoverPath.replace(/\\/g, '/'))}`
        : currentGame.coverUrl);

  // Prepare screenshots list (local files prioritized over remote)
  const screenshots: string[] = [];
  if (currentGame.localScreenshotPaths && currentGame.localScreenshotPaths.length > 0) {
    for (const p of currentGame.localScreenshotPaths) {
      screenshots.push(`local-artwork://${encodeURIComponent(p.replace(/\\/g, '/'))}`);
    }
  } else if (currentGame.screenshotUrls && currentGame.screenshotUrls.length > 0) {
    screenshots.push(...currentGame.screenshotUrls);
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '740px',
          maxHeight: '90vh',
          backgroundColor: 'var(--bg-card, #18202f)',
          borderRadius: 'var(--radius-lg, 14px)',
          border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Artwork / Banner */}
        <div
          style={{
            position: 'relative',
            height: '210px',
            backgroundColor: '#0f172a',
            backgroundImage: bannerImage ? `url("${bannerImage}")` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            display: 'flex',
            alignItems: 'flex-end',
            padding: '24px',
            flexShrink: 0
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to top, rgba(24, 32, 47, 1) 0%, rgba(24, 32, 47, 0.5) 70%, rgba(24, 32, 47, 0.2) 100%)'
            }}
          />

          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '14px',
              right: '14px',
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2
            }}
            title="Close"
          >
            ✕
          </button>

          <div style={{ position: 'relative', zIndex: 1, width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: 'var(--accent-blue, #60a5fa)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}
              >
                {currentGame.platform}
              </span>
              {currentGame.releaseYear && (
                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>
                  • {currentGame.releaseYear}
                </span>
              )}
              {currentGame.rating !== undefined && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    color: '#fbbf24',
                    background: 'rgba(234, 179, 8, 0.2)',
                    border: '1px solid rgba(234, 179, 8, 0.4)',
                    padding: '1px 8px',
                    borderRadius: '12px'
                  }}
                >
                  ★ {currentGame.rating.toFixed(1)} / 10
                </span>
              )}
              {currentGame.metadataSource && (
                <span
                  style={{
                    fontSize: '10px',
                    color: '#cbd5e1',
                    background: 'rgba(255, 255, 255, 0.1)',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    marginLeft: 'auto'
                  }}
                  title={`Enriched via ${currentGame.metadataSource}`}
                >
                  Source: {currentGame.metadataSource}
                </span>
              )}
            </div>

            <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#fff', margin: 0, lineHeight: 1.2 }}>
              {currentGame.title}
            </h2>

            {(currentGame.developer || currentGame.publisher) && (
              <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)', marginTop: '4px', display: 'block' }}>
                {[currentGame.developer, currentGame.publisher].filter(Boolean).join(' • ')}
              </span>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Main Action Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}
          >
            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
                Status
              </span>
              <strong
                style={{
                  fontSize: '15px',
                  color: isRunning
                    ? '#10b981'
                    : currentGame.state === 'READY'
                    ? '#38bdf8'
                    : '#94a3b8'
                }}
              >
                {isRunning ? '● Playing Now' : currentGame.state}
              </strong>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {/* Refresh Metadata Button */}
              <button
                onClick={handleScrapeMetadata}
                disabled={isScraping}
                className="btn btn-secondary"
                style={{
                  padding: '8px 14px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="Refresh metadata, artwork, and synopsis from connected scrapers"
              >
                {isScraping ? '⏳ Scraping...' : scrapeSuccess ? '✓ Updated!' : '🔍 Refresh Metadata'}
              </button>

              {/* Custom Cover Button */}
              <button
                onClick={handleCustomCover}
                className="btn btn-secondary"
                style={{
                  padding: '8px 14px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="Set a local custom image for this game's cover"
              >
                🖼 Custom Cover
              </button>

              {isRunning ? (
                onStop && (
                  <button
                    onClick={() => onStop(currentGame)}
                    className="btn btn-secondary"
                    style={{ padding: '10px 20px', fontSize: '14px', backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}
                  >
                    ⏹ Stop Session
                  </button>
                )
              ) : currentGame.state === 'READY' ? (
                canLaunch ? (
                  <button
                    onClick={() => onLaunch(currentGame)}
                    className="btn btn-primary"
                    style={{
                      padding: '10px 24px',
                      fontSize: '15px',
                      fontWeight: 800,
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      boxShadow: '0 0 15px rgba(16, 185, 129, 0.4)'
                    }}
                  >
                    ▶ PLAY NOW
                  </button>
                ) : (
                  <button
                    onClick={onOpenSettings}
                    className="btn btn-secondary"
                    style={{ padding: '10px 18px', fontSize: '13px', borderColor: '#f59e0b', color: '#fbbf24' }}
                    title={validationError || 'Emulator required'}
                  >
                    ⚙ Setup {currentGame.platform === 'PC' ? 'Launcher' : 'Emulator'}
                  </button>
                )
              ) : isInstantEligible ? (
                <button
                  onClick={() => onLaunch(currentGame)}
                  className="btn btn-primary"
                  style={{
                    padding: '10px 24px',
                    fontSize: '15px',
                    fontWeight: 800,
                    background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)',
                    boxShadow: '0 0 15px rgba(124, 58, 237, 0.4)'
                  }}
                  title="Instant Play: hydrates small ROM and launches emulator immediately"
                >
                  ⚡ INSTANT PLAY
                </button>
              ) : (
                <button
                  onClick={() => onLaunch(currentGame)}
                  className="btn btn-primary"
                  style={{ padding: '10px 20px', fontSize: '14px' }}
                >
                  ☁ Download
                </button>
              )}
            </div>
          </div>

          {/* Validation Error Banner */}
          {validationError && (
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#fbbf24',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span>⚠️</span>
              <span>{validationError}</span>
            </div>
          )}

          {/* Synopsis & Genres Section */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            {currentGame.genres && currentGame.genres.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {currentGame.genres.map((g) => (
                  <span
                    key={g}
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: '#93c5fd',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      padding: '3px 10px',
                      borderRadius: '12px'
                    }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              📖 Synopsis & Details
            </h4>
            <p
              style={{
                fontSize: '13px',
                lineHeight: '1.6',
                color: '#cbd5e1',
                margin: 0,
                whiteSpace: 'pre-wrap',
                maxHeight: '140px',
                overflowY: 'auto'
              }}
            >
              {currentGame.description ||
                'No synopsis available. Click "Refresh Metadata" above to scrape synopsis, tags, and box art.'}
            </p>
          </div>

          {/* Screenshot Gallery Viewer (if available) */}
          {screenshots.length > 0 && (
            <div
              style={{
                padding: '16px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              <h4 style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                📸 Screenshot Gallery
              </h4>

              {selectedScreenshot && (
                <div
                  style={{
                    width: '100%',
                    height: '240px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    backgroundColor: '#000',
                    backgroundImage: `url("${selectedScreenshot}")`,
                    backgroundSize: 'contain',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    border: '1px solid rgba(255, 255, 255, 0.15)'
                  }}
                />
              )}

              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                {screenshots.map((s, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedScreenshot(selectedScreenshot === s ? null : s)}
                    style={{
                      width: '100px',
                      height: '60px',
                      flexShrink: 0,
                      borderRadius: '6px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      border: selectedScreenshot === s ? '2px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                      backgroundImage: `url("${s}")`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      opacity: selectedScreenshot === s ? 1 : 0.75,
                      transition: 'all 0.15s ease'
                    }}
                    title="Click to preview screenshot"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            <div
              style={{
                padding: '14px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.05)'
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
                Time Played
              </span>
              <strong style={{ fontSize: '16px', color: '#f8fafc', marginTop: '4px', display: 'block' }}>
                {formatPlayTime(currentGame.playTimeSeconds)}
              </strong>
            </div>

            <div
              style={{
                padding: '14px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.05)'
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
                Last Played
              </span>
              <strong style={{ fontSize: '16px', color: '#f8fafc', marginTop: '4px', display: 'block' }}>
                {formatLastPlayed(currentGame.lastPlayedAt)}
              </strong>
            </div>

            <div
              style={{
                padding: '14px',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.05)'
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', display: 'block' }}>
                Active Launcher
              </span>
              <strong style={{ fontSize: '15px', color: '#60a5fa', marginTop: '4px', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {emulator?.name || (currentGame.platform === 'PC' ? 'Native PC' : 'Not Configured')}
              </strong>
            </div>
          </div>

          {/* Launch Options Section */}
          <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}
          >
            <h4 style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#e2e8f0' }}>
              ⚙️ Launch Options & Settings
            </h4>

            {/* Fullscreen Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9', display: 'block' }}>
                  Launch in Fullscreen
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)' }}>
                  Passes fullscreen CLI argument to the emulator on launch
                </span>
              </div>
              <input
                type="checkbox"
                checked={fullscreen}
                onChange={(e) => setFullscreen(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </div>

            {/* Playback Strategy Mode */}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#f1f5f9', display: 'block', marginBottom: '6px' }}>
                Playback Strategy
              </label>
              <select
                value={playbackMode}
                onChange={(e) => setPlaybackMode(e.target.value as PlaybackMode)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px'
                }}
              >
                <option value="auto" style={{ background: '#1e293b' }}>Auto (Recommended - Instant Hydration for retro)</option>
                <option value="always_local" style={{ background: '#1e293b' }}>Always Local (Full download required)</option>
                <option value="experimental_streaming" style={{ background: '#1e293b' }}>Experimental Streaming (Progressive ROM streaming)</option>
              </select>
              <span style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', marginTop: '4px', display: 'block' }}>
                Determines whether this game hydrates small ROMs instantly or requires full download prior to launch.
              </span>
            </div>

            {/* Custom Arguments Input */}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#f1f5f9', display: 'block', marginBottom: '6px' }}>
                Custom Launch Arguments (Optional)
              </label>
              <input
                type="text"
                value={customArgs}
                onChange={(e) => setCustomArgs(e.target.value)}
                placeholder="e.g. -fastboot --nogui"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={handleSaveProfile}
                disabled={isSaving}
                className="btn btn-secondary"
                style={{ fontSize: '12px', padding: '6px 14px' }}
              >
                {saveSuccess ? '✓ Saved!' : isSaving ? 'Saving...' : 'Save Options'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
