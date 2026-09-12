import { StorageProvider } from '../StorageProvider';
import {
  AuthCredentials,
  AuthResult,
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
import { StorageProviderType } from '../../core/types';
import { NotImplementedError, GoogleApiError, AuthError, RateLimitExceededError } from '../../core/errors/AppError';
import { Logger } from '../../core/logger';
import { CredentialStore, getCredentialStore } from '../../core/security/CredentialStore';
import { googleOAuthService, GoogleOAuthService } from './GoogleOAuthService';

export class GoogleDriveProvider implements StorageProvider {
  public readonly id: string;
  public readonly name: string;
  public readonly type: StorageProviderType = 'google_drive';
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

  public async getValidAccessToken(): Promise<string> {
    const tokens = await this.credentialStore.getTokenPayload(this.credentialKey);
    if (!tokens) {
      throw new AuthError(`No stored credentials found for account '${this.name}' (${this.id})`);
    }

    const now = Date.now();
    // If accessToken is present and not expired (with 60s buffer)
    if (tokens.accessToken && tokens.expiryDate && tokens.expiryDate > now) {
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
    _fileId: string,
    _destinationPath: string,
    _onProgress?: (progress: DownloadProgress) => void
  ): Promise<DownloadResult> {
    throw new NotImplementedError('GoogleDriveProvider.download (Phase 3)');
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
}
