import { StorageProviderType } from '../core/types';
import {
  AuthCredentials,
  AuthResult,
  DownloadProgress,
  DownloadResult,
  FileMetadata,
  RemoteFile,
  StorageQuota,
  ListFilesOptions,
  PaginatedFilesResult,
  ChangeListResult
} from './types';

export interface StorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: StorageProviderType;

  /**
   * Authenticates against the remote storage provider.
   * In future phases, handles OAuth2 code exchange and token refresh.
   */
  authenticate(credentials?: AuthCredentials): Promise<AuthResult>;

  /**
   * Cleans up sessions and disconnects the account.
   */
  disconnect(): Promise<void>;

  /**
   * Returns whether the provider currently has a valid active session.
   */
  isConnected(): Promise<boolean>;

  /**
   * Retrieves profile information for the connected account.
   */
  getAccountInfo?(): Promise<{ email?: string; name?: string; picture?: string }>;

  /**
   * Lists files located in a folder, or from the root folder if not specified.
   */
  listFiles(folderId?: string, options?: ListFilesOptions): Promise<RemoteFile[]>;

  /**
   * Retrieves single page of remote files.
   */
  listPaginatedFiles?(folderId?: string, options?: ListFilesOptions): Promise<PaginatedFilesResult>;

  /**
   * Gets initial page token for Google Drive / Storage Changes API.
   */
  getStartPageToken?(): Promise<string>;

  /**
   * Queries changes since a given page token for delta synchronization.
   */
  listChanges?(pageToken: string): Promise<ChangeListResult>;

  /**
   * Retrieves single remote file descriptor by ID.
   */
  getFile(fileId: string): Promise<RemoteFile>;

  /**
   * Downloads remote file to local destination path with progress notifications.
   */
  download(
    fileId: string,
    destinationPath: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<DownloadResult>;

  /**
   * Retrieves extended metadata for a remote file.
   */
  getMetadata(fileId: string): Promise<FileMetadata>;

  /**
   * Queries the user's storage quota (total, used, free bytes).
   */
  getQuota(): Promise<StorageQuota>;
}
