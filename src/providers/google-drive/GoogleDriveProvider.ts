import { StorageProvider } from '../StorageProvider';
import {
  AuthCredentials,
  AuthResult,
  DownloadProgress,
  DownloadResult,
  FileMetadata,
  RemoteFile,
  StorageProviderConfig,
  StorageQuota
} from '../types';
import { StorageProviderType } from '../../core/types';
import { NotImplementedError } from '../../core/errors/AppError';
import { Logger } from '../../core/logger';

export class GoogleDriveProvider implements StorageProvider {
  public readonly id: string;
  public readonly name = 'Google Drive';
  public readonly type: StorageProviderType = 'google_drive';
  private logger: Logger;
  private connected = false;
  private accountEmail?: string;
  private tokenRef?: string;

  constructor(config?: Partial<StorageProviderConfig>) {
    this.id = config?.accountId || 'gdrive-default';
    this.accountEmail = config?.accountEmail;
    this.tokenRef = config?.tokenRef;
    this.logger = new Logger(`GoogleDriveProvider:${this.id}`);
  }

  public async authenticate(credentials?: AuthCredentials): Promise<AuthResult> {
    this.logger.info('Authenticating Google Drive provider account...');

    if (credentials?.tokenRef) {
      this.tokenRef = credentials.tokenRef;
      this.connected = true;
      return {
        success: true,
        accountId: this.id,
        accountEmail: this.accountEmail || 'user@gmail.com',
        accountName: 'Google Drive Account'
      };
    }

    // In Phase 2: Full OAuth2 loopback server & secure OS keychain storage
    return {
      success: false,
      error: 'OAuth2 loopback flow will be activated in Phase 2 (Authentication & Scanning).'
    };
  }

  public async disconnect(): Promise<void> {
    this.logger.info('Disconnecting Google Drive account session.');
    this.connected = false;
    this.tokenRef = undefined;
  }

  public async isConnected(): Promise<boolean> {
    return this.connected && Boolean(this.tokenRef);
  }

  public async listFiles(_folderId?: string): Promise<RemoteFile[]> {
    if (!this.connected) {
      this.logger.warn('Attempted to list files without active connection.');
    }
    // Architecture stub: in Phase 2 this executes authenticated Google Drive v3 files.list
    throw new NotImplementedError('GoogleDriveProvider.listFiles (Phase 2)');
  }

  public async getFile(_fileId: string): Promise<RemoteFile> {
    throw new NotImplementedError('GoogleDriveProvider.getFile (Phase 2)');
  }

  public async download(
    _fileId: string,
    _destinationPath: string,
    _onProgress?: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    // Architecture stub: in Phase 3 this executes resumable chunked downloads
    throw new NotImplementedError('GoogleDriveProvider.download (Phase 3)');
  }

  public async getMetadata(_fileId: string): Promise<FileMetadata> {
    throw new NotImplementedError('GoogleDriveProvider.getMetadata (Phase 2)');
  }

  public async getQuota(): Promise<StorageQuota> {
    // Mock/default quota placeholder for Foundation phase
    return {
      totalBytes: 15 * 1024 * 1024 * 1024, // 15 GB free tier
      usedBytes: 0,
      freeBytes: 15 * 1024 * 1024 * 1024
    };
  }
}
