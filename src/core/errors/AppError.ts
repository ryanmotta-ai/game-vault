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

export class DownloadError extends AppError {
  constructor(message: string, code = 'DOWNLOAD_ERROR', statusCode = 500, details?: unknown) {
    super(message, code, statusCode, details);
  }
}

export class DownloadCancelledError extends DownloadError {
  constructor(message = 'Download was cancelled by user.') {
    super(message, 'DOWNLOAD_CANCELLED', 499);
  }
}

export class InsufficientDiskSpaceError extends DownloadError {
  constructor(message = 'Insufficient disk space available for download.', details?: unknown) {
    super(message, 'INSUFFICIENT_DISK_SPACE', 507, details);
  }
}

export class ChecksumMismatchError extends DownloadError {
  constructor(message = 'Downloaded file checksum verification failed.', details?: unknown) {
    super(message, 'CHECKSUM_MISMATCH', 422, details);
  }
}

export class LocalFileError extends DownloadError {
  constructor(message: string, details?: unknown) {
    super(message, 'LOCAL_FILE_ERROR', 500, details);
  }
}

export class RemoteFileUnavailableError extends DownloadError {
  constructor(message = 'Remote file is unavailable or no longer exists.', details?: unknown) {
    super(message, 'REMOTE_FILE_UNAVAILABLE', 404, details);
  }
}

export class RemoteNotFoundError extends DownloadError {
  constructor(message = 'Remote file was not found.', details?: unknown) {
    super(message, 'REMOTE_NOT_FOUND', 404, details);
  }
}

export class NetworkError extends DownloadError {
  constructor(message = 'Network connection failed during transfer.', details?: unknown) {
    super(message, 'NETWORK_ERROR', 503, details);
  }
}

export class RateLimitedError extends DownloadError {
  constructor(message = 'Storage API rate limit exceeded.', public readonly retryAfterSeconds?: number) {
    super(message, 'RATE_LIMITED', 429, { retryAfterSeconds });
  }
}

export class RemoteFileChangedError extends DownloadError {
  constructor(message = 'Remote file was modified in cloud storage since download started.', details?: unknown) {
    super(message, 'REMOTE_FILE_CHANGED', 409, details);
  }
}

export class InvalidRangeResponseError extends DownloadError {
  constructor(message = 'Server returned incompatible range response for resumption.', details?: unknown) {
    super(message, 'INVALID_RANGE_RESPONSE', 416, details);
  }
}

export class InvalidPartialFileError extends DownloadError {
  constructor(message = 'Partial file is invalid or larger than expected size.', details?: unknown) {
    super(message, 'INVALID_PARTIAL', 400, details);
  }
}

export class AuthExpiredError extends DownloadError {
  constructor(message = 'Authentication token expired during download.', details?: unknown) {
    super(message, 'AUTH_EXPIRED', 401, details);
  }
}

export class PermissionDeniedError extends DownloadError {
  constructor(message = 'Permission denied accessing remote file.', details?: unknown) {
    super(message, 'PERMISSION_DENIED', 403, details);
  }
}

// --- Phase 3C: Preparation & Archive Security Errors ---

export class PreparationError extends AppError {
  constructor(message: string, code = 'PREPARATION_ERROR', statusCode = 500, details?: unknown) {
    super(message, code, statusCode, details);
  }
}

export class ZipSlipSecurityError extends PreparationError {
  constructor(entryPath: string, targetDir: string) {
    super(
      `Security violation: Archive entry path traversal attempt detected ('${entryPath}' escaping '${targetDir}').`,
      'ZIP_SLIP_SECURITY_ERROR',
      403,
      { entryPath, targetDir }
    );
  }
}

export class ArchiveCorruptedError extends PreparationError {
  constructor(message = 'Archive file is corrupted or cannot be read.', details?: unknown) {
    super(message, 'ARCHIVE_CORRUPTED', 422, details);
  }
}

export class ExtractionCancelledError extends PreparationError {
  constructor(message = 'Extraction was cancelled by user or process shutdown.') {
    super(message, 'EXTRACTION_CANCELLED', 499);
  }
}

export class UnsupportedArchiveFormatError extends PreparationError {
  constructor(format: string) {
    super(`Unsupported archive format: '${format}'. Expected .zip, .7z, or .rar.`, 'UNSUPPORTED_ARCHIVE_FORMAT', 400);
  }
}

// --- Phase 4A: Launcher Engine & Emulator Errors ---

export class LauncherError extends AppError {
  constructor(message: string, code = 'LAUNCHER_ERROR', statusCode = 500, details?: unknown) {
    super(message, code, statusCode, details);
  }
}

export class EmulatorNotFoundError extends LauncherError {
  constructor(platformOrName: string, details?: unknown) {
    super(
      `Emulator not found or not configured for "${platformOrName}". Please configure an emulator in Settings.`,
      'EMULATOR_NOT_FOUND',
      404,
      details
    );
  }
}

export class RomNotFoundError extends LauncherError {
  constructor(romPath: string, details?: unknown) {
    super(
      `Playable ROM or executable file not found at "${romPath}".`,
      'ROM_NOT_FOUND',
      404,
      details
    );
  }
}

export class CoreNotFoundError extends LauncherError {
  constructor(coreNameOrPlatform: string, details?: unknown) {
    super(
      `Required RetroArch core not found for "${coreNameOrPlatform}".`,
      'CORE_NOT_FOUND',
      404,
      details
    );
  }
}

export class GameAlreadyRunningError extends LauncherError {
  constructor(gameTitle: string, details?: unknown) {
    super(
      `Game "${gameTitle}" is already running. Duplicate launch was prevented.`,
      'GAME_ALREADY_RUNNING',
      409,
      details
    );
  }
}

export class InvalidLaunchProfileError extends LauncherError {
  constructor(message: string, details?: unknown) {
    super(
      `Invalid launch profile: ${message}`,
      'INVALID_LAUNCH_PROFILE',
      400,
      details
    );
  }
}

export class ExecutableInaccessibleError extends LauncherError {
  constructor(executablePath: string, details?: unknown) {
    super(
      `Target executable "${executablePath}" is not accessible or not an executable file.`,
      'EXECUTABLE_INACCESSIBLE',
      403,
      details
    );
  }
}

export class ProcessLaunchFailedError extends LauncherError {
  constructor(message: string, details?: unknown) {
    super(
      `Failed to launch process: ${message}`,
      'PROCESS_LAUNCH_FAILED',
      500,
      details
    );
  }
}

export class StreamingError extends AppError {
  constructor(message: string, code = 'STREAMING_ERROR', statusCode = 500, details?: unknown) {
    super(message, code, statusCode, details);
  }
}

export class RangeOutOfBoundsError extends StreamingError {
  constructor(start: number, end: number, totalSize?: number, details?: unknown) {
    super(
      `Requested range [${start}-${end}] is out of bounds (Total: ${totalSize ?? 'unknown'}).`,
      'RANGE_OUT_OF_BOUNDS',
      416,
      details
    );
  }
}

export class StreamingStallError extends StreamingError {
  constructor(blockIndex: number, elapsedMs: number, details?: unknown) {
    super(
      `Streaming read stalled waiting for block ${blockIndex} (${elapsedMs}ms).`,
      'STREAMING_STALL',
      504,
      details
    );
  }
}

export class StreamingBootstrapFailedError extends StreamingError {
  constructor(gameTitle: string, reason: string, details?: unknown) {
    super(
      `Failed to bootstrap streaming session for "${gameTitle}": ${reason}`,
      'STREAMING_BOOTSTRAP_FAILED',
      500,
      details
    );
  }
}


