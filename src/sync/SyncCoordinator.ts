import crypto from 'node:crypto';
import { StorageManager } from '../storage/StorageManager';
import { StorageProvider } from '../providers/StorageProvider';
import { CloudInventoryScanner, CancellationToken } from './CloudInventoryScanner';
import { CloudFilesRepository } from '../database/repositories/cloudFilesRepository';
import { SyncStateRepository } from '../database/repositories/syncStateRepository';
import { CatalogIngestionService } from '../catalog/CatalogIngestionService';
import { GameCandidateResolver } from '../catalog/GameCandidateResolver';
import { CloudChangeProcessor } from './CloudChangeProcessor';
import { CloudPathResolver } from './CloudPathResolver';
import { SyncProgress, SyncRun } from '../core/types';
import { SyncCancelledError, NotFoundError } from '../core/errors/AppError';
import { logger } from '../core/logger';

export class SyncCoordinator {
  private log = logger.child('SyncCoordinator');
  private activeTokens = new Map<string, CancellationToken>();
  private activeProgress = new Map<string, SyncProgress>();
  private listeners: Array<(progress: SyncProgress) => void> = [];

  constructor(
    private storageManager: StorageManager,
    private scanner: CloudInventoryScanner,
    private cloudFilesRepo: CloudFilesRepository,
    private syncStateRepo: SyncStateRepository,
    private catalogIngestion: CatalogIngestionService,
    private changeProcessor?: CloudChangeProcessor
  ) {
    if (!this.changeProcessor) {
      const pathResolver = new CloudPathResolver(this.cloudFilesRepo, this.catalogIngestion.gameFilesRepo);
      this.changeProcessor = new CloudChangeProcessor(
        this.cloudFilesRepo,
        this.catalogIngestion.gameFilesRepo,
        this.catalogIngestion,
        pathResolver
      );
    }
  }

  public onProgress(listener: (progress: SyncProgress) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emitProgress(progress: SyncProgress): void {
    this.activeProgress.set(progress.accountId, progress);
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch (err) {
        this.log.warn('Error in sync progress listener:', err);
      }
    }
  }

  public getSyncStatus(accountId: string): SyncProgress | null {
    return this.activeProgress.get(accountId) ?? null;
  }

  public getAllSyncStatuses(): SyncProgress[] {
    return Array.from(this.activeProgress.values());
  }

  public cancelSync(accountId?: string): void {
    if (accountId) {
      const token = this.activeTokens.get(accountId);
      if (token) {
        this.log.info(`Cancelling sync for account: ${accountId}`);
        token.cancel();
      }
    } else {
      this.log.info('Cancelling all active sync operations...');
      for (const token of this.activeTokens.values()) {
        token.cancel();
      }
    }
  }

  public isSyncing(accountId: string): boolean {
    return this.activeTokens.has(accountId);
  }

  /**
   * Performs full discovery scan or incremental delta sync for a single account.
   */
  public async syncAccount(accountId: string): Promise<void> {
    if (this.activeTokens.has(accountId)) {
      this.log.warn(`Sync already in progress for account: ${accountId}`);
      return;
    }

    if (!this.storageManager.hasProvider(accountId)) {
      throw new NotFoundError(`Storage provider not active for account ID: ${accountId}`);
    }

    const provider = this.storageManager.getProvider(accountId);
    const cancellationToken = new CancellationToken();
    this.activeTokens.set(accountId, cancellationToken);

    const syncRunId = `run-${crypto.randomUUID()}`;
    const runRecord: SyncRun = {
      id: syncRunId,
      storageAccountId: accountId,
      startedAt: new Date().toISOString(),
      status: 'RUNNING',
      foldersScanned: 0,
      filesScanned: 0,
      gamesDetected: 0
    };

    this.syncStateRepo.createSyncRun(runRecord);

    const initialProgress: SyncProgress = {
      accountId,
      accountName: provider.name,
      status: 'RUNNING',
      phase: 'DISCOVERY',
      foldersScanned: 0,
      filesScanned: 0,
      gamesDetected: 0,
      currentPath: '/'
    };
    this.emitProgress(initialProgress);

    try {
      const syncState = this.syncStateRepo.getSyncState(accountId);
      const isInitialScanNeeded = !syncState?.initialScanCompleted;

      if (isInitialScanNeeded) {
        await this.executeFullScan(accountId, provider, cancellationToken, runRecord, initialProgress);
      } else {
        // Incremental Delta Sync via Changes API
        this.log.info(`Executing incremental delta sync for account '${provider.name}'...`);
        this.emitProgress({
          ...initialProgress,
          phase: 'CHANGES'
        });

        const changeToken = syncState?.nextChangePageToken || syncState?.startPageToken;
        if (changeToken && provider.listChanges && this.changeProcessor) {
          let currentChangeToken: string | undefined = changeToken;
          let newStartToken: string | undefined = undefined;
          let changesProcessed = 0;

          try {
            do {
              cancellationToken.throwIfCancelled();
              const changeList = await provider.listChanges(currentChangeToken);

              if (changeList.changes.length > 0) {
                const procRes = await this.changeProcessor.processChanges(
                  accountId,
                  provider,
                  changeList.changes
                );
                changesProcessed += procRes.filesProcessed;
                runRecord.gamesDetected += procRes.gamesAffected;
              }

              currentChangeToken = changeList.nextPageToken;
              newStartToken = changeList.newStartPageToken || newStartToken;
            } while (currentChangeToken);

            // Advance token ONLY after successful processing of the change batch!
            this.syncStateRepo.recordScanComplete(accountId, false, newStartToken);
            this.log.info(`Incremental sync completed: ${changesProcessed} changes processed.`);
          } catch (err: unknown) {
            const is410 =
              (err as { status?: number })?.status === 410 ||
              (err instanceof Error &&
                /410|startPageTokenExpired|changeTokenExpired|token.*expired|invalid.*token/i.test(
                  err.message
                ));

            if (is410) {
              this.log.warn(
                `Change token expired (410 Gone) for account '${provider.name}'. Triggering full resync recovery...`
              );
              await this.executeFullScan(
                accountId,
                provider,
                cancellationToken,
                runRecord,
                initialProgress
              );
            } else {
              throw err;
            }
          }
        } else {
          // If no change token or provider lacks changes API, perform full refresh scan
          this.log.info('No valid change token found; performing full refresh scan...');
          await this.executeFullScan(accountId, provider, cancellationToken, runRecord, initialProgress);
        }
      }

      // Finish Run
      runRecord.status = 'COMPLETED';
      runRecord.finishedAt = new Date().toISOString();
      this.syncStateRepo.updateSyncRun(syncRunId, runRecord);

      this.emitProgress({
        accountId,
        accountName: provider.name,
        status: 'COMPLETED',
        phase: 'IDLE',
        foldersScanned: runRecord.foldersScanned,
        filesScanned: runRecord.filesScanned,
        gamesDetected: runRecord.gamesDetected
      });

      this.log.info(`Sync finished successfully for account '${provider.name}'.`);
    } catch (err) {
      const isCancel = err instanceof SyncCancelledError;
      runRecord.status = isCancel ? 'CANCELLED' : 'FAILED';
      runRecord.errorMessage = err instanceof Error ? err.message : String(err);
      runRecord.finishedAt = new Date().toISOString();

      this.syncStateRepo.updateSyncRun(syncRunId, runRecord);

      this.emitProgress({
        accountId,
        accountName: provider.name,
        status: runRecord.status,
        phase: 'IDLE',
        foldersScanned: runRecord.foldersScanned,
        filesScanned: runRecord.filesScanned,
        gamesDetected: runRecord.gamesDetected,
        error: runRecord.errorMessage
      });

      if (!isCancel) {
        this.log.error(`Sync failed for account '${provider.name}':`, err);
        throw err;
      } else {
        this.log.info(`Sync operation cancelled for account '${provider.name}'.`);
      }
    } finally {
      this.activeTokens.delete(accountId);
    }
  }

  /**
   * Executes a race-free full inventory scan:
   * 1. Captures preScanStartToken
   * 2. Scans all folders via BFS (stamping items with runId)
   * 3. Reconciles unseen files as MISSING (only on complete success!)
   * 4. Drains any changes that occurred since preScanStartToken
   * 5. Ingests catalog candidates
   * 6. Persists latest startPageToken and marks initialScanCompleted = true
   */
  private async executeFullScan(
    accountId: string,
    provider: StorageProvider,
    cancellationToken: CancellationToken,
    runRecord: SyncRun,
    initialProgress: SyncProgress
  ): Promise<void> {
    this.log.info(`Executing initial/full inventory scan for account '${provider.name}'...`);

    // Step 1: Pre-scan startPageToken
    let preScanStartToken: string | undefined = undefined;
    if (provider.getStartPageToken) {
      try {
        preScanStartToken = await provider.getStartPageToken();
        this.log.info(`Captured pre-scan startPageToken for '${provider.name}': ${preScanStartToken}`);
      } catch (err) {
        this.log.warn('Could not fetch startPageToken before scan:', err);
      }
    }

    // Step 2: Full BFS inventory scan
    const scanStats = await this.scanner.scanAccount(
      provider,
      cancellationToken,
      (report) => {
        this.emitProgress({
          ...initialProgress,
          foldersScanned: report.foldersScanned,
          filesScanned: report.filesScanned,
          currentPath: report.currentPath
        });
      },
      runRecord.id
    );

    runRecord.foldersScanned = scanStats.foldersScanned;
    runRecord.filesScanned = scanStats.filesScanned;
    cancellationToken.throwIfCancelled();

    // Step 3: Full Scan Reconciliation - mark unseen files as trashed/MISSING
    const unseenRemoteIds = this.cloudFilesRepo.reconcileUnseenFiles(accountId, runRecord.id);
    if (unseenRemoteIds.length > 0) {
      this.catalogIngestion.handleRemovedFiles(accountId, unseenRemoteIds);
      this.log.info(`Reconciled ${unseenRemoteIds.length} unseen files as missing/trashed.`);
    }

    // Step 4: Drain changes that occurred while full scan was running
    let latestToken = preScanStartToken;
    if (preScanStartToken && provider.listChanges && this.changeProcessor) {
      let curToken: string | undefined = preScanStartToken;
      do {
        cancellationToken.throwIfCancelled();
        const changeList = await provider.listChanges(curToken);
        if (changeList.changes.length > 0) {
          await this.changeProcessor.processChanges(accountId, provider, changeList.changes);
        }
        curToken = changeList.nextPageToken;
        latestToken = changeList.newStartPageToken || latestToken;
      } while (curToken);
    }

    // Step 5: Classify & Ingest games from cloud inventory
    cancellationToken.throwIfCancelled();
    this.emitProgress({
      ...initialProgress,
      phase: 'CLASSIFICATION',
      foldersScanned: runRecord.foldersScanned,
      filesScanned: runRecord.filesScanned
    });

    const allCloudFiles = this.cloudFilesRepo.getByAccountId(accountId);
    const candidates = GameCandidateResolver.resolveCandidates(allCloudFiles);

    this.emitProgress({
      ...initialProgress,
      phase: 'INGESTION',
      foldersScanned: runRecord.foldersScanned,
      filesScanned: runRecord.filesScanned,
      gamesDetected: candidates.length
    });

    const ingestionResult = await this.catalogIngestion.ingestCandidates(candidates, 'HIGH');
    runRecord.gamesDetected = ingestionResult.gamesCreated + ingestionResult.gamesUpdated;

    // Step 6: Mark initial scan completed with latest token AFTER changes drain & ingestion
    this.syncStateRepo.recordScanComplete(accountId, true, latestToken);
  }

  /**
   * Concurrently triggers sync across all active registered storage accounts.
   */
  public async syncAllAccounts(): Promise<void> {
    const accounts = this.storageManager.getAccounts();
    this.log.info(`Triggering multi-account sync for ${accounts.length} storage accounts...`);

    const promises = accounts.map((acc) =>
      this.syncAccount(acc.id).catch((err) => {
        this.log.error(`Account sync error for '${acc.accountName}' (${acc.id}):`, err);
      })
    );

    await Promise.all(promises);
    this.log.info('All accounts sync operations finished.');
  }
}
