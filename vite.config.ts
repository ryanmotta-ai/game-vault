import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: path.resolve(__dirname, 'src/ui'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@desktop': path.resolve(__dirname, 'src/desktop'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@providers': path.resolve(__dirname, 'src/providers'),
      '@storage': path.resolve(__dirname, 'src/storage'),
      '@database': path.resolve(__dirname, 'src/database'),
      '@downloads': path.resolve(__dirname, 'src/downloads'),
      '@launchers': path.resolve(__dirname, 'src/launchers'),
      '@emulators': path.resolve(__dirname, 'src/emulators'),
      '@metadata': path.resolve(__dirname, 'src/metadata')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/ui'),
    emptyOutDir: true
  }
});
