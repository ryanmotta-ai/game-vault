import path from 'node:path';
import os from 'node:os';

export interface AppConfig {
  appDataDir: string;
  cacheDir: string;
  databasePath: string;
  maxConcurrentDownloads: number;
  downloadSpeedLimitBps: number;
  autoExtractArchives: boolean;
  theme: 'dark' | 'light' | 'system';
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}

function getDefaultPaths() {
  const homeDir = os.homedir();
  let baseDir: string;

  if (process.platform === 'win32') {
    baseDir = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    baseDir = path.join(homeDir, 'Library', 'Application Support');
  } else {
    baseDir = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
  }

  const appDataDir = path.join(baseDir, 'GameVault');
  const cacheDir = path.join(appDataDir, 'cache');
  const databasePath = path.join(appDataDir, 'gamevault.sqlite');

  return { appDataDir, cacheDir, databasePath };
}

export class ConfigManager {
  private static instance: ConfigManager;
  private config: AppConfig;

  private constructor() {
    const defaults = getDefaultPaths();
    this.config = {
      appDataDir: defaults.appDataDir,
      cacheDir: defaults.cacheDir,
      databasePath: defaults.databasePath,
      maxConcurrentDownloads: 2,
      downloadSpeedLimitBps: 0,
      autoExtractArchives: true,
      theme: 'dark',
      logLevel: 'DEBUG'
    };
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public getConfig(): Readonly<AppConfig> {
    return { ...this.config };
  }

  public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  public update(partial: Partial<AppConfig>): void {
    this.config = {
      ...this.config,
      ...partial
    };
  }
}

export const configManager = ConfigManager.getInstance();
