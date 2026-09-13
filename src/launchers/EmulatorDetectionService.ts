import fs from 'node:fs';
import path from 'node:path';
import { EmulatorAdapter } from './types';
import { Emulator, EmulatorAdapterType, GamePlatform } from '../core/types';
import { EmulatorsRepository } from '../database/repositories/emulatorsRepository';
import { logger } from '../core/logger';

export interface DetectedEmulatorResult {
  adapterType: EmulatorAdapterType;
  name: string;
  executablePath: string;
  supportedPlatforms: GamePlatform[];
  version?: string;
}

export class EmulatorDetectionService {
  private log = logger.child('EmulatorDetectionService');

  constructor(
    private adapters: EmulatorAdapter[],
    private emulatorsRepo: EmulatorsRepository
  ) {}

  public async detectAll(customPaths: string[] = []): Promise<DetectedEmulatorResult[]> {
    const results: DetectedEmulatorResult[] = [];
    const seenPaths = new Set<string>();

    for (const adapter of this.adapters) {
      const searchDirs = [...adapter.getStandardSearchPaths(), ...customPaths];

      for (const dir of searchDirs) {
        if (!dir || !fs.existsSync(dir)) continue;

        try {
          const stat = fs.statSync(dir);
          if (!stat.isDirectory()) continue;

          for (const exeName of adapter.getDefaultExecutableNames()) {
            const candidate = path.join(dir, exeName);
            if (seenPaths.has(candidate.toLowerCase())) continue;

            if (fs.existsSync(candidate)) {
              const validation = await adapter.validateExecutable(candidate);
              if (validation.valid) {
                seenPaths.add(candidate.toLowerCase());
                results.push({
                  adapterType: adapter.id,
                  name: adapter.name,
                  executablePath: candidate,
                  supportedPlatforms: adapter.supportedPlatforms,
                  version: validation.version
                });
                break; // Found primary executable for this folder
              }
            }
          }
        } catch {
          // Ignore permission or file read errors
        }
      }
    }

    return results;
  }

  public async autoDetectAndPersist(customPaths: string[] = []): Promise<Emulator[]> {
    const detectedList = await this.detectAll(customPaths);
    const savedEmulators: Emulator[] = [];

    for (const item of detectedList) {
      const id = `emu_${item.adapterType}`;
      const existing = this.emulatorsRepo.getById(id);

      const emu: Emulator = {
        id,
        name: item.name,
        adapterType: item.adapterType,
        executablePath: item.executablePath,
        supportedPlatforms: item.supportedPlatforms,
        detected: true,
        enabled: existing ? existing.enabled : true,
        defaultArgs: existing?.defaultArgs,
        fullscreenArgs: existing?.fullscreenArgs,
        version: item.version || existing?.version,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      this.emulatorsRepo.upsert(emu);
      savedEmulators.push(emu);
      this.log.info(`Auto-detected and registered emulator: ${emu.name} -> ${emu.executablePath}`);
    }

    return savedEmulators;
  }

  public async registerManualEmulator(params: {
    name?: string;
    executablePath: string;
    adapterType?: EmulatorAdapterType;
    supportedPlatforms?: GamePlatform[];
  }): Promise<Emulator> {
    const exePath = path.resolve(params.executablePath);
    if (!fs.existsSync(exePath)) {
      throw new Error(`Executable file does not exist at "${exePath}".`);
    }

    const stat = fs.statSync(exePath);
    if (!stat.isFile()) {
      throw new Error(`Specified path is not a file: "${exePath}".`);
    }

    // Determine adapterType if not specified
    let adapterType = params.adapterType;
    let adapter = adapterType ? this.adapters.find((a) => a.id === adapterType) : undefined;

    if (!adapter) {
      const fileName = path.basename(exePath).toLowerCase();
      adapter = this.adapters.find((a) =>
        a.getDefaultExecutableNames().some((name) => fileName.includes(name.replace('.exe', '').toLowerCase()))
      );
      if (adapter) {
        adapterType = adapter.id;
      } else {
        adapterType = 'custom';
      }
    }

    const platforms = params.supportedPlatforms || adapter?.supportedPlatforms || [];
    const name = params.name || adapter?.name || path.basename(exePath, path.extname(exePath));
    const id = `emu_${adapterType}_${Date.now().toString(36)}`;

    const emu: Emulator = {
      id,
      name,
      adapterType: adapterType as EmulatorAdapterType,
      executablePath: exePath,
      supportedPlatforms: platforms,
      detected: false,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.emulatorsRepo.upsert(emu);
    this.log.info(`Manually registered emulator: ${emu.name} (${emu.id}) -> ${emu.executablePath}`);
    return emu;
  }
}
