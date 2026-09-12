export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly details?: unknown;

  constructor(message: string, code = 'APP_ERROR', statusCode = 500, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  public toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details
    };
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'DATABASE_ERROR', 500, details);
  }
}

export class StorageError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'STORAGE_ERROR', 502, details);
  }
}

export class AuthError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTH_ERROR', 401, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'NOT_FOUND', 404, details);
  }
}

export class NotImplementedError extends AppError {
  constructor(feature: string) {
    super(`Feature '${feature}' is not yet implemented in this foundation phase.`, 'NOT_IMPLEMENTED', 501);
  }
}

export class OAuthCancelledError extends AuthError {
  constructor(message = 'Google authorization was cancelled by the user.') {
    super(message, { reason: 'USER_CANCELLED' });
    Object.assign(this, { code: 'OAUTH_CANCELLED', statusCode: 400 });
  }
}

export class OAuthTimeoutError extends AuthError {
  constructor(message = 'Google authorization timed out waiting for response.') {
    super(message, { reason: 'TIMEOUT' });
    Object.assign(this, { code: 'OAUTH_TIMEOUT', statusCode: 408 });
  }
}

export class OAuthConfigurationError extends AppError {
  constructor(message = 'Google OAuth credentials (Client ID / Secret) are not configured.') {
    super(message, 'OAUTH_CONFIG_ERROR', 500);
  }
}

export class TokenRefreshError extends AuthError {
  constructor(message = 'Failed to refresh Google Drive access token. Re-authentication required.', details?: unknown) {
    super(message, details);
    Object.assign(this, { code: 'TOKEN_REFRESH_FAILED', statusCode: 401 });
  }
}

export class AccountAlreadyConnectedError extends AppError {
  constructor(email?: string) {
    super(
      email
        ? `The Google account (${email}) is already connected.`
        : 'This storage account is already connected.',
      'ACCOUNT_ALREADY_CONNECTED',
      409
    );
  }
}

export class CredentialStoreError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'CREDENTIAL_STORE_ERROR', 500, details);
  }
}

export class CredentialStoreUnavailableError extends CredentialStoreError {
  constructor(message = 'Secure credential storage (safeStorage/DPAPI) is unavailable on this system.') {
    super(message);
    Object.assign(this, { code: 'CREDENTIAL_STORE_UNAVAILABLE', statusCode: 503 });
  }
}

export class GoogleApiError extends StorageError {
  constructor(message: string, public readonly status = 500, details?: unknown) {
    super(`Google Drive API Error (${status}): ${message}`, details);
    Object.assign(this, { code: 'GOOGLE_API_ERROR', statusCode: status });
  }
}

export class SyncCancelledError extends AppError {
  constructor(message = 'Cloud inventory synchronization was cancelled by user.') {
    super(message, 'SYNC_CANCELLED', 499);
  }
}

export class RateLimitExceededError extends StorageError {
  constructor(message = 'Storage API rate limit exceeded.', public readonly retryAfterSeconds?: number) {
    super(message);
    Object.assign(this, { code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 });
  }
}

