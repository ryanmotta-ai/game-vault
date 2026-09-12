import { StorageProviderType } from '../core/types';

export interface RemoteFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  md5Checksum?: string;
  modifiedTime?: string;
  isFolder: boolean;
  parentFolderId?: string;
  path?: string;
}

export interface StorageQuota {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

export interface DownloadProgress {
  fileId: string;
  bytesTransferred: number;
  totalBytes: number;
  speedBps: number;
  percentage: number;
}

export interface DownloadResult {
  destinationPath: string;
  bytesWritten: number;
  md5Checksum?: string;
  durationMs: number;
}

export interface FileMetadata {
  fileId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  md5Checksum?: string;
  createdTime?: string;
  modifiedTime?: string;
  properties?: Record<string, string>;
}

export interface AuthCredentials {
  authCode?: string;
  redirectUri?: string;
  clientId?: string;
  tokenRef?: string;
  customParams?: Record<string, string>;
}

export interface AuthResult {
  success: boolean;
  accountId?: string;
  accountEmail?: string;
  accountName?: string;
  expiresAt?: string;
  error?: string;
}

export interface StorageProviderConfig {
  accountId: string;
  accountName: string;
  providerType?: StorageProviderType;
  accountEmail?: string;
  tokenRef?: string;
}
