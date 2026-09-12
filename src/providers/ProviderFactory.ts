import { StorageProviderType } from '../core/types';
import { StorageProvider } from './StorageProvider';
import { GoogleDriveProvider } from './google-drive/GoogleDriveProvider';
import { StorageProviderConfig } from './types';
import { ValidationError } from '../core/errors/AppError';

export type ProviderConstructor = new (config?: Partial<StorageProviderConfig>) => StorageProvider;

export class ProviderFactory {
  private static registry = new Map<StorageProviderType, ProviderConstructor>();

  public static register(type: StorageProviderType, ctor: ProviderConstructor): void {
    this.registry.set(type, ctor);
  }

  public static create(type: StorageProviderType, config?: Partial<StorageProviderConfig>): StorageProvider {
    const ProviderClass = this.registry.get(type);
    if (!ProviderClass) {
      throw new ValidationError(`Unsupported storage provider type: '${type}'`);
    }
    return new ProviderClass(config);
  }

  public static getSupportedTypes(): StorageProviderType[] {
    return Array.from(this.registry.keys());
  }
}

// Register initial provider
ProviderFactory.register('google_drive', GoogleDriveProvider);
