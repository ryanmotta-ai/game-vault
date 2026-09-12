import React from 'react';
import { Game } from '../../core/types';
import { GameCard } from '../components/GameCard';

interface InstalledViewProps {
  games: Game[];
  searchQuery: string;
  onGameAction: (game: Game) => void;
}

export const InstalledView: React.FC<InstalledViewProps> = ({ games, searchQuery, onGameAction }) => {
  const installedGames = games.filter(
    (g) =>
      g.state === 'READY' &&
      (g.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.platform.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 800 }}>⚡ Installed & Ready to Play</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {installedGames.length} games cached locally on your machine and ready to launch instantly.
        </p>
      </div>

      {installedGames.length > 0 ? (
        <div className="games-grid">
          {installedGames.map((game) => (
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
          <p style={{ fontSize: '32px', marginBottom: '10px' }}>📦</p>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>No games installed yet</h3>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Switch to the Library tab and click "Download" on any cloud game to transfer it to local cache.
          </p>
        </div>
      )}
    </div>
  );
};
