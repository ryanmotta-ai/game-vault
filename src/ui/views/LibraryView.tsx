import React, { useState, useMemo } from 'react';
import { DownloadProgressEvent, Game, GameState } from '../../core/types';
import { GameCard } from '../components/GameCard';

interface LibraryViewProps {
  games: Game[];
  searchQuery: string;
  onGameAction: (game: Game) => void;
  downloadProgressMap?: Record<string, DownloadProgressEvent>;
  preparationProgressMap?: Record<string, { step?: string; progressPercentage?: number }>;
  runningGames?: Set<string>;
  onCardClick?: (game: Game) => void;
  onPauseDownload?: (downloadId: string) => void;
  onResumeDownload?: (downloadId: string) => void;
  onCancelDownload?: (downloadId: string) => void;
  onRemoveLocalCopy?: (gameId: string) => void;
  onTogglePinned?: (gameId: string, pinned: boolean) => void;
}

type SortOption = 'title-asc' | 'title-desc' | 'size-desc' | 'size-asc';

export const LibraryView: React.FC<LibraryViewProps> = ({
  games,
  searchQuery,
  onGameAction,
  downloadProgressMap,
  preparationProgressMap,
  runningGames,
  onCardClick,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
  onRemoveLocalCopy,
  onTogglePinned
}) => {
  const [filterState, setFilterState] = useState<GameState | 'ALL'>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('title-asc');

  const readyCount = games.filter((g) => g.state === 'READY').length;
  const downloadingCount = games.filter((g) => g.state === 'DOWNLOADING').length;
  const preparingCount = games.filter((g) => g.state === 'PREPARING').length;
  const cloudCount = games.filter((g) => g.state === 'CLOUD').length;

  const filteredGames = useMemo(() => {
    return games
      .filter((game) => {
        const matchesSearch =
          game.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          game.platform.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (game.developer && game.developer.toLowerCase().includes(searchQuery.toLowerCase()));

        const matchesState = filterState === 'ALL' || game.state === filterState;
        return matchesSearch && matchesState;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'title-asc':
            return a.title.localeCompare(b.title);
          case 'title-desc':
            return b.title.localeCompare(a.title);
          case 'size-desc':
            return b.sizeBytes - a.sizeBytes;
          case 'size-asc':
            return a.sizeBytes - b.sizeBytes;
          default:
            return 0;
        }
      });
  }, [games, searchQuery, filterState, sortBy]);

  return (
    <div>
      {/* Header / Filter Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '16px'
        }}
      >
        <div>
          <h2
            style={{
              fontSize: '26px',
              fontWeight: 900,
              letterSpacing: '-0.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <span>🎮</span>
            <span>Game Library</span>
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Showing {filteredGames.length} of {games.length} titles synchronized from connected cloud storage
          </p>
        </div>

        {/* Right Toolbar: Filters + Sort */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Filter Chips */}
          <div
            style={{
              display: 'flex',
              gap: '4px',
              background: 'var(--bg-surface)',
              padding: '4px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-color)'
            }}
          >
            {(
              [
                { id: 'ALL', label: 'All', count: games.length },
                { id: 'READY', label: 'Ready', count: readyCount },
                ...(preparingCount > 0 ? [{ id: 'PREPARING', label: 'Preparing', count: preparingCount }] : []),
                { id: 'DOWNLOADING', label: 'Downloading', count: downloadingCount },
                { id: 'CLOUD', label: 'Cloud', count: cloudCount }
              ] as Array<{ id: GameState | 'ALL'; label: string; count: number }>
            ).map((tab) => {
              const isActive = filterState === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setFilterState(tab.id)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-full)',
                    border: 'none',
                    background: isActive ? 'var(--accent-blue)' : 'transparent',
                    color: isActive ? '#ffffff' : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: isActive ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: isActive ? '0 2px 10px rgba(59, 130, 246, 0.4)' : 'none'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  <span>{tab.label}</span>
                  <span
                    style={{
                      fontSize: '10px',
                      background: isActive ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-full)',
                      fontWeight: 700
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sort Dropdown */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--bg-surface)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-color)',
              fontSize: '12px',
              color: 'var(--text-secondary)'
            }}
          >
            <span>⇅</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: '12px',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="title-asc" style={{ background: 'var(--bg-surface)', color: '#ffffff' }}>
                Title (A-Z)
              </option>
              <option value="title-desc" style={{ background: 'var(--bg-surface)', color: '#ffffff' }}>
                Title (Z-A)
              </option>
              <option value="size-desc" style={{ background: 'var(--bg-surface)', color: '#ffffff' }}>
                Size (Largest)
              </option>
              <option value="size-asc" style={{ background: 'var(--bg-surface)', color: '#ffffff' }}>
                Size (Smallest)
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid */}
      {filteredGames.length > 0 ? (
        <div className="games-grid">
          {filteredGames.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              onAction={onGameAction}
              downloadProgress={downloadProgressMap?.[game.id]}
              preparationProgress={preparationProgressMap?.[game.id]}
              isRunning={runningGames?.has(game.id)}
              onCardClick={onCardClick}
              onPauseDownload={onPauseDownload}
              onResumeDownload={onResumeDownload}
              onCancelDownload={onCancelDownload}
              onRemoveLocalCopy={onRemoveLocalCopy}
              onTogglePinned={onTogglePinned}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: '80px 20px',
            textAlign: 'center',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            marginTop: '20px',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <p style={{ fontSize: '42px', marginBottom: '14px', filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.4))' }}>
            🔍
          </p>
          <h3 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '8px', color: 'var(--text-primary)' }}>
            No games found
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '420px', margin: '0 auto 16px auto' }}>
            {searchQuery
              ? `No games in your vault match the query "${searchQuery}".`
              : `No games currently found in the '${filterState}' filter category.`}
          </p>
          {(searchQuery || filterState !== 'ALL') && (
            <button
              onClick={() => {
                setFilterState('ALL');
              }}
              className="btn btn-secondary"
            >
              Reset Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
};
