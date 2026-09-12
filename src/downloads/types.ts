import { DownloadStatus } from '../core/types';

export interface DownloadTaskRequest {
  gameId: string;
  gameFileId?: string;
  storageAccountId: string;
  destinationPath?: string;
}

export interface DownloadProgressEvent {
  downloadId: string;
  bytesTransferred: number;
  totalBytes: number;
  speedBps: number;
  percentage: number;
  status: DownloadStatus;
}
