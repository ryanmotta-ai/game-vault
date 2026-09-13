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
  trashed?: boolean;
}

export interface ListFilesOptions {
  pageToken?: string;
  pageSize?: number;
  query?: string;
}

export interface PaginatedFilesResult {
  files: RemoteFile[];
  nextPageToken?: string;
}

export interface RemoteChange {
  fileId: string;
  removed: boolean;
  file?: RemoteFile;
  time?: string;
}

export interface ChangeListResult {
  changes: RemoteChange[];
  newStartPageToken?: string;
  nextPageToken?: string;
}

export interface StorageQuota {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

export interface DownloadRequest {
  fileId: string;
  destinationPath: string;
  startByte?: number;
  expectedSize?: number;
  signal?: AbortSignal;
}

export interface DownloadProgress {
  fileId: string;
  bytesTransferred: number;
  totalBytes: number;
  speedBps: number;
  percentage: number;
  etaSeconds?: number;
}

export interface DownloadResult {
  destinationPath: string;
  bytesWritten: number;
  totalBytes?: number;
  startByte?: number;
  resumed?: boolean;
  durationMs: number;
  etag?: string;
  md5Checksum?: string;
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
  providerAccountId?: string;
  accountEmail?: string;
  credentialKey?: string;
  tokenRef?: string;
}
