import React from 'react';
import { GameState } from '../../core/types';

interface StatusBadgeProps {
  state: GameState;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ state }) => {
  switch (state) {
    case 'CLOUD':
      return <span className="badge badge-cloud">☁ CLOUD</span>;
    case 'DOWNLOADING':
      return <span className="badge badge-downloading">↓ DOWNLOADING</span>;
    case 'READY':
      return <span className="badge badge-ready">⚡ READY</span>;
    default:
      return null;
  }
};
