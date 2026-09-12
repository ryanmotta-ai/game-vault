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
import { NotImplementedError, GoogleApiError, AuthError } from '../../core/errors/AppError';
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

  public async listFiles(folderId?: string): Promise<RemoteFile[]> {
    const token = await this.getValidAccessToken();

    let query = 'trashed = false';
    if (folderId) {
      query += ` and '${folderId}' in parents`;
    }

    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('pageSize', '50');
    url.searchParams.set(
      'fields',
      'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,parents,trashed)'
    );
    url.searchParams.set('q', query);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new GoogleApiError(`Failed to list files: ${text}`, response.status);
    }

    const data = (await response.json()) as {
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        md5Checksum?: string;
        modifiedTime?: string;
        parents?: string[];
      }>;
    };

    return (data.files || []).map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.size ? parseInt(file.size, 10) : 0,
      md5Checksum: file.md5Checksum,
      modifiedTime: file.modifiedTime,
      isFolder: file.mimeType === 'application/vnd.google-apps.folder',
      parentFolderId: file.parents?.[0]
    }));
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
