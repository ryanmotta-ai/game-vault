import { GameVaultAPI } from '../../desktop/preload';

declare global {
  interface Window {
    gameVault?: GameVaultAPI;
  }
}

export {};
