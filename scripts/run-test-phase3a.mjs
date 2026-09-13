import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function run() {
  console.log('[test-phase3a] Compiling test suite...');
  await esbuild.build({
    entryPoints: [path.resolve(rootDir, 'scripts/test-phase3a.ts')],
    outfile: path.resolve(rootDir, 'dist/test-phase3a.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    external: ['better-sqlite3', 'electron'],
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@desktop': path.resolve(rootDir, 'src/desktop'),
      '@ui': path.resolve(rootDir, 'src/ui'),
      '@core': path.resolve(rootDir, 'src/core'),
      '@providers': path.resolve(rootDir, 'src/providers'),
      '@storage': path.resolve(rootDir, 'src/storage'),
      '@database': path.resolve(rootDir, 'src/database'),
      '@downloads': path.resolve(rootDir, 'src/downloads'),
      '@launchers': path.resolve(rootDir, 'src/launchers'),
      '@emulators': path.resolve(rootDir, 'src/emulators'),
      '@metadata': path.resolve(rootDir, 'src/metadata'),
      '@catalog': path.resolve(rootDir, 'src/catalog'),
      '@sync': path.resolve(rootDir, 'src/sync')
    }
  });

  console.log('[test-phase3a] Executing with Electron runtime...');
  const electronBin = process.platform === 'win32'
    ? path.resolve(rootDir, 'node_modules', '.bin', 'electron.cmd')
    : path.resolve(rootDir, 'node_modules', '.bin', 'electron');

  const result = spawnSync(electronBin, ['dist/test-phase3a.cjs'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'test',
      GAMEVAULT_ALLOW_INSECURE_CREDENTIALS: 'true'
    }
  });

  process.exit(result.status || 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
