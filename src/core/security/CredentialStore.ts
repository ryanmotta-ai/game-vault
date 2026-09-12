import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeStorage } from 'electron';
import { configManager } from '../config';
import { logger } from '../logger';
import { CredentialStoreError, CredentialStoreUnavailableError } from '../errors/AppError';

export interface TokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number; // timestamp ms
  tokenType?: string;
  scope?: string;
}

export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  getTokenPayload(key: string): Promise<TokenPayload | null>;
  setTokenPayload(key: string, payload: TokenPayload): Promise<void>;
}

/**
 * In-memory store implementation primarily for unit testing and headless test runners.
 */
export class MemoryCredentialStore implements CredentialStore {
  private store = new Map<string, string>();

  public async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  public async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  public async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  public async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  public async getTokenPayload(key: string): Promise<TokenPayload | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TokenPayload;
    } catch {
      return null;
    }
  }

  public async setTokenPayload(key: string, payload: TokenPayload): Promise<void> {
    await this.set(key, JSON.stringify(payload));
  }

  public clear(): void {
    this.store.clear();
  }
}

/**
 * Production CredentialStore utilizing Electron's safeStorage (Windows DPAPI / macOS Keychain / Linux secret service).
 * Encrypted buffers are persisted in a protected AppData credentials folder.
 */
export interface DpapiCredentialStoreOptions {
  customDir?: string;
  allowInsecureFallback?: boolean;
}

export class DpapiCredentialStore implements CredentialStore {
  private credentialsDir: string;
  private allowInsecureFallback: boolean;
  private log = logger.child('CredentialStore');

  constructor(options?: string | DpapiCredentialStoreOptions) {
    const customDir = typeof options === 'string' ? options : options?.customDir;
    this.allowInsecureFallback =
      typeof options === 'object' && options?.allowInsecureFallback !== undefined
        ? options.allowInsecureFallback
        : process.env.GAMEVAULT_ALLOW_INSECURE_CREDENTIALS === 'true' || process.env.NODE_ENV === 'test';

    const baseDir = customDir || configManager.get('appDataDir');
    this.credentialsDir = path.join(baseDir, 'credentials');
    this.ensureDirectory();
  }

  private isEncryptionAvailable(): boolean {
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  }

  private canUseFallback(): boolean {
    return this.allowInsecureFallback;
  }

  private ensureDirectory(): void {
    try {
      if (!fs.existsSync(this.credentialsDir)) {
        fs.mkdirSync(this.credentialsDir, { recursive: true });
      }
    } catch (err) {
      this.log.error('Failed to create credentials directory:', err);
    }
  }

  private getFilePath(key: string): string {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(this.credentialsDir, `${hash}.enc`);
  }

  public async set(key: string, value: string): Promise<void> {
    this.ensureDirectory();
    try {
      if (this.isEncryptionAvailable()) {
        const encryptedBuffer = safeStorage.encryptString(value);
        fs.writeFileSync(this.getFilePath(key), encryptedBuffer);
      } else if (this.canUseFallback()) {
        this.log.warn(`safeStorage unavailable. Using dev/test AES-256-GCM fallback for credential key: ${key}`);
        const fallbackKey = crypto.createHash('sha256').update(configManager.get('appDataDir')).digest();
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', fallbackKey, iv);
        const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        const combined = Buffer.concat([iv, tag, encrypted]);
        fs.writeFileSync(this.getFilePath(key), combined);
      } else {
        throw new CredentialStoreUnavailableError(
          'Electron safeStorage (DPAPI) is not available and insecure fallback is disabled in production.'
        );
      }
      this.log.debug(`Saved encrypted credential for key: ${key}`);
    } catch (err) {
      if (err instanceof CredentialStoreError) throw err;
      this.log.error(`Failed to securely save credential for key ${key}:`, err);
      throw new CredentialStoreError(`Failed to save credential for '${key}'`, err);
    }
  }

  public async get(key: string): Promise<string | null> {
    const filePath = this.getFilePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const buffer = fs.readFileSync(filePath);
      if (this.isEncryptionAvailable()) {
        return safeStorage.decryptString(buffer);
      } else if (this.canUseFallback()) {
        const fallbackKey = crypto.createHash('sha256').update(configManager.get('appDataDir')).digest();
        const iv = buffer.subarray(0, 12);
        const tag = buffer.subarray(12, 28);
        const encrypted = buffer.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', fallbackKey, iv);
        decipher.setAuthTag(tag);
        return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
      } else {
        throw new CredentialStoreUnavailableError(
          'Electron safeStorage (DPAPI) is not available and insecure fallback is disabled in production.'
        );
      }
    } catch (err) {
      if (err instanceof CredentialStoreError) throw err;
      this.log.error(`Failed to decrypt credential for key ${key}:`, err);
      throw new CredentialStoreError(`Failed to retrieve credential for '${key}'`, err);
    }
  }

  public async delete(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        this.log.debug(`Deleted credential for key: ${key}`);
        return true;
      } catch (err) {
        this.log.error(`Failed to delete credential file for key ${key}:`, err);
        return false;
      }
    }
    return false;
  }

  public async has(key: string): Promise<boolean> {
    return fs.existsSync(this.getFilePath(key));
  }

  public async getTokenPayload(key: string): Promise<TokenPayload | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TokenPayload;
    } catch {
      return null;
    }
  }

  public async setTokenPayload(key: string, payload: TokenPayload): Promise<void> {
    await this.set(key, JSON.stringify(payload));
  }
}

let defaultCredentialStore: CredentialStore | null = null;

export function getCredentialStore(): CredentialStore {
  if (!defaultCredentialStore) {
    defaultCredentialStore = new DpapiCredentialStore();
  }
  return defaultCredentialStore;
}

export function setCredentialStore(store: CredentialStore): void {
  defaultCredentialStore = store;
}
