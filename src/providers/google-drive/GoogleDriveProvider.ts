import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StorageProvider } from '../StorageProvider';
import {
  AuthCredentials,
  AuthResult,
  DownloadRequest,
  DownloadProgress,
  DownloadResult,
  FileMetadata,
  RemoteFile,
  StorageProviderConfig,
  StorageQuota,
  ListFilesOptions,
  PaginatedFilesResult,
  ChangeListResult,
  RemoteChange
} from '../types';
import { StorageProviderType, RangeReadResult } from '../../core/types';
import {
  GoogleApiError,
  AuthError,
  RateLimitExceededError,
  DownloadCancelledError,
  RemoteNotFoundError,
  InvalidRangeResponseError,
  RateLimitedError,
  AuthExpiredError,
  PermissionDeniedError,
  NetworkError
} from '../../core/errors/AppError';
import { Logger } from '../../core/logger';
import { CredentialStore, getCredentialStore } from '../../core/security/CredentialStore';
import { googleOAuthService, GoogleOAuthService } from './GoogleOAuthService';

export class GoogleDriveProvider implements StorageProvider {
  public readonly id: string;
  public readonly name: string;
  public readonly type: StorageProviderType = 'google_drive';
  public readonly supportsRangeReads = true;
  public providerAccountId?: string;
  public accountEmail?: string;
  public credentialKey: string;

  private logger: Logger;
  private connected = false;
  private credentialStore: CredentialStore;
  private oauthService: GoogleOAuthService;

  constructor(
    config?: Partial<StorageProviderConfig>,
    credentialStore?: CredentialStore,
    oauthService?: GoogleOAuthService
  ) {
    this.id = config?.accountId || `gdrive-${Date.now()}`;
    this.name = config?.accountName || 'Google Drive';
    this.providerAccountId = config?.providerAccountId;
    this.accountEmail = config?.accountEmail;
    this.credentialKey = config?.credentialKey || `gdrive:${this.id}`;
    this.credentialStore = credentialStore || getCredentialStore();
    this.oauthService = oauthService || googleOAuthService;
    this.logger = new Logger(`GoogleDriveProvider:${this.id}`);
  }

  public async authenticate(credentials?: AuthCredentials): Promise<AuthResult> {
    this.logger.info('Authenticating Google Drive provider account...');

    try {
      // If a credentialKey already exists in store with valid refresh token, verify it
      const existingTokens = await this.credentialStore.getTokenPayload(this.credentialKey);
      if (existingTokens?.refreshToken) {
        this.logger.info('Found existing refresh token in CredentialStore. Verifying connection...');
        const token = await this.getValidAccessToken();
        const profile = await this.oauthService.fetchUserProfile(token);

        this.connected = true;
        this.accountEmail = profile.email;
        this.providerAccountId = profile.sub;

        return {
          success: true,
          accountId: this.id,
          accountEmail: this.accountEmail,
          accountName: this.name
        };
      }

      // If credentials code passed directly (e.g. from tests)
      if (credentials?.authCode && credentials.redirectUri && credentials.clientId) {
        this.logger.info('Exchanging direct authCode for tokens...');
        const tokens = await this.oauthService.exchangeCodeForTokens({
          code: credentials.authCode,
          codeVerifier: (credentials.customParams?.codeVerifier as string) || '',
          clientId: credentials.clientId,
          clientSecret: credentials.customParams?.clientSecret as string | undefined,
          redirectUri: credentials.redirectUri
        });

        await this.credentialStore.setTokenPayload(this.credentialKey, tokens);
        const profile = await this.oauthService.fetchUserProfile(tokens.accessToken);

        this.connected = true;
        this.accountEmail = profile.email;
        this.providerAccountId = profile.sub;

        return {
          success: true,
          accountId: this.id,
          accountEmail: this.accountEmail,
          accountName: this.name
        };
      }

      // Execute loopback OAuth2 flow with PKCE
      this.logger.info('Initiating browser OAuth2 loopback authorization...');
      const authResult = await this.oauthService.authorize();

      await this.credentialStore.setTokenPayload(this.credentialKey, authResult.tokens);

      this.connected = true;
      this.accountEmail = authResult.email;
      this.providerAccountId = authResult.providerAccountId;

      return {
        success: true,
        accountId: this.id,
        accountEmail: this.accountEmail,
        accountName: this.name
      };
    } catch (err) {
      this.logger.error('Google Drive authentication failed:', err);
      this.connected = false;
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Google Drive authentication failed'
      };
    }
  }

  public async disconnect(): Promise<void> {
    this.logger.info('Disconnecting Google Drive account session.');
    this.connected = false;
    await this.credentialStore.delete(this.credentialKey);
  }

  public async isConnected(): Promise<boolean> {
    if (!this.connected) {
      const hasTokens = await this.credentialStore.has(this.credentialKey);
      if (hasTokens) {
        this.connected = true;
      }
    }
    return this.connected;
  }

  public async getAccountInfo(): Promise<{ email?: string; name?: string; picture?: string }> {
    const token = await this.getValidAccessToken();
    const profile = await this.oauthService.fetchUserProfile(token);
    return {
      email: profile.email,
      name: profile.name,
      picture: profile.picture
    };
  }

  public async getValidAccessToken(force = false): Promise<string> {
    const tokens = await this.credentialStore.getTokenPayload(this.credentialKey);
    if (!tokens) {
      throw new AuthError(`No stored credentials found for account '${this.name}' (${this.id})`);
    }

    const now = Date.now();
    // If accessToken is present and not expired (with 60s buffer)
    if (!force && tokens.accessToken && tokens.expiryDate && tokens.expiryDate > now) {
      return tokens.accessToken;
    }

    // Refresh token needed
    if (!tokens.refreshToken) {
      throw new AuthError(`No refresh token available for account '${this.name}'. Re-authentication required.`);
    }

    this.logger.info('Access token expired. Refreshing token with Google...');
    const credentials = this.oauthService.getCredentials();
    const refreshed = await this.oauthService.refreshAccessToken({
      refreshToken: tokens.refreshToken,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret
    });

    await this.credentialStore.setTokenPayload(this.credentialKey, refreshed);
    this.logger.info('Access token refreshed successfully.');
    return refreshed.accessToken;
  }

  public async getQuota(): Promise<StorageQuota> {
    const token = await this.getValidAccessToken();

    const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new GoogleApiError(`Failed to fetch quota: ${text}`, response.status);
    }

    const data = (await response.json()) as {
      storageQuota?: {
        limit?: string;
        usage?: string;
        usageInDrive?: string;
        usageInDriveTrash?: string;
      };
    };

    const quota = data.storageQuota;
    const limit = quota?.limit ? parseInt(quota.limit, 10) : 15 * 1024 * 1024 * 1024;
    const used = quota?.usage ? parseInt(quota.usage, 10) : 0;
    const free = Math.max(0, limit - used);

    return {
      totalBytes: limit,
      usedBytes: used,
      freeBytes: free
    };
  }

  private async fetchWithRetry(
    url: string,
    init?: RequestInit,
    maxRetries = 4
  ): Promise<Response> {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, init);

        if (response.ok) {
          return response;
        }

        const isRateLimit =
          response.status === 429 ||
          response.status === 403; // Google rate limits are often HTTP 403 with userRateLimitExceeded
        const isServerTransient = response.status >= 500 && response.status < 600;

        if ((isRateLimit || isServerTransient) && attempt < maxRetries) {
          attempt++;
          const retryAfterHeader = response.headers.get('retry-after');
          const delayMs = retryAfterHeader
            ? parseInt(retryAfterHeader, 10) * 1000
            : Math.min(10000, Math.pow(2, attempt) * 500 + Math.random() * 300);

          this.logger.warn(
            `Google API returned HTTP ${response.status} (attempt ${attempt}/${maxRetries}). Retrying in ${Math.round(delayMs)}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        const text = await response.text();
        if (response.status === 429) {
          throw new RateLimitExceededError(`Google Drive rate limit exceeded: ${text}`);
        }
        throw new GoogleApiError(`API request failed: ${text}`, response.status);
      } catch (err) {
        if (err instanceof GoogleApiError || err instanceof RateLimitExceededError) {
          throw err;
        }
        // Network / connection drop retry
        if (attempt < maxRetries) {
          attempt++;
          const delayMs = Math.pow(2, attempt) * 500 + Math.random() * 300;
          this.logger.warn(`Network error during Google API call (attempt ${attempt}/${maxRetries}). Retrying in ${Math.round(delayMs)}ms...`, err);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw new GoogleApiError(`Network error communicating with Google API: ${err instanceof Error ? err.message : String(err)}`, 503);
      }
    }

    throw new GoogleApiError('Max retries exceeded communicating with Google Drive API.', 504);
  }

  public async listPaginatedFiles(
    folderId?: string,
    options?: ListFilesOptions
  ): Promise<PaginatedFilesResult> {
    const token = await this.getValidAccessToken();

    let query = options?.query;
    if (!query) {
      query = 'trashed = false';
      if (folderId) {
        query += ` and '${folderId}' in parents`;
      }
    }

    const url = new URL('https://www.googleapis.com/drive/v3/files');
    const pageSize = Math.min(1000, Math.max(1, options?.pageSize || 1000));
    url.searchParams.set('pageSize', pageSize.toString());
    url.searchParams.set(
      'fields',
      'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed)'
    );
    url.searchParams.set('q', query);

    if (options?.pageToken) {
      url.searchParams.set('pageToken', options.pageToken);
    }

    const response = await this.fetchWithRetry(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = (await response.json()) as {
      nextPageToken?: string;
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        md5Checksum?: string;
        modifiedTime?: string;
        parents?: string[];
        trashed?: boolean;
      }>;
    };

    const files: RemoteFile[] = (data.files || []).map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.size ? parseInt(file.size, 10) : 0,
      md5Checksum: file.md5Checksum,
      modifiedTime: file.modifiedTime,
      isFolder: file.mimeType === 'application/vnd.google-apps.folder',
      parentFolderId: file.parents?.[0],
      trashed: Boolean(file.trashed)
    }));

    return {
      files,
      nextPageToken: data.nextPageToken
    };
  }

  public async listFiles(folderId?: string, options?: ListFilesOptions): Promise<RemoteFile[]> {
    if (options?.pageToken) {
      const pageResult = await this.listPaginatedFiles(folderId, options);
      return pageResult.files;
    }

    // Full multi-page iteration
    const allFiles: RemoteFile[] = [];
    let currentToken: string | undefined = undefined;

    do {
      const pageResult = await this.listPaginatedFiles(folderId, {
        ...options,
        pageToken: currentToken
      });
      allFiles.push(...pageResult.files);
      currentToken = pageResult.nextPageToken;
    } while (currentToken);

    return allFiles;
  }

  public async getStartPageToken(): Promise<string> {
    const token = await this.getValidAccessToken();
    const url = 'https://www.googleapis.com/drive/v3/changes/startPageToken';

    const response = await this.fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = (await response.json()) as { startPageToken?: string };
    if (!data.startPageToken) {
      throw new GoogleApiError('Failed to retrieve startPageToken from Google Drive API.');
    }
    return data.startPageToken;
  }

  public async listChanges(pageToken: string): Promise<ChangeListResult> {
    const token = await this.getValidAccessToken();
    const url = new URL('https://www.googleapis.com/drive/v3/changes');
    url.searchParams.set('pageToken', pageToken);
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('includeRemoved', 'true');
    url.searchParams.set(
      'fields',
      'nextPageToken,newStartPageToken,changes(fileId,removed,time,file(id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed))'
    );

    const response = await this.fetchWithRetry(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = (await response.json()) as {
      nextPageToken?: string;
      newStartPageToken?: string;
      changes?: Array<{
        fileId: string;
        removed: boolean;
        time?: string;
        file?: {
          id: string;
          name: string;
          mimeType: string;
          size?: string;
          md5Checksum?: string;
          modifiedTime?: string;
          parents?: string[];
          trashed?: boolean;
        };
      }>;
    };

    const changes: RemoteChange[] = (data.changes || []).map((ch) => ({
      fileId: ch.fileId,
      removed: ch.removed || Boolean(ch.file?.trashed),
      time: ch.time,
      file: ch.file
        ? {
            id: ch.file.id,
            name: ch.file.name,
            mimeType: ch.file.mimeType,
            sizeBytes: ch.file.size ? parseInt(ch.file.size, 10) : 0,
            md5Checksum: ch.file.md5Checksum,
            modifiedTime: ch.file.modifiedTime,
            isFolder: ch.file.mimeType === 'application/vnd.google-apps.folder',
            parentFolderId: ch.file.parents?.[0],
            trashed: Boolean(ch.file.trashed)
          }
        : undefined
    }));

    return {
      changes,
      nextPageToken: data.nextPageToken,
      newStartPageToken: data.newStartPageToken
    };
  }

  public async getFile(fileId: string): Promise<RemoteFile> {
    const token = await this.getValidAccessToken();

    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set('fields', 'id,name,mimeType,size,md5Checksum,modifiedTime,parents');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new GoogleApiError(`Failed to get file metadata: ${text}`, response.status);
    }

    const file = (await response.json()) as {
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      md5Checksum?: string;
      modifiedTime?: string;
      parents?: string[];
    };

    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.size ? parseInt(file.size, 10) : 0,
      md5Checksum: file.md5Checksum,
      modifiedTime: file.modifiedTime,
      isFolder: file.mimeType === 'application/vnd.google-apps.folder',
      parentFolderId: file.parents?.[0]
    };
  }

  public async download(
    requestOrFileId: DownloadRequest | string,
    destinationPathOrOnProgress?: string | ((progress: DownloadProgress) => void),
    onProgressCallback?: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    let req: DownloadRequest;
    let onProgress: ((progress: DownloadProgress) => void) | undefined;

    if (typeof requestOrFileId === 'string') {
      req = {
        fileId: requestOrFileId,
        destinationPath: destinationPathOrOnProgress as string
      };
      onProgress = onProgressCallback;
    } else {
      req = requestOrFileId;
      onProgress = typeof destinationPathOrOnProgress === 'function' ? destinationPathOrOnProgress : onProgressCallback;
    }

    const { fileId, destinationPath, signal, startByte, expectedSize } = req;

    // Ensure parent directory exists
    const parentDir = path.dirname(destinationPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const token = await this.getValidAccessToken();
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set('alt', 'media');

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`
    };

    const isResuming = startByte !== undefined && startByte > 0;
    if (isResuming) {
      headers['Range'] = `bytes=${startByte}-`;
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers,
        signal
      });
    } catch (err: unknown) {
      const isAbort =
        (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') ||
        signal?.aborted;
      if (isAbort) {
        throw new DownloadCancelledError(`Download of file ${fileId} was cancelled.`);
      }
      throw new NetworkError(`Network connection failed downloading file ${fileId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Handle 401 token expiry with automatic refresh
    if (response.status === 401) {
      this.logger.warn(`Token expired during download of file ${fileId}, refreshing access token...`);
      try {
        const refreshedToken = await this.getValidAccessToken(true);
        const retryHeaders = { ...headers, Authorization: `Bearer ${refreshedToken}` };
        response = await fetch(url.toString(), { headers: retryHeaders, signal });
      } catch (refreshErr) {
        throw new AuthExpiredError(`Authentication failed after token refresh attempt: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`);
      }
      if (response.status === 401) {
        throw new AuthExpiredError(`Authentication token expired and could not be refreshed for file ${fileId}.`);
      }
    }

    // Handle standard error status codes
    if (!response.ok) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

      if (response.status === 404) {
        throw new RemoteNotFoundError(`Remote file ${fileId} was not found on Google Drive.`);
      }
      if (response.status === 429) {
        throw new RateLimitedError(`Rate limit exceeded for Google Drive file ${fileId}.`, retryAfterSec);
      }
      if (response.status === 403) {
        const text = await response.text();
        if (text.includes('rateLimitExceeded') || text.includes('userRateLimitExceeded')) {
          throw new RateLimitedError(`Rate limit exceeded for Google Drive file ${fileId}.`, retryAfterSec);
        }
        throw new PermissionDeniedError(`Permission denied accessing Google Drive file ${fileId}: ${text}`);
      }
      if (response.status === 416) {
        throw new InvalidRangeResponseError(`Range Not Satisfiable (416) for file ${fileId} at startByte ${startByte}`);
      }
      if (response.status >= 500) {
        throw new NetworkError(`Transient Google Drive server error (${response.status}) for file ${fileId}`);
      }
      const text = await response.text();
      throw new GoogleApiError(`Failed to download file from Google Drive (${response.status}): ${text}`, response.status);
    }

    // Range Validation:
    // If we asked for bytes=X- (startByte > 0):
    // 1. If status is 200 OK: MUST NOT append, throw InvalidRangeResponseError
    if (isResuming && response.status === 200) {
      throw new InvalidRangeResponseError(
        `Server returned 200 OK instead of 206 Partial Content for range request (startByte: ${startByte})`
      );
    }

    // 2. If status is 206 Partial Content: validate Content-Range header
    let totalBytes = expectedSize || 0;
    if (response.status === 206) {
      const contentRange = response.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
        if (match) {
          const rangeStart = parseInt(match[1], 10);
          if (rangeStart !== startByte) {
            throw new InvalidRangeResponseError(
              `Content-Range start (${rangeStart}) does not match requested startByte (${startByte})`
            );
          }
          if (match[3] !== '*') {
            totalBytes = parseInt(match[3], 10);
          }
        }
      }
    } else {
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        totalBytes = parseInt(contentLength, 10);
      }
    }

    if (!response.body) {
      throw new GoogleApiError(`Response body is empty for file ${fileId}`);
    }

    const etag = response.headers.get('etag') || undefined;
    const startTime = Date.now();
    let currentBytes = startByte || 0;
    let lastProgressTime = startTime;

    // Moving window for speed calculation (samples from the last 2000ms)
    const speedSamples: Array<{ time: number; bytes: number }> = [
      { time: startTime, bytes: currentBytes }
    ];

    const progressTransform = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        currentBytes += chunk.length;
        const now = Date.now();

        speedSamples.push({ time: now, bytes: currentBytes });
        while (speedSamples.length > 1 && now - speedSamples[0].time > 2000) {
          speedSamples.shift();
        }

        if (onProgress && now - lastProgressTime >= 150) {
          const oldestSample = speedSamples[0];
          const timeDelta = (now - oldestSample.time) / 1000;
          const bytesDelta = currentBytes - oldestSample.bytes;
          const speedBps = timeDelta > 0 ? Math.round(bytesDelta / timeDelta) : 0;
          const percentage = totalBytes > 0 ? Math.min(100, Math.round((currentBytes / totalBytes) * 100)) : 0;
          const remainingBytes = Math.max(0, totalBytes - currentBytes);
          const etaSeconds = speedBps > 0 ? Math.round(remainingBytes / speedBps) : undefined;

          onProgress({
            fileId,
            bytesTransferred: currentBytes,
            totalBytes,
            speedBps,
            percentage,
            etaSeconds
          });

          lastProgressTime = now;
        }

        callback(null, chunk);
      }
    });

    const fileWriteStream = fs.createWriteStream(destinationPath, { flags: isResuming ? 'a' : 'w' });

    const onAbort = () => {
      fileWriteStream.destroy();
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const nodeReadable = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      await pipeline(nodeReadable, progressTransform, fileWriteStream);
    } catch (err: unknown) {
      const isAbort =
        (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError') ||
        signal?.aborted;
      if (isAbort) {
        throw new DownloadCancelledError(`Download of file ${fileId} was cancelled.`);
      }
      throw new NetworkError(`Stream pipeline failed for file ${fileId}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }

    const durationMs = Date.now() - startTime;
    const bytesWrittenInThisSession = currentBytes - (startByte || 0);

    if (onProgress) {
      const overallSpeed = durationMs > 0 ? Math.round((bytesWrittenInThisSession / durationMs) * 1000) : 0;
      onProgress({
        fileId,
        bytesTransferred: currentBytes,
        totalBytes: totalBytes > 0 ? totalBytes : currentBytes,
        speedBps: overallSpeed,
        percentage: 100,
        etaSeconds: 0
      });
    }

    return {
      destinationPath,
      bytesWritten: bytesWrittenInThisSession,
      totalBytes: totalBytes > 0 ? totalBytes : currentBytes,
      startByte: startByte || 0,
      resumed: isResuming,
      durationMs,
      etag
    };
  }

  public async getMetadata(fileId: string): Promise<FileMetadata> {
    const file = await this.getFile(fileId);
    return {
      fileId: file.id,
      name: file.name,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      md5Checksum: file.md5Checksum,
      modifiedTime: file.modifiedTime
    };
  }

  public async readRange(
    fileId: string,
    start: number,
    end: number,
    signal?: AbortSignal
  ): Promise<RangeReadResult> {
    if (start < 0 || end < start || !Number.isFinite(start) || !Number.isFinite(end)) {
      throw new InvalidRangeResponseError(
        `Invalid byte range specified: [${start}-${end}]. Offset cannot be negative and end must be >= start.`
      );
    }

    const token = await this.getValidAccessToken();
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
    url.searchParams.set('alt', 'media');

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Range: `bytes=${start}-${end}`
    };

    let response: Response;
    try {
      response = await this.fetchWithRetry(url.toString(), {
        headers,
        signal
      });
    } catch (err: unknown) {
      if (signal?.aborted) {
        throw new DownloadCancelledError(`Range read for file ${fileId} was cancelled.`);
      }
      throw err;
    }

    if (response.status === 416) {
      throw new InvalidRangeResponseError(`HTTP 416 Range Not Satisfiable for file ${fileId} [${start}-${end}].`);
    }

    if (response.status !== 206) {
      throw new InvalidRangeResponseError(
        `Expected HTTP 206 Partial Content for range read [${start}-${end}], but received status ${response.status}.`
      );
    }

    const contentRange = response.headers.get('Content-Range') || undefined;
    let totalSize: number | undefined;
    if (contentRange) {
      const match = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
      if (match) {
        const rangeStart = parseInt(match[1], 10);
        if (rangeStart !== start) {
          throw new InvalidRangeResponseError(
            `Content-Range start byte mismatch: expected ${start}, received ${rangeStart} (Header: "${contentRange}")`
          );
        }
        if (match[3] !== '*') {
          totalSize = parseInt(match[3], 10);
        }
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);

    return {
      data,
      contentRange,
      totalSize
    };
  }
}
