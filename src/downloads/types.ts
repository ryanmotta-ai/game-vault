import { DownloadProgressEvent, DownloadStateChangedEvent } from '../core/types';

export interface DownloadTaskRequest {
  gameId: string;
  gameFileId?: string;
  storageAccountId?: string;
  destinationPath?: string;
}

export type { DownloadProgressEvent, DownloadStateChangedEvent };
