import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

import { initializeDatabaseSchema } from '../src/database/schema';
import { GamesRepository } from '../src/database/repositories/gamesRepository';
import { GameManifestsRepository } from '../src/database/repositories/gameManifestsRepository';
import { LaunchProfilesRepository } from '../src/database/repositories/launchProfilesRepository';
import { EmulatorsRepository } from '../src/database/repositories/emulatorsRepository';
import { GameSessionsRepository } from '../src/database/repositories/gameSessionsRepository';

import { LauncherManager } from '../src/launchers/LauncherManager';
import { ProcessMonitor } from '../src/launchers/ProcessMonitor';
import { EmulatorLauncher } from '../src/launchers/EmulatorLauncher';
import { NativePcLauncher } from '../src/launchers/NativePcLauncher';
import { EmulatorDetectionService } from '../src/launchers/EmulatorDetectionService';

import { PCSX2Adapter } from '../src/launchers/adapters/PCSX2Adapter';
import { DuckStationAdapter } from '../src/launchers/adapters/DuckStationAdapter';
import { DolphinAdapter } from '../src/launchers/adapters/DolphinAdapter';
import { PPSSPPAdapter } from '../src/launchers/adapters/PPSSPPAdapter';
import { RetroArchAdapter } from '../src/launchers/adapters/RetroArchAdapter';

import {
  Game,
  Emulator,
  GameRunningStateEvent,
  GamePlatform
} from '../src/core/types';

import {
  LauncherError,
  RomNotFoundError,
  CoreNotFoundError,
  GameAlreadyRunningError,
  ExecutableInaccessibleError,
  NotFoundError
} from '../src/core/errors/AppError';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

const TEST_DIR = path.resolve(__dirname, '../.test_phase4a_tmp');
const MOCK_RUNNER_EXE = path.join(TEST_DIR, 'mock_runner.exe');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup locks
    }
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function compileMockRunner() {
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  const csharpSource = `
using System;
using System.IO;
using System.Threading;

class MockRunner {
    static int Main(string[] args) {
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "--crash") return 42;
            if (args[i] == "--sleep" && i + 1 < args.Length) {
                int ms;
                if (int.TryParse(args[i + 1], out ms)) Thread.Sleep(ms);
            }
            if (args[i] == "--dump-args" && i + 1 < args.Length) {
                File.WriteAllLines(args[i + 1], args);
            }
        }
        return 0;
    }
}
`;
  const csFile = path.join(TEST_DIR, 'mock_runner.cs');
  fs.writeFileSync(csFile, csharpSource, 'utf8');

  const res = spawnSync(cscPath, ['/nologo', `/out:${MOCK_RUNNER_EXE}`, csFile], {
    cwd: TEST_DIR,
    encoding: 'utf8'
  });

  if (res.status !== 0 || !fs.existsSync(MOCK_RUNNER_EXE)) {
    throw new Error(`Failed to compile mock_runner.exe: ${res.stderr || res.stdout}`);
  }

  try {
    fs.unlinkSync(csFile);
  } catch {}
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabaseSchema(db);

  db.prepare(`
    INSERT OR IGNORE INTO storage_accounts (id, provider_type, account_name, status, created_at, updated_at)
    VALUES ('acc-1', 'google_drive', 'Account Alpha', 'ACTIVE', datetime('now'), datetime('now')),
           ('acc-2', 'google_drive', 'Account Beta', 'ACTIVE', datetime('now'), datetime('now'))
  `).run();

  return db;
}

function createMockGame(
  repo: GamesRepository,
  overrides: Partial<Game> & { title: string; platform: GamePlatform }
): Game {
  const id = overrides.id || `game_${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date().toISOString();
  const game: Game = {
    id,
    title: overrides.title,
    slug: overrides.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    platform: overrides.platform,
    state: overrides.state || 'READY',
    sizeBytes: overrides.sizeBytes || 1024,
    playTimeSeconds: overrides.playTimeSeconds || 0,
    pinned: overrides.pinned || false,
    createdAt: now,
    updatedAt: now,
    installedPath: overrides.installedPath,
    lastAccessedAt: overrides.lastAccessedAt,
    lastPlayedAt: overrides.lastPlayedAt,
    coverUrl: overrides.coverUrl
  };
  repo.upsert(game);
  return game;
}

function createMockEmulator(
  repo: EmulatorsRepository,
  overrides: Partial<Emulator> & { name: string; executablePath: string; adapterType: any; supportedPlatforms: GamePlatform[] }
): Emulator {
  const id = overrides.id || `emu_${overrides.adapterType}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const emu: Emulator = {
    id,
    name: overrides.name,
    adapterType: overrides.adapterType,
    executablePath: overrides.executablePath,
    supportedPlatforms: overrides.supportedPlatforms,
    defaultArgs: overrides.defaultArgs,
    fullscreenArgs: overrides.fullscreenArgs,
    workingDirectory: overrides.workingDirectory,
    version: overrides.version || '1.0.0',
    detected: overrides.detected !== undefined ? overrides.detected : true,
    enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    createdAt: now,
    updatedAt: now
  };
  repo.upsert(emu);
  return emu;
}

async function runAllTests() {
  console.log('================================================================');
  console.log('  GAME VAULT — PHASE 4A LAUNCHER ENGINE & EMULATOR SUITE');
  console.log('================================================================\n');

  cleanTestDir();
  console.log('[Setup] Compiling native mock runner binary...');
  compileMockRunner();
  console.log(`[Setup] Native mock runner ready at: ${MOCK_RUNNER_EXE}\n`);

  // Setup mock emulators and files
  const mockEmuDir = path.join(TEST_DIR, 'mock_emulators');
  fs.mkdirSync(mockEmuDir, { recursive: true });

  const pcsx2Exe = path.join(mockEmuDir, 'pcsx2.exe');
  const duckstationExe = path.join(mockEmuDir, 'duckstation.exe');
  const dolphinExe = path.join(mockEmuDir, 'Dolphin.exe');
  const ppssppExe = path.join(mockEmuDir, 'PPSSPPWindows64.exe');
  const retroarchExe = path.join(mockEmuDir, 'retroarch.exe');

  fs.copyFileSync(MOCK_RUNNER_EXE, pcsx2Exe);
  fs.copyFileSync(MOCK_RUNNER_EXE, duckstationExe);
  fs.copyFileSync(MOCK_RUNNER_EXE, dolphinExe);
  fs.copyFileSync(MOCK_RUNNER_EXE, ppssppExe);
  fs.copyFileSync(MOCK_RUNNER_EXE, retroarchExe);

  // Setup RetroArch cores directory
  const coresDir = path.join(mockEmuDir, 'cores');
  fs.mkdirSync(coresDir, { recursive: true });
  const snesCore = path.join(coresDir, 'snes9x_libretro.dll');
  const mesenCore = path.join(coresDir, 'mesen_libretro.dll');
  fs.writeFileSync(snesCore, 'dummy snes core');
  fs.writeFileSync(mesenCore, 'dummy nes core');

  // Setup mock games and roms
  const mockGamesDir = path.join(TEST_DIR, 'mock_games');
  fs.mkdirSync(mockGamesDir, { recursive: true });

  const gt4Rom = path.join(mockGamesDir, 'Gran Turismo 4.chd');
  const tekkenRom = path.join(mockGamesDir, 'Tekken 3.iso');
  const smashRom = path.join(mockGamesDir, 'Super Smash Bros Melee.iso');
  const marioGalaxyRom = path.join(mockGamesDir, 'Super Mario Galaxy.wbfs');
  const crisisCoreRom = path.join(mockGamesDir, 'Crisis Core.iso');
  const marioWorldRom = path.join(mockGamesDir, 'Super Mario World.sfc');
  const marioBrosRom = path.join(mockGamesDir, 'Super Mario Bros.nes');

  fs.writeFileSync(gt4Rom, 'dummy gt4 rom');
  fs.writeFileSync(tekkenRom, 'dummy tekken rom');
  fs.writeFileSync(smashRom, 'dummy smash rom');
  fs.writeFileSync(marioGalaxyRom, 'dummy mario galaxy rom');
  fs.writeFileSync(crisisCoreRom, 'dummy crisis core rom');
  fs.writeFileSync(marioWorldRom, 'dummy mario world rom');
  fs.writeFileSync(marioBrosRom, 'dummy mario bros rom');

  // Setup mock PC game
  const pcGameDir = path.join(mockGamesDir, 'Portal');
  fs.mkdirSync(pcGameDir, { recursive: true });
  const pcGameExe = path.join(pcGameDir, 'portal.exe');
  fs.copyFileSync(MOCK_RUNNER_EXE, pcGameExe);

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`[FAIL] ${name}`);
      console.error(`       Error: ${err.message}`);
      if (err.stack) {
        console.error(`       Stack: ${err.stack.split('\n').slice(1, 4).join('\n')}`);
      }
    }
  }

  // --- Group 1: Launcher & Adapter Selection (Scenarios 1-7) ---

  await test('Scenario 01: Launcher selection PS2 -> PCSX2', async () => {
    const db = createTestDb();
    const emuRepo = new EmulatorsRepository(db);
    const emuLauncher = new EmulatorLauncher(emuRepo);

    const adapter = emuLauncher.getAdapterForPlatform('PlayStation 2');
    assert(adapter !== undefined, 'Adapter for PS2 must be found');
    assert(adapter.id === 'pcsx2', `Expected adapter id 'pcsx2', got ${adapter.id}`);
    assert(adapter.name.includes('PCSX2'), 'Adapter name must mention PCSX2');
  });

  await test('Scenario 02: Launcher selection PS1 -> DuckStation', async () => {
    const db = createTestDb();
    const emuRepo = new EmulatorsRepository(db);
    const emuLauncher = new EmulatorLauncher(emuRepo);

    const adapter = emuLauncher.getAdapterForPlatform('PlayStation');
    assert(adapter !== undefined, 'Adapter for PlayStation must be found');
    assert(adapter.id === 'duckstation', `Expected adapter id 'duckstation', got ${adapter.id}`);
  });

  await test('Scenario 03: Launcher selection GameCube -> Dolphin', async () => {
    const db = createTestDb();
    const emuRepo = new EmulatorsRepository(db);
    const emuLauncher = new EmulatorLauncher(emuRepo);

    const adapter = emuLauncher.getAdapterForPlatform('GameCube');
    assert(adapter !== undefined, 'Adapter for GameCube must be found');
    assert(adapter.id === 'dolphin', `Expected adapter id 'dolphin', got ${adapter.id}`);
  });

  await test('Scenario 04: Launcher selection Wii -> Dolphin', async () => {
    const db = createTestDb();
    const emuRepo = new EmulatorsRepository(db);
    const emuLauncher = new EmulatorLauncher(emuRepo);

    const adapter = emuLauncher.getAdapterForPlatform('Wii');
    assert(adapter !== undefined, 'Adapter for Wii must be found');
    assert(adapter.id === 'dolphin', `Expected adapter id 'dolphin', got ${adapter.id}`);
  });

  await test('Scenario 05: Launcher selection PSP -> PPSSPP', async () => {
    const db = createTestDb();
    const emuRepo = new EmulatorsRepository(db);
    const emuLauncher = new EmulatorLauncher(emuRepo);

    const adapter = emuLauncher.getAdapterForPlatform('PSP');
    assert(adapter !== undefined, 'Adapter for PSP must be found');
    assert(adapter.id === 'ppsspp', `Expected adapter id 'ppsspp', got ${adapter.id}`);
  });

  await test('Scenario 06: Launcher selection NES / SNES / GB / GBC / GBA / N64 -> RetroArch', async () => {
    const db = createTestDb();
    const emuRepo = new EmulatorsRepository(db);
    const emuLauncher = new EmulatorLauncher(emuRepo);

    const platforms: GamePlatform[] = ['NES', 'SNES', 'Game Boy', 'Game Boy Color', 'Game Boy Advance', 'Nintendo 64'];
    for (const p of platforms) {
      const adapter = emuLauncher.getAdapterForPlatform(p);
      assert(adapter !== undefined, `Adapter for ${p} must be found`);
      assert(adapter.id === 'retroarch', `Expected adapter 'retroarch' for ${p}, got ${adapter.id}`);
    }
  });

  await test('Scenario 07: Native PC launcher selection', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const profilesRepo = new LaunchProfilesRepository(db);
    const emuRepo = new EmulatorsRepository(db);
    const sessionsRepo = new GameSessionsRepository(db);
    const launcherManager = new LauncherManager(gamesRepo, manifestsRepo, profilesRepo, emuRepo, sessionsRepo);

    const pcGame = createMockGame(gamesRepo, {
      title: 'Portal',
      platform: 'PC',
      installedPath: pcGameExe
    });

    const launcher = launcherManager.selectLauncher(pcGame, null);
    assert(launcher.type === 'native_pc', `Expected native_pc launcher, got ${launcher.type}`);
    assert(launcher instanceof NativePcLauncher, 'Launcher must be instance of NativePcLauncher');
  });

  // --- Group 2: Error Handling & Validation (Scenarios 8-10) ---

  await test('Scenario 08: Missing emulator error handling', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const profilesRepo = new LaunchProfilesRepository(db);
    const emuRepo = new EmulatorsRepository(db); // Empty emulators repo!
    const sessionsRepo = new GameSessionsRepository(db);
    const launcherManager = new LauncherManager(gamesRepo, manifestsRepo, profilesRepo, emuRepo, sessionsRepo);

    const ps2Game = createMockGame(gamesRepo, {
      title: 'Gran Turismo 4',
      platform: 'PlayStation 2',
      installedPath: gt4Rom
    });

    // Profile validation should return invalid
    const effective = await launcherManager.getEffectiveProfile(ps2Game.id);
    assert(!effective.canLaunch, 'Should not be able to launch without configured emulator');
    assert(effective.validationError?.includes('No emulator configured'), 'Error should explain missing emulator');

    // Attempting to launch must throw LauncherError
    let threw = false;
    try {
      await launcherManager.launchGame(ps2Game.id);
    } catch (err: any) {
      threw = true;
      assert(err instanceof LauncherError, 'Must throw LauncherError');
      assert(err.message.includes('No emulator configured'), 'Message must explain missing emulator');
    }
    assert(threw, 'launchGame must throw when emulator is missing');
  });

  await test('Scenario 09: Missing ROM file on disk error handling & state reconciliation', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const profilesRepo = new LaunchProfilesRepository(db);
    const emuRepo = new EmulatorsRepository(db);
    const sessionsRepo = new GameSessionsRepository(db);
    const launcherManager = new LauncherManager(gamesRepo, manifestsRepo, profilesRepo, emuRepo, sessionsRepo);

    createMockEmulator(emuRepo, {
      name: 'PCSX2',
      executablePath: pcsx2Exe,
      adapterType: 'pcsx2',
      supportedPlatforms: ['PlayStation 2']
    });

    const deletedRomPath = path.join(mockGamesDir, 'GhostRom.chd');
    const ghostGame = createMockGame(gamesRepo, {
      title: 'Ghost Game',
      platform: 'PlayStation 2',
      state: 'READY',
      installedPath: deletedRomPath
    });

    let threw = false;
    try {
      await launcherManager.launchGame(ghostGame.id);
    } catch (err: any) {
      threw = true;
      assert(err instanceof RomNotFoundError, `Expected RomNotFoundError, got ${err.name}: ${err.message}`);
    }
    assert(threw, 'Must throw when ROM is missing on disk');

    // Verify game state was reconciled to CLOUD in DB
    const updatedGame = gamesRepo.getById(ghostGame.id);
    assert(updatedGame?.state === 'CLOUD', `Game state must be reconciled to CLOUD, got ${updatedGame?.state}`);
  });

  await test('Scenario 10: Invalid launch profile fallback to default platform emulator', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const profilesRepo = new LaunchProfilesRepository(db);
    const emuRepo = new EmulatorsRepository(db);

    const validEmu = createMockEmulator(emuRepo, {
      id: 'emu_default_pcsx2',
      name: 'PCSX2 Default',
      executablePath: pcsx2Exe,
      adapterType: 'pcsx2',
      supportedPlatforms: ['PlayStation 2'],
      enabled: true
    });

    const disabledEmu = createMockEmulator(emuRepo, {
      id: 'emu_disabled_pcsx2',
      name: 'PCSX2 Disabled',
      executablePath: pcsx2Exe,
      adapterType: 'pcsx2',
      supportedPlatforms: ['PlayStation 2'],
      enabled: false
    });

    const game = createMockGame(gamesRepo, {
      title: 'Gran Turismo 4',
      platform: 'PlayStation 2',
      installedPath: gt4Rom
    });

    // Profile points to disabled emulatorId
    profilesRepo.upsert({
      id: `lp_${game.id}`,
      gameId: game.id,
      launcherType: 'emulator',
      emulatorId: disabledEmu.id,
      fullscreen: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const emuLauncher = new EmulatorLauncher(emuRepo);
    const profile = profilesRepo.getByGameId(game.id);
    const resolved = emuLauncher.resolveEmulatorForGame(game, profile);

    assert(resolved !== null, 'Should fallback to default emulator');
    assert(resolved?.id === validEmu.id, `Expected fallback to ${validEmu.id}, got ${resolved?.id}`);
  });

  // --- Group 3: Command Generation & Zero Shell Injection (Scenarios 11-14) ---

  await test('Scenario 11: Safe args with spaces in path', async () => {
    const spacesDir = path.join(TEST_DIR, 'Games with Spaces', 'Gran Turismo 4');
    fs.mkdirSync(spacesDir, { recursive: true });
    const spacedRom = path.join(spacesDir, 'GT4 Spec II.chd');
    fs.writeFileSync(spacedRom, 'dummy spaced rom');

    const adapter = new PCSX2Adapter();
    const args = adapter.buildArgs({
      romPath: spacedRom,
      game: { id: 'g1', title: 'GT4', platform: 'PlayStation 2' } as any,
      emulator: { executablePath: pcsx2Exe, adapterType: 'pcsx2' } as any,
      profile: { fullscreen: true } as any
    });

    // Spaced rom path must be an EXACT element of the array without quotes or split tokens
    assert(args.includes(spacedRom), 'ROM path with spaces must be passed as an unbroken element');
    const romIndex = args.indexOf(spacedRom);
    assert(args[romIndex - 1] === '--', 'Preceding argument must be -- delimiter');
  });

  await test('Scenario 12: Safe args with unicode characters', async () => {
    const unicodeDir = path.join(TEST_DIR, 'Jogos_日本語_🎮');
    fs.mkdirSync(unicodeDir, { recursive: true });
    const unicodeRom = path.join(unicodeDir, 'ポケットモンスター_緑.chd');
    fs.writeFileSync(unicodeRom, 'dummy unicode rom');

    const adapter = new PCSX2Adapter();
    const args = adapter.buildArgs({
      romPath: unicodeRom,
      game: { id: 'g2', title: 'Pokemon', platform: 'PlayStation 2' } as any,
      emulator: { executablePath: pcsx2Exe, adapterType: 'pcsx2' } as any,
      profile: { fullscreen: false } as any
    });

    assert(args.includes(unicodeRom), 'Unicode path must be intact and uncorrupted in args array');
  });

  await test('Scenario 13: Command injection string harmless', async () => {
    // Malicious injection attempt as argument
    const maliciousArg = 'game.iso; calc.exe && echo PWNED > hack.txt';

    const dumpOutputFile = path.join(TEST_DIR, 'injection_dump.txt');
    const hackMarkerFile = path.join(TEST_DIR, 'hack.txt');

    // Run mock runner directly via child_process.spawn with shell: false
    const child = spawnSync(MOCK_RUNNER_EXE, [
      '--dump-args',
      dumpOutputFile,
      maliciousArg
    ], {
      shell: false,
      cwd: TEST_DIR
    });

    assert(child.status === 0, 'Process must exit normally');
    assert(!fs.existsSync(hackMarkerFile), 'Shell injection must NOT execute any sub-commands');
    assert(fs.existsSync(dumpOutputFile), 'Dump file must exist');

    const dumpedLines = fs.readFileSync(dumpOutputFile, 'utf8').trim().split(/\r?\n/);
    assert(dumpedLines.includes(maliciousArg), 'Argument must be received purely as literal string');
  });

  await test('Scenario 14: Spawn called with shell: false verified', async () => {
    const db = createTestDb();
    const sessionsRepo = new GameSessionsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const monitor = new ProcessMonitor(sessionsRepo, gamesRepo);

    const game = createMockGame(gamesRepo, {
      title: 'Portal',
      platform: 'PC',
      installedPath: pcGameExe
    });

    const dumpArgsFile = path.join(TEST_DIR, 'shell_false_dump.txt');
    const session = await monitor.launchProcess(
      {
        executable: pcGameExe,
        args: ['--dump-args', dumpArgsFile, 'literal & calc.exe'],
        cwd: pcGameDir
      },
      game,
      'native_pc'
    );

    assert(session !== null, 'Session must be returned');
    await sleep(200);

    assert(fs.existsSync(dumpArgsFile), 'Process must run cleanly without shell');
    const dumped = fs.readFileSync(dumpArgsFile, 'utf8');
    assert(dumped.includes('literal & calc.exe'), 'Ampersand must be treated as literal argument');
  });

  // --- Group 4: Adapter CLI Construction (Scenarios 15-20) ---

  await test('Scenario 15: PCSX2 CLI args construction', async () => {
    const adapter = new PCSX2Adapter();
    const args = adapter.buildArgs({
      romPath: gt4Rom,
      game: { id: 'g-ps2', title: 'Gran Turismo 4', platform: 'PlayStation 2' } as any,
      emulator: { executablePath: pcsx2Exe, adapterType: 'pcsx2' } as any,
      profile: { fullscreen: true } as any
    });

    assert(args.includes('-fullscreen'), 'Must include -fullscreen when profile fullscreen is true');
    assert(args.includes('-batch'), 'Must include -batch');
    assert(args.includes('--'), 'Must include -- delimiter');
    assert(args[args.length - 1] === gt4Rom, 'Last argument must be ROM path');
  });

  await test('Scenario 16: Dolphin CLI args construction', async () => {
    const adapter = new DolphinAdapter();
    const args = adapter.buildArgs({
      romPath: smashRom,
      game: { id: 'g-gc', title: 'Smash Melee', platform: 'GameCube' } as any,
      emulator: { executablePath: dolphinExe, adapterType: 'dolphin' } as any,
      profile: { fullscreen: true } as any
    });

    assert(args.includes('-b'), 'Must include -b batch flag');
    assert(args.includes('-f'), 'Must include -f fullscreen flag');
    assert(args.includes('-e'), 'Must include -e execute flag');
    const eIndex = args.indexOf('-e');
    assert(args[eIndex + 1] === smashRom, 'ROM path must immediately follow -e');
  });

  await test('Scenario 17: DuckStation CLI args construction', async () => {
    const adapter = new DuckStationAdapter();
    const args = adapter.buildArgs({
      romPath: tekkenRom,
      game: { id: 'g-ps1', title: 'Tekken 3', platform: 'PlayStation' } as any,
      emulator: { executablePath: duckstationExe, adapterType: 'duckstation' } as any,
      profile: { fullscreen: true } as any
    });

    assert(args.includes('-batch'), 'Must include -batch');
    assert(args.includes('-fullscreen'), 'Must include -fullscreen');
    assert(args.includes('--'), 'Must include -- delimiter');
    assert(args[args.length - 1] === tekkenRom, 'Last argument must be ROM path');
  });

  await test('Scenario 18: PPSSPP CLI args construction', async () => {
    const adapter = new PPSSPPAdapter();
    const args = adapter.buildArgs({
      romPath: crisisCoreRom,
      game: { id: 'g-psp', title: 'Crisis Core', platform: 'PSP' } as any,
      emulator: { executablePath: ppssppExe, adapterType: 'ppsspp' } as any,
      profile: { fullscreen: true } as any
    });

    assert(args.includes('--fullscreen'), 'Must include --fullscreen');
    assert(args[args.length - 1] === crisisCoreRom, 'Last argument must be ROM path');
  });

  await test('Scenario 19: RetroArch core resolution and args', async () => {
    const adapter = new RetroArchAdapter();
    const args = adapter.buildArgs({
      romPath: marioWorldRom,
      game: { id: 'g-snes', title: 'Super Mario World', platform: 'SNES' } as any,
      emulator: {
        executablePath: retroarchExe,
        adapterType: 'retroarch',
        workingDirectory: mockEmuDir
      } as any,
      profile: { fullscreen: true } as any
    });

    assert(args.includes('-L'), 'Must include -L flag for core');
    const lIndex = args.indexOf('-L');
    assert(args[lIndex + 1] === snesCore, `Expected core path ${snesCore}, got ${args[lIndex + 1]}`);
    assert(args.includes('-f'), 'Must include -f flag');
    assert(args[args.length - 1] === marioWorldRom, 'Last argument must be ROM path');
  });

  await test('Scenario 20: Missing RetroArch core detection and error', async () => {
    const adapter = new RetroArchAdapter();
    let threw = false;

    try {
      // Nintendo 64 core does not exist in mock cores folder
      adapter.buildArgs({
        romPath: path.join(mockGamesDir, 'mario64.z64'),
        game: { id: 'g-n64', title: 'Mario 64', platform: 'Nintendo 64' } as any,
        emulator: {
          executablePath: retroarchExe,
          adapterType: 'retroarch',
          workingDirectory: mockEmuDir
        } as any,
        profile: { fullscreen: true } as any
      });
    } catch (err: any) {
      threw = true;
      assert(err instanceof CoreNotFoundError, `Expected CoreNotFoundError, got ${err.name}`);
      assert(err.message.includes('Nintendo 64'), 'Message should indicate platform');
    }
    assert(threw, 'Must throw CoreNotFoundError when core is absent');
  });

  // --- Group 5: Process Lifecycle & Session Tracking (Scenarios 21-25) ---

  await test('Scenario 21: Session starts and records started_at in SQLite', async () => {
    const db = createTestDb();
    const sessionsRepo = new GameSessionsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const monitor = new ProcessMonitor(sessionsRepo, gamesRepo);

    const game = createMockGame(gamesRepo, {
      title: 'Session Test Game',
      platform: 'PC',
      installedPath: pcGameExe
    });

    const session = await monitor.launchProcess(
      {
        executable: pcGameExe,
        args: ['--sleep', '300'],
        cwd: pcGameDir
      },
      game,
      'native_pc'
    );

    assert(session.id.startsWith('sess_'), 'Session ID must start with sess_');
    assert(session.gameId === game.id, 'Session gameId must match');

    // Verify row in SQLite
    const row = sessionsRepo.getById(session.id);
    assert(row !== null, 'Session must exist in database');
    assert(row?.startedAt !== undefined, 'started_at must be populated');
    assert(row?.endedAt === undefined || row?.endedAt === null, 'ended_at must be null while running');
  });

  await test('Scenario 22: Session ends on process exit and computes duration_seconds', async () => {
    const db = createTestDb();
    const sessionsRepo = new GameSessionsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const monitor = new ProcessMonitor(sessionsRepo, gamesRepo);

    const game = createMockGame(gamesRepo, {
      title: 'Exit Duration Test',
      platform: 'PC',
      installedPath: pcGameExe
    });

    const session = await monitor.launchProcess(
      {
        executable: pcGameExe,
        args: ['--sleep', '300'],
        cwd: pcGameDir
      },
      game,
      'native_pc'
    );

    // Wait for process to exit
    await sleep(500);

    const updatedSession = sessionsRepo.getById(session.id);
    assert(updatedSession !== null, 'Session must exist');
    assert(updatedSession?.endedAt !== null, 'ended_at must be recorded');
    assert(updatedSession?.durationSeconds !== undefined && updatedSession.durationSeconds >= 0, 'durationSeconds must be computed');
  });

  await test('Scenario 23: Playtime increments in games.play_time_seconds and games.last_played_at', async () => {
    const db = createTestDb();
    const sessionsRepo = new GameSessionsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const monitor = new ProcessMonitor(sessionsRepo, gamesRepo);

    const game = createMockGame(gamesRepo, {
      title: 'Playtime Increment Test',
      platform: 'PC',
      playTimeSeconds: 100,
      installedPath: pcGameExe
    });

    // Launch process that sleeps 1200ms
    await monitor.launchProcess(
      {
        executable: pcGameExe,
        args: ['--sleep', '1200'],
        cwd: pcGameDir
      },
      game,
      'native_pc'
    );

    await sleep(1500);

    const updatedGame = gamesRepo.getById(game.id);
    assert(updatedGame !== null, 'Game must exist');
    assert(
      (updatedGame?.playTimeSeconds || 0) >= 101,
      `Playtime should have incremented from 100, got ${updatedGame?.playTimeSeconds}`
    );
    assert(updatedGame?.lastPlayedAt !== null, 'lastPlayedAt must be set');
  });

  await test('Scenario 24: Exit code correctly stored in game_sessions', async () => {
    const db = createTestDb();
    const sessionsRepo = new GameSessionsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const monitor = new ProcessMonitor(sessionsRepo, gamesRepo);

    const game = createMockGame(gamesRepo, {
      title: 'Exit Code 0 Test',
      platform: 'PC',
      installedPath: pcGameExe
    });

    const session = await monitor.launchProcess(
      {
        executable: pcGameExe,
        args: ['--sleep', '100'],
        cwd: pcGameDir
      },
      game,
      'native_pc'
    );

    await sleep(300);

    const finished = sessionsRepo.getById(session.id);
    assert(finished?.exitCode === 0, `Expected exit code 0, got ${finished?.exitCode}`);
    assert(finished?.crashed === false, 'crashed must be false for exit code 0');
  });

  await test('Scenario 25: Abnormal exit / crash marked without losing session playtime', async () => {
    const db = createTestDb();
    const sessionsRepo = new GameSessionsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const monitor = new ProcessMonitor(sessionsRepo, gamesRepo);

    const game = createMockGame(gamesRepo, {
      title: 'Crash Test Game',
      platform: 'PC',
      playTimeSeconds: 50,
      installedPath: pcGameExe
    });

    // Process sleeps 1100ms and then returns code 42
    const session = await monitor.launchProcess(
      {
        executable: pcGameExe,
        args: ['--sleep', '1100', '--crash'],
        cwd: pcGameDir
      },
      game,
      'native_pc'
    );

    await sleep(1400);

    const finished = sessionsRepo.getById(session.id);
    assert(finished?.crashed === true, 'Session must be marked crashed');
    assert(finished?.exitCode === 42, `Exit code must be 42, got ${finished?.exitCode}`);

    const updatedGame = gamesRepo.getById(game.id);
    assert(
      (updatedGame?.playTimeSeconds || 0) >= 51,
      `Playtime must still be credited on crash, got ${updatedGame?.playTimeSeconds}`
    );
  });

  // --- Group 6: Concurrency & State Management (Scenarios 26-28) ---

  await test('Scenario 26: Duplicate launch prevented when game is already running', async () => {
    const db = createTestDb();
    const sessionsRepo = new GameSessionsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const monitor = new ProcessMonitor(sessionsRepo, gamesRepo);

    const game = createMockGame(gamesRepo, {
      title: 'Single Instance Game',
      platform: 'PC',
      installedPath: pcGameExe
    });

    await monitor.launchProcess(
      {
        executable: pcGameExe,
        args: ['--sleep', '600'],
        cwd: pcGameDir
      },
      game,
      'native_pc'
    );

    let threw = false;
    try {
      await monitor.launchProcess(
        {
          executable: pcGameExe,
          args: ['--sleep', '200'],
          cwd: pcGameDir
        },
        game,
        'native_pc'
      );
    } catch (err: any) {
      threw = true;
      assert(err instanceof GameAlreadyRunningError, `Expected GameAlreadyRunningError, got ${err.name}`);
    }
    assert(threw, 'Must prevent duplicate launch');

    await sleep(700); // Allow first process to finish
  });

  await test('Scenario 27: Game running state tracked in memory and emitted via event listener', async () => {
    const db = createTestDb();
    const sessionsRepo = new GameSessionsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const monitor = new ProcessMonitor(sessionsRepo, gamesRepo);

    const game = createMockGame(gamesRepo, {
      title: 'State Event Game',
      platform: 'PC',
      installedPath: pcGameExe
    });

    const events: GameRunningStateEvent[] = [];
    const unsubscribe = monitor.onRunningStateChange((evt) => {
      events.push(evt);
    });

    assert(!monitor.isGameRunning(game.id), 'Game should initially not be running');

    await monitor.launchProcess(
      {
        executable: pcGameExe,
        args: ['--sleep', '300'],
        cwd: pcGameDir
      },
      game,
      'native_pc'
    );

    assert(monitor.isGameRunning(game.id), 'Game should be running after launch');
    assert(monitor.getRunningGames().includes(game.id), 'Running games list must contain gameId');

    await sleep(500);

    assert(!monitor.isGameRunning(game.id), 'Game should not be running after process exits');
    assert(events.length >= 2, `Expected at least 2 events, got ${events.length}`);
    assert(events[0].isRunning === true, 'First event must be isRunning: true');
    assert(events[1].isRunning === false, 'Second event must be isRunning: false');

    unsubscribe();
  });

  await test('Scenario 28: Pre-launch local validation', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const profilesRepo = new LaunchProfilesRepository(db);
    const emuRepo = new EmulatorsRepository(db);
    const sessionsRepo = new GameSessionsRepository(db);
    const launcherManager = new LauncherManager(gamesRepo, manifestsRepo, profilesRepo, emuRepo, sessionsRepo);

    createMockEmulator(emuRepo, {
      name: 'PCSX2',
      executablePath: pcsx2Exe,
      adapterType: 'pcsx2',
      supportedPlatforms: ['PlayStation 2']
    });

    // Case A: Game in DOWNLOADING state cannot launch
    const downloadingGame = createMockGame(gamesRepo, {
      title: 'Downloading GT4',
      platform: 'PlayStation 2',
      state: 'DOWNLOADING',
      installedPath: gt4Rom
    });

    let threw = false;
    try {
      await launcherManager.launchGame(downloadingGame.id);
    } catch (err: any) {
      threw = true;
      assert(err instanceof LauncherError, 'Must throw LauncherError for non-READY game');
      assert(err.message.includes('DOWNLOADING'), 'Error must specify current state');
    }
    assert(threw, 'Should block launch when not READY');

    // Case B: Game in READY state passes validation
    const readyGame = createMockGame(gamesRepo, {
      title: 'Valid Ready GT4',
      platform: 'PlayStation 2',
      state: 'READY',
      installedPath: gt4Rom
    });

    const effective = await launcherManager.getEffectiveProfile(readyGame.id);
    assert(effective.canLaunch, `Validation should pass for valid game, got: ${effective.validationError}`);
  });

  // --- Group 7: Emulator Detection & Management (Scenarios 29-32) ---

  await test('Scenario 29: Emulator detection service discovers binaries in standard mock paths', async () => {
    const db = createTestDb();
    const emuRepo = new EmulatorsRepository(db);
    const emuLauncher = new EmulatorLauncher(emuRepo);
    const detectionService = new EmulatorDetectionService(emuLauncher.getAllAdapters(), emuRepo);

    const detected = await detectionService.detectAll([mockEmuDir]);
    assert(detected.length > 0, 'Should detect emulators in mock directory');

    const pcsx2 = detected.find((d) => d.adapterType === 'pcsx2');
    assert(pcsx2 !== undefined, 'Should detect PCSX2 in mock directory');
    assert(pcsx2.executablePath.toLowerCase().includes('pcsx2.exe'), 'Detected path must be pcsx2.exe');

    // Auto-detect and persist
    const saved = await detectionService.autoDetectAndPersist([mockEmuDir]);
    assert(saved.length > 0, 'Should save detected emulators');
    const stored = emuRepo.getById('emu_pcsx2');
    assert(stored !== null, 'PCSX2 must be stored in database');
    assert(stored?.detected === true, 'Stored emulator must have detected = true');
  });

  await test('Scenario 30: Manually configured emulator path persistence', async () => {
    const db = createTestDb();
    const emuRepo = new EmulatorsRepository(db);
    const emuLauncher = new EmulatorLauncher(emuRepo);
    const detectionService = new EmulatorDetectionService(emuLauncher.getAllAdapters(), emuRepo);

    const customExe = path.join(TEST_DIR, 'custom_dolphin.exe');
    fs.copyFileSync(MOCK_RUNNER_EXE, customExe);

    const registered = await detectionService.registerManualEmulator({
      name: 'My Custom Dolphin',
      executablePath: customExe,
      adapterType: 'dolphin',
      supportedPlatforms: ['GameCube', 'Wii']
    });

    assert(registered.id.startsWith('emu_'), 'Must have emulator ID');
    const stored = emuRepo.getById(registered.id);
    assert(stored !== null, 'Must be stored in database');
    assert(stored?.executablePath === customExe, 'Executable path must match');
    assert(stored?.name === 'My Custom Dolphin', 'Name must match');
  });

  await test('Scenario 31: Portable emulator path support', async () => {
    const portableDir = path.join(TEST_DIR, 'PortableApps', 'DuckStation');
    fs.mkdirSync(portableDir, { recursive: true });
    const portableExe = path.join(portableDir, 'duckstation-qt.exe');
    fs.copyFileSync(MOCK_RUNNER_EXE, portableExe);

    const db = createTestDb();
    const emuRepo = new EmulatorsRepository(db);
    const portableEmu = createMockEmulator(emuRepo, {
      name: 'Portable DuckStation',
      executablePath: portableExe,
      adapterType: 'duckstation',
      supportedPlatforms: ['PlayStation'],
      workingDirectory: portableDir
    });

    const emuLauncher = new EmulatorLauncher(emuRepo);
    const game = createMockGame(new GamesRepository(db), {
      title: 'Crash Bandicoot',
      platform: 'PlayStation',
      installedPath: tekkenRom
    });

    const command = await emuLauncher.buildLaunchCommand(game, null, {
      id: 'lp_crash',
      gameId: game.id,
      launcherType: 'emulator',
      emulatorId: portableEmu.id,
      fullscreen: true,
      createdAt: '',
      updatedAt: ''
    });

    assert(command.executable === portableExe, 'Command must use portable executable path');
    assert(command.cwd === portableDir, 'Command cwd must be set to portable working directory');
  });

  await test('Scenario 32: Emulator removed from disk after config detected on pre-launch', async () => {
    const doomedExe = path.join(TEST_DIR, 'doomed_emu.exe');
    fs.copyFileSync(MOCK_RUNNER_EXE, doomedExe);

    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const emuRepo = new EmulatorsRepository(db);

    createMockEmulator(emuRepo, {
      name: 'Doomed Emulator',
      executablePath: doomedExe,
      adapterType: 'pcsx2',
      supportedPlatforms: ['PlayStation 2']
    });

    const game = createMockGame(gamesRepo, {
      title: 'Tekken 4',
      platform: 'PlayStation 2',
      installedPath: gt4Rom
    });

    // File is deleted after configuration
    fs.unlinkSync(doomedExe);

    const emuLauncher = new EmulatorLauncher(emuRepo);
    const validation = await emuLauncher.validate(game, null, null);
    assert(!validation.valid, 'Validation must fail when executable is gone');
    assert(validation.error?.includes('does not exist'), 'Error must describe missing executable');

    let threw = false;
    try {
      await emuLauncher.buildLaunchCommand(game, null, null);
    } catch (err: any) {
      threw = true;
      assert(err instanceof ExecutableInaccessibleError, 'Must throw ExecutableInaccessibleError');
    }
    assert(threw, 'Must throw on buildLaunchCommand');
  });

  // --- Group 8: Launch Profile Customization (Scenarios 33-35) ---

  await test('Scenario 33: Launch profile custom arguments and fullscreen toggle persistence', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const profilesRepo = new LaunchProfilesRepository(db);
    const emuRepo = new EmulatorsRepository(db);
    const sessionsRepo = new GameSessionsRepository(db);
    const launcherManager = new LauncherManager(gamesRepo, manifestsRepo, profilesRepo, emuRepo, sessionsRepo);

    const game = createMockGame(gamesRepo, {
      title: 'Custom Profile Game',
      platform: 'PlayStation 2',
      installedPath: gt4Rom
    });

    const saved = await launcherManager.saveProfile({
      gameId: game.id,
      launcherType: 'emulator',
      argumentsTemplate: '--fastboot --nogui',
      fullscreen: false
    });

    assert(saved.argumentsTemplate === '--fastboot --nogui', 'Arguments template must match');
    assert(saved.fullscreen === false, 'Fullscreen must be false');

    const effective = await launcherManager.getEffectiveProfile(game.id);
    assert(effective.profile.argumentsTemplate === '--fastboot --nogui', 'Must persist in DB and reload');
    assert(effective.profile.fullscreen === false, 'Fullscreen false must persist');
    assert(!effective.isAutoConfigured, 'Should not be marked auto-configured after saving');
  });

  await test('Scenario 34: Fullscreen argument included when profile fullscreen = true', async () => {
    const adapter = new PCSX2Adapter();
    const args = adapter.buildArgs({
      romPath: gt4Rom,
      game: { id: 'g3', title: 'GT4', platform: 'PlayStation 2' } as any,
      emulator: { executablePath: pcsx2Exe, adapterType: 'pcsx2' } as any,
      profile: { fullscreen: true } as any
    });

    assert(args.includes('-fullscreen'), 'Must include -fullscreen when true');
  });

  await test('Scenario 35: Non-fullscreen profile omits or alters fullscreen flags', async () => {
    const adapter = new PCSX2Adapter();
    const args = adapter.buildArgs({
      romPath: gt4Rom,
      game: { id: 'g4', title: 'GT4', platform: 'PlayStation 2' } as any,
      emulator: { executablePath: pcsx2Exe, adapterType: 'pcsx2' } as any,
      profile: { fullscreen: false } as any
    });

    assert(!args.includes('-fullscreen'), 'Must NOT include -fullscreen when false');

    // Check Dolphin non-fullscreen
    const dolphinAdapter = new DolphinAdapter();
    const dolphinArgs = dolphinAdapter.buildArgs({
      romPath: smashRom,
      game: { id: 'g5', title: 'Smash', platform: 'GameCube' } as any,
      emulator: { executablePath: dolphinExe, adapterType: 'dolphin' } as any,
      profile: { fullscreen: false } as any
    });

    assert(!dolphinArgs.includes('-f'), 'Dolphin must NOT include -f when fullscreen is false');
  });

  // --- Group 9: Cloud & Lifecycle Integration (Scenarios 36-38) ---

  await test('Scenario 36: Multi-account origin irrelevant to local launch', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const profilesRepo = new LaunchProfilesRepository(db);
    const emuRepo = new EmulatorsRepository(db);
    const sessionsRepo = new GameSessionsRepository(db);
    const launcherManager = new LauncherManager(gamesRepo, manifestsRepo, profilesRepo, emuRepo, sessionsRepo);

    createMockEmulator(emuRepo, {
      name: 'PCSX2',
      executablePath: pcsx2Exe,
      adapterType: 'pcsx2',
      supportedPlatforms: ['PlayStation 2']
    });

    // Game 1 originated from Google Account 1
    const gameAcc1 = createMockGame(gamesRepo, {
      title: 'Game From Account Alpha',
      platform: 'PlayStation 2',
      state: 'READY',
      installedPath: gt4Rom
    });

    // Game 2 originated from Google Account 2
    const gameAcc2 = createMockGame(gamesRepo, {
      title: 'Game From Account Beta',
      platform: 'PlayStation 2',
      state: 'READY',
      installedPath: gt4Rom
    });

    const prof1 = await launcherManager.getEffectiveProfile(gameAcc1.id);
    const prof2 = await launcherManager.getEffectiveProfile(gameAcc2.id);

    assert(prof1.canLaunch, 'Game from account 1 must be launchable');
    assert(prof2.canLaunch, 'Game from account 2 must be launchable');
  });

  await test('Scenario 37: Evicted game (CLOUD state) cannot launch', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const profilesRepo = new LaunchProfilesRepository(db);
    const emuRepo = new EmulatorsRepository(db);
    const sessionsRepo = new GameSessionsRepository(db);
    const launcherManager = new LauncherManager(gamesRepo, manifestsRepo, profilesRepo, emuRepo, sessionsRepo);

    createMockEmulator(emuRepo, {
      name: 'PCSX2',
      executablePath: pcsx2Exe,
      adapterType: 'pcsx2',
      supportedPlatforms: ['PlayStation 2']
    });

    const evictedGame = createMockGame(gamesRepo, {
      title: 'Evicted Game',
      platform: 'PlayStation 2',
      state: 'CLOUD',
      installedPath: undefined
    });

    let threw = false;
    try {
      await launcherManager.launchGame(evictedGame.id);
    } catch (err: any) {
      threw = true;
      assert(err instanceof LauncherError, 'Must throw LauncherError for CLOUD game');
      assert(err.message.includes('CLOUD'), 'Error message must explain state is CLOUD');
    }
    assert(threw, 'Must throw when attempting to launch CLOUD game');
  });

  await test('Scenario 38: Redownloaded and prepared game launches successfully', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const profilesRepo = new LaunchProfilesRepository(db);
    const emuRepo = new EmulatorsRepository(db);
    const sessionsRepo = new GameSessionsRepository(db);
    const launcherManager = new LauncherManager(gamesRepo, manifestsRepo, profilesRepo, emuRepo, sessionsRepo);

    createMockEmulator(emuRepo, {
      name: 'PCSX2',
      executablePath: pcsx2Exe,
      adapterType: 'pcsx2',
      supportedPlatforms: ['PlayStation 2']
    });

    // Starts as CLOUD
    const game = createMockGame(gamesRepo, {
      title: 'Re-downloaded GT4',
      platform: 'PlayStation 2',
      state: 'CLOUD',
      installedPath: undefined
    });

    // Transition CLOUD -> DOWNLOADING -> PREPARING -> READY
    gamesRepo.updateState(game.id, 'DOWNLOADING', undefined);
    gamesRepo.updateState(game.id, 'PREPARING', undefined);
    gamesRepo.updateState(game.id, 'READY', gt4Rom);

    const session = await launcherManager.launchGame(game.id);
    assert(session !== null, 'Must successfully launch once returned to READY');
    await sleep(200);
  });

  // --- Group 10: Security & Contract Integrity (Scenarios 39-40) ---

  await test('Scenario 39: IPC payload validation and error handling', async () => {
    const db = createTestDb();
    const gamesRepo = new GamesRepository(db);
    const manifestsRepo = new GameManifestsRepository(db);
    const profilesRepo = new LaunchProfilesRepository(db);
    const emuRepo = new EmulatorsRepository(db);
    const sessionsRepo = new GameSessionsRepository(db);
    const launcherManager = new LauncherManager(gamesRepo, manifestsRepo, profilesRepo, emuRepo, sessionsRepo);

    // Empty string gameId
    let threwEmpty = false;
    try {
      await launcherManager.launchGame('');
    } catch (err: any) {
      threwEmpty = true;
      assert(err instanceof NotFoundError, 'Must throw NotFoundError for empty gameId');
    }
    assert(threwEmpty, 'Empty gameId must throw');

    // Non-existent gameId
    let threwMissing = false;
    try {
      await launcherManager.launchGame('game_non_existent_9999');
    } catch (err: any) {
      threwMissing = true;
      assert(err instanceof NotFoundError, 'Must throw NotFoundError for unknown gameId');
    }
    assert(threwMissing, 'Non-existent gameId must throw');
  });

  await test('Scenario 40: Zero shell injection: arguments strictly passed as array to child_process.spawn', async () => {
    const db = createTestDb();
    const sessionsRepo = new GameSessionsRepository(db);
    const gamesRepo = new GamesRepository(db);
    const monitor = new ProcessMonitor(sessionsRepo, gamesRepo);

    const game = createMockGame(gamesRepo, {
      title: 'Security Verification Game',
      platform: 'PC',
      installedPath: pcGameExe
    });

    // Test a gamut of dangerous shell characters
    const dangerousArgs = [
      '--dump-args',
      path.join(TEST_DIR, 'dangerous_dump.txt'),
      'arg;with;semicolons',
      'arg|with|pipes',
      'arg&&with&&and',
      'arg||with||or',
      'arg>with>redirect',
      'arg`with`backticks',
      'arg$(with)subshell',
      'arg"with"quotes'
    ];

    const session = await monitor.launchProcess(
      {
        executable: pcGameExe,
        args: dangerousArgs,
        cwd: pcGameDir
      },
      game,
      'native_pc'
    );

    assert(session !== null, 'Session must launch without shell interpretation');
    await sleep(200);

    const dumpFile = path.join(TEST_DIR, 'dangerous_dump.txt');
    assert(fs.existsSync(dumpFile), 'Process must output args');
    const content = fs.readFileSync(dumpFile, 'utf8');

    for (const dangerous of dangerousArgs) {
      assert(content.includes(dangerous), `Literal argument must be present unmutated: ${dangerous}`);
    }
  });

  // --- Scenario 41 / Real Environment Check ---
  console.log('\n--- REAL EMULATOR ENVIRONMENT AUDIT ---');
  const realStandardPaths = [
    'C:\\Program Files\\PCSX2\\pcsx2-qt.exe',
    'C:\\Program Files\\DuckStation\\duckstation-qt.exe',
    'C:\\Program Files\\Dolphin\\Dolphin.exe',
    'C:\\Program Files\\PPSSPP\\PPSSPPWindows64.exe',
    'C:\\Program Files\\RetroArch\\retroarch.exe'
  ];

  let realFound = 0;
  for (const p of realStandardPaths) {
    if (fs.existsSync(p)) {
      console.log(`[Real Emu Found] ${p}`);
      realFound++;
    }
  }

  if (realFound === 0) {
    console.log('[AUDIT] No real emulator binaries installed in standard directories.');
    console.log('>>> REAL EMULATOR LAUNCH TEST NOT EXECUTED <<<');
  } else {
    console.log(`[AUDIT] Found ${realFound} real emulator binaries.`);
  }

  // Final Summary
  console.log('\n================================================================');
  console.log(`  Phase 4A Verification: ${passed}/40 passed (${failed} failed)`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal error running Phase 4A test suite:', err);
  process.exit(1);
});
