import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function run() {
  console.log('[test-db] Compiling test suite...');
  await esbuild.build({
    entryPoints: [path.resolve(rootDir, 'scripts/test-db.ts')],
    outfile: path.resolve(rootDir, 'dist/test-db.cjs'),
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
      '@metadata': path.resolve(rootDir, 'src/metadata')
    }
  });

  console.log('[test-db] Executing with Electron runtime...');
  const electronBin = process.platform === 'win32'
    ? path.resolve(rootDir, 'node_modules', '.bin', 'electron.cmd')
    : path.resolve(rootDir, 'node_modules', '.bin', 'electron');

  const result = spawnSync(electronBin, ['dist/test-db.cjs'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1'
    }
  });

  process.exit(result.status || 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
