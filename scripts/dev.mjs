import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const commonConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: 'inline',
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

async function startDev() {
  console.log('[dev] Building desktop main & preload...');
  await esbuild.build({
    ...commonConfig,
    entryPoints: [path.resolve(rootDir, 'src/desktop/main.ts')],
    outfile: path.resolve(rootDir, 'dist/desktop/main.js'),
    format: 'cjs'
  });

  await esbuild.build({
    ...commonConfig,
    entryPoints: [path.resolve(rootDir, 'src/desktop/preload.ts')],
    outfile: path.resolve(rootDir, 'dist/desktop/preload.js'),
    format: 'cjs'
  });

  console.log('[dev] Starting Vite dev server...');
  const viteCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const viteProcess = spawn(viteCmd, ['vite', '--port', '5173'], {
    cwd: rootDir,
    stdio: 'pipe',
    shell: true
  });

  viteProcess.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(`[vite] ${text}`);
    if (text.includes('Local:') || text.includes('5173')) {
      launchElectron();
    }
  });

  viteProcess.stderr.on('data', (data) => {
    process.stderr.write(`[vite-err] ${data.toString()}`);
  });

  let electronProcess = null;
  let launched = false;

  function launchElectron() {
    if (launched) return;
    launched = true;

    console.log('[dev] Launching Electron...');
    const electronCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    electronProcess = spawn(electronCmd, ['electron', 'dist/desktop/main.js'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
        NODE_ENV: 'development'
      }
    });

    electronProcess.on('close', (code) => {
      console.log(`[dev] Electron exited with code ${code}`);
      viteProcess.kill();
      process.exit(code || 0);
    });
  }

  process.on('SIGINT', () => {
    if (electronProcess) electronProcess.kill();
    viteProcess.kill();
    process.exit(0);
  });
}

startDev().catch((err) => {
  console.error('[dev] Dev failed:', err);
  process.exit(1);
});
