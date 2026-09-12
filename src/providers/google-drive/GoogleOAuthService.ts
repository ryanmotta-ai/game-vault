import http from 'node:http';
import { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import { shell } from 'electron';
import { logger } from '../../core/logger';
import {
  OAuthCancelledError,
  OAuthTimeoutError,
  OAuthConfigurationError,
  AuthError
} from '../../core/errors/AppError';
import { TokenPayload } from '../../core/security/CredentialStore';

export interface GoogleAuthResult {
  providerAccountId: string;
  email: string;
  displayName: string;
  picture?: string;
  tokens: TokenPayload;
}

export interface GoogleOAuthOptions {
  clientId?: string;
  clientSecret?: string;
  customScopes?: string[];
  timeoutMs?: number;
}

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
];

export class GoogleOAuthService {
  private log = logger.child('GoogleOAuth');

  public static generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  public static generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  public getCredentials(options?: GoogleOAuthOptions): { clientId: string; clientSecret?: string } {
    const clientId = options?.clientId || process.env.GAMEVAULT_GOOGLE_CLIENT_ID;
    const clientSecret = options?.clientSecret || process.env.GAMEVAULT_GOOGLE_CLIENT_SECRET;

    if (!clientId) {
      throw new OAuthConfigurationError(
        'Google Client ID is not configured. Please set GAMEVAULT_GOOGLE_CLIENT_ID or check docs/GOOGLE_DRIVE_SETUP.md'
      );
    }

    return { clientId, clientSecret };
  }

  /**
   * Starts local loopback OAuth 2.0 PKCE flow for desktop application (RFC 8252 + RFC 7636).
   */
  public async authorize(options?: GoogleOAuthOptions): Promise<GoogleAuthResult> {
    const { clientId, clientSecret } = this.getCredentials(options);
    const scopes = options?.customScopes || GOOGLE_DRIVE_SCOPES;
    const timeoutMs = options?.timeoutMs || 120000; // 2 minutes timeout

    const codeVerifier = GoogleOAuthService.generateCodeVerifier();
    const codeChallenge = GoogleOAuthService.generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    return new Promise<GoogleAuthResult>((resolve, reject) => {
      let server: http.Server | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        if (server) {
          server.close();
          server = null;
        }
      };

      timeoutHandle = setTimeout(() => {
        cleanup();
        this.log.warn('OAuth flow timed out waiting for browser callback.');
        reject(new OAuthTimeoutError());
      }, timeoutMs);

      server = http.createServer(async (req, res) => {
        try {
          if (!req.url || !req.url.startsWith('/oauth2callback')) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
          }

          const requestUrl = new URL(req.url, 'http://127.0.0.1');
          const code = requestUrl.searchParams.get('code');
          const returnedState = requestUrl.searchParams.get('state');
          const error = requestUrl.searchParams.get('error');

          if (error) {
            this.log.warn(`OAuth error returned from provider: ${error}`);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.renderHtmlResponse(false, 'Authorization was declined or cancelled.'));
            cleanup();
            if (error === 'access_denied') {
              reject(new OAuthCancelledError());
            } else {
              reject(new AuthError(`Google OAuth returned error: ${error}`));
            }
            return;
          }

          if (returnedState !== state) {
            this.log.error('OAuth state mismatch detected (possible CSRF).');
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.renderHtmlResponse(false, 'Security error: State parameter mismatch.'));
            cleanup();
            reject(new AuthError('OAuth CSRF state mismatch.'));
            return;
          }

          if (!code) {
            this.log.error('No authorization code provided in callback.');
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.renderHtmlResponse(false, 'No authorization code received.'));
            cleanup();
            reject(new AuthError('No authorization code provided.'));
            return;
          }

          // Render success page to user's browser
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.renderHtmlResponse(true, 'Authentication successful! You may return to Game Vault.'));

          const port = (server?.address() as AddressInfo).port;
          const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

          cleanup();

          // Exchange authorization code + PKCE code_verifier for tokens
          this.log.info('Exchanging authorization code for tokens...');
          const tokens = await this.exchangeCodeForTokens({
            code,
            codeVerifier,
            clientId,
            clientSecret,
            redirectUri
          });

          // Fetch user profile info to identify the account
          this.log.info('Fetching Google user profile info...');
          const userInfo = await this.fetchUserProfile(tokens.accessToken);

          resolve({
            providerAccountId: userInfo.sub,
            email: userInfo.email,
            displayName: userInfo.name || userInfo.email,
            picture: userInfo.picture,
            tokens
          });
        } catch (err) {
          cleanup();
          this.log.error('Error handling OAuth callback:', err);
          reject(err instanceof Error ? err : new AuthError('Failed to complete OAuth authorization.'));
        }
      });

      // Listen on random available port on loopback IP (RFC 8252)
      server.listen(0, '127.0.0.1', () => {
        const address = server?.address() as AddressInfo;
        const port = address.port;
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', scopes.join(' '));
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        this.log.info(`Launching browser for Google OAuth on port ${port}...`);
        shell.openExternal(authUrl.toString());
      });

      server.on('error', (err) => {
        cleanup();
        this.log.error('Local loopback server error:', err);
        reject(new AuthError(`Failed to start local OAuth loopback server: ${err.message}`));
      });
    });
  }

  public async exchangeCodeForTokens(params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
  }): Promise<TokenPayload> {
    const bodyParams: Record<string, string> = {
      code: params.code,
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier
    };

    if (params.clientSecret) {
      bodyParams.client_secret = params.clientSecret;
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(bodyParams).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.log.error(`Token exchange failed with HTTP ${response.status}`);
      throw new AuthError(`Failed to exchange token with Google: HTTP ${response.status}`, { details: errorText });
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
      token_type?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiryDate: Date.now() + (data.expires_in - 60) * 1000, // 60s margin
      tokenType: data.token_type,
      scope: data.scope
    };
  }

  public async refreshAccessToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret?: string;
  }): Promise<TokenPayload> {
    const bodyParams: Record<string, string> = {
      client_id: params.clientId,
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken
    };

    if (params.clientSecret) {
      bodyParams.client_secret = params.clientSecret;
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(bodyParams).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.log.error(`Token refresh failed with HTTP ${response.status}`);
      throw new AuthError(`Failed to refresh Google token: HTTP ${response.status}`, { details: errorText });
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type?: string;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: params.refreshToken,
      expiryDate: Date.now() + (data.expires_in - 60) * 1000,
      tokenType: data.token_type,
      scope: data.scope
    };
  }

  public async fetchUserProfile(accessToken: string): Promise<{
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  }> {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new AuthError(`Failed to fetch user profile: HTTP ${response.status}`);
    }

    return (await response.json()) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
    };
  }

  private renderHtmlResponse(success: boolean, message: string): string {
    const title = success ? 'Authentication Successful' : 'Authentication Failed';
    const color = success ? '#10b981' : '#ef4444';
    const icon = success ? '⚡' : '✕';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Game Vault — ${title}</title>
  <style>
    body {
      background-color: #0a0d14;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #141b29;
      padding: 40px;
      border-radius: 12px;
      border: 1px solid #212c42;
      text-align: center;
      max-width: 420px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
    }
    .icon {
      font-size: 48px;
      margin-bottom: 12px;
    }
    h1 {
      color: ${color};
      font-size: 20px;
      margin-bottom: 10px;
    }
    p {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.5;
    }
    .hint {
      margin-top: 16px;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="hint">You can safely close this browser tab.</p>
  </div>
</body>
</html>`;
  }
}

export const googleOAuthService = new GoogleOAuthService();
