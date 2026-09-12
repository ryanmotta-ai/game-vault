import React, { useState } from 'react';
import { Game, GameState } from '../../core/types';
import { GameCard } from '../components/GameCard';

interface LibraryViewProps {
  games: Game[];
  searchQuery: string;
  onGameAction: (game: Game) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ games, searchQuery, onGameAction }) => {
  const [filterState, setFilterState] = useState<GameState | 'ALL'>('ALL');

  const filteredGames = games.filter((game) => {
    const matchesSearch =
      game.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      game.platform.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (game.developer && game.developer.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesState = filterState === 'ALL' || game.state === filterState;

    return matchesSearch && matchesState;
  });

  return (
    <div>
      {/* Header / Filter Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800 }}>My Library</h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Showing {filteredGames.length} of {games.length} games connected from your personal cloud vault
          </p>
        </div>

        {/* Filter Chips */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['ALL', 'READY', 'DOWNLOADING', 'CLOUD'] as const).map((st) => {
            const isActive = filterState === st;
            return (
              <button
                key={st}
                onClick={() => setFilterState(st)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  border: '1px solid',
                  borderColor: isActive ? 'var(--accent-blue)' : 'var(--border-color)',
                  background: isActive ? 'var(--accent-blue)' : 'var(--bg-surface)',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {st === 'ALL' ? 'All Games' : st}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {filteredGames.length > 0 ? (
        <div className="games-grid">
          {filteredGames.map((game) => (
            <GameCard key={game.id} game={game} onAction={onGameAction} />
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: '60px 20px',
            textAlign: 'center',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            marginTop: '20px'
          }}
        >
          <p style={{ fontSize: '32px', marginBottom: '10px' }}>🔍</p>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>No games found</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {searchQuery
              ? `No games match the query "${searchQuery}".`
              : `No games currently found in '${filterState}' state.`}
          </p>
        </div>
      )}
    </div>
  );
};
