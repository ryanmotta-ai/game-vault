import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const commonConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  external: ['electron', 'better-sqlite3'],
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
};

async function build() {
  console.log('[build-desktop] Compiling Electron main & preload...');

  // Build main process
  await esbuild.build({
    ...commonConfig,
    entryPoints: [path.resolve(rootDir, 'src/desktop/main.ts')],
    outfile: path.resolve(rootDir, 'dist/desktop/main.js'),
    format: 'cjs'
  });

  // Build preload script
  await esbuild.build({
    ...commonConfig,
    entryPoints: [path.resolve(rootDir, 'src/desktop/preload.ts')],
    outfile: path.resolve(rootDir, 'dist/desktop/preload.js'),
    format: 'cjs'
  });

  console.log('[build-desktop] Main and Preload build completed successfully.');
}

build().catch((err) => {
  console.error('[build-desktop] Build failed:', err);
  process.exit(1);
});
