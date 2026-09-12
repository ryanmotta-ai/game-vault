import { GamesRepository } from '../database/repositories/gamesRepository';
import { StorageAccountsRepository } from '../database/repositories/storageAccountsRepository';
import { Game, StorageAccount } from '../core/types';
import { logger } from '../core/logger';

export function seedInitialDataIfEmpty(gamesRepo: GamesRepository, accountsRepo: StorageAccountsRepository): void {
  const log = logger.child('Seed');
  const existingAccounts = accountsRepo.getAll();

  if (existingAccounts.length === 0) {
    log.info('Seeding initial storage accounts...');
    const primaryAccount: StorageAccount = {
      id: 'gdrive-primary',
      providerType: 'google_drive',
      providerAccountId: 'seed-gdrive-primary',
      accountName: 'Google Drive (Primary)',
      accountEmail: 'gamer.vault@gmail.com',
      credentialKey: 'gdrive:seed-primary',
      status: 'ACTIVE',
      quotaTotalBytes: 2 * 1024 * 1024 * 1024 * 1024, // 2 TB
      quotaUsedBytes: 247 * 1024 * 1024 * 1024, // 247 GB
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastAuthenticatedAt: new Date().toISOString()
    };
    accountsRepo.upsert(primaryAccount);
  }

  const existingGames = gamesRepo.getAll();
  if (existingGames.length === 0) {
    log.info('Seeding initial mock games for visual library verification...');

    const mockGames: Game[] = [
      {
        id: 'game-1',
        title: 'Cyberpunk 2077',
        slug: 'cyberpunk-2077',
        description: 'An open-world, action-adventure RPG set in the megalopolis of Night City.',
        coverUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80',
        bannerUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&auto=format&fit=crop&q=80',
        platform: 'PC',
        releaseYear: 2020,
        developer: 'CD PROJEKT RED',
        publisher: 'CD PROJEKT RED',
        state: 'READY',
        sizeBytes: 70 * 1024 * 1024 * 1024, // 70 GB
        installedPath: 'C:\\Games\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe',
        playTimeSeconds: 14200,
        lastPlayedAt: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'game-2',
        title: 'Elden Ring: Shadow of the Erdtree',
        slug: 'elden-ring',
        description: 'Rise, Tarnished, and be guided by grace to brandish the power of the Elden Ring.',
        coverUrl: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=600&auto=format&fit=crop&q=80',
        bannerUrl: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=1200&auto=format&fit=crop&q=80',
        platform: 'PC',
        releaseYear: 2024,
        developer: 'FromSoftware Inc.',
        publisher: 'Bandai Namco',
        state: 'DOWNLOADING',
        sizeBytes: 58 * 1024 * 1024 * 1024, // 58 GB
        playTimeSeconds: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'game-3',
        title: 'The Legend of Zelda: Tears of the Kingdom',
        slug: 'zelda-totk',
        description: 'An epic adventure across the land and skies of Hyrule awaits in this monumental sequel.',
        coverUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=80',
        platform: 'Nintendo Switch',
        releaseYear: 2023,
        developer: 'Nintendo',
        publisher: 'Nintendo',
        state: 'CLOUD',
        sizeBytes: 16 * 1024 * 1024 * 1024, // 16 GB
        playTimeSeconds: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'game-4',
        title: 'Shadow of the Colossus',
        slug: 'shadow-of-the-colossus',
        description: 'Tales speak of an ancient realm where Colossi roam the majestic landscape.',
        coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop&q=80',
        platform: 'PlayStation 2',
        releaseYear: 2005,
        developer: 'Team Ico',
        publisher: 'Sony Computer Entertainment',
        state: 'READY',
        sizeBytes: 3800 * 1024 * 1024, // 3.8 GB
        installedPath: 'C:\\Games\\Emulation\\PS2\\ROMs\\sotc.iso',
        playTimeSeconds: 7800,
        lastPlayedAt: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'game-5',
        title: 'God of War: Ragnarök',
        slug: 'god-of-war-ragnarok',
        description: 'Kratos and Atreus embark on a mythic journey for answers before Ragnarök arrives.',
        coverUrl: 'https://images.unsplash.com/photo-1579373903781-fd5c0c30c4cd?w=600&auto=format&fit=crop&q=80',
        platform: 'PC',
        releaseYear: 2024,
        developer: 'Santa Monica Studio',
        publisher: 'PlayStation Publishing',
        state: 'CLOUD',
        sizeBytes: 84 * 1024 * 1024 * 1024, // 84 GB
        playTimeSeconds: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'game-6',
        title: 'Metroid Fusion',
        slug: 'metroid-fusion',
        description: 'Samus Aran investigates a biological research station infested with lethal X parasites.',
        coverUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80',
        platform: 'Game Boy Advance',
        releaseYear: 2002,
        developer: 'Nintendo R&D1',
        publisher: 'Nintendo',
        state: 'READY',
        sizeBytes: 16 * 1024 * 1024, // 16 MB
        installedPath: 'C:\\Games\\Emulation\\GBA\\ROMs\\metroid_fusion.gba',
        playTimeSeconds: 15400,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    for (const game of mockGames) {
      gamesRepo.upsert(game);
    }
    log.info(`Seeded ${mockGames.length} initial games.`);
  }
}
