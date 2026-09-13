import React from 'react';
import { GameState } from '../../core/types';

interface StatusBadgeProps {
  state: GameState;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ state }) => {
  switch (state) {
    case 'CLOUD':
      return (
        <span
          className="badge badge-cloud"
          style={{
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            fontSize: '10px',
            padding: '3px 8px'
          }}
        >
          <span>☁</span>
          <span>CLOUD</span>
        </span>
      );
    case 'DOWNLOADING':
      return (
        <span
          className="badge badge-downloading"
          style={{
            boxShadow: '0 0 12px rgba(245, 158, 11, 0.35)',
            fontSize: '10px',
            padding: '3px 8px',
            animation: 'pulseGlow 2s infinite ease-in-out'
          }}
        >
          <span style={{ display: 'inline-block', animation: 'spin 2s linear infinite' }}>↓</span>
          <span>DOWNLOADING</span>
        </span>
      );
    case 'READY':
      return (
        <span
          className="badge badge-ready"
          style={{
            boxShadow: '0 0 10px rgba(16, 185, 129, 0.35)',
            fontSize: '10px',
            padding: '3px 8px'
          }}
        >
          <span>⚡</span>
          <span>READY</span>
        </span>
      );
    case 'PREPARING':
      return (
        <span
          className="badge badge-downloading"
          style={{
            boxShadow: '0 0 12px rgba(168, 85, 247, 0.35)',
            fontSize: '10px',
            padding: '3px 8px',
            background: 'rgba(168, 85, 247, 0.15)',
            color: '#c084fc',
            border: '1px solid rgba(168, 85, 247, 0.4)'
          }}
        >
          <span style={{ display: 'inline-block', animation: 'spin 2s linear infinite' }}>⚙</span>
          <span>PREPARING</span>
        </span>
      );
    case 'QUEUED':
      return (
        <span
          className="badge badge-cloud"
          style={{
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            fontSize: '10px',
            padding: '3px 8px'
          }}
        >
          <span>⏳</span>
          <span>QUEUED</span>
        </span>
      );
    case 'ERROR':
      return (
        <span
          className="badge"
          style={{
            boxShadow: '0 0 10px rgba(239, 68, 68, 0.35)',
            fontSize: '10px',
            padding: '3px 8px',
            background: 'rgba(239, 68, 68, 0.15)',
            color: '#f87171',
            border: '1px solid rgba(239, 68, 68, 0.4)'
          }}
        >
          <span>✕</span>
          <span>ERROR</span>
        </span>
      );
    default:
      return null;
  }
};
