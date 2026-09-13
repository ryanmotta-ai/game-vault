import { BrowserWindow, shell, session } from 'electron';
import { logger } from '../core/logger';

const log = logger.child('Security');

export function applySecurityPolicies(mainWindow: BrowserWindow): void {
  // 1. Prevent navigation away from the app
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'file:') {
      event.preventDefault();
      log.warn(`Blocked navigation to untrusted protocol: ${navigationUrl}`);
      return;
    }

    // In dev mode allow localhost
    if (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') {
      return;
    }

    // In file mode
    if (parsedUrl.protocol === 'file:') {
      return;
    }

    event.preventDefault();
    log.info(`Opening external URL in system browser: ${navigationUrl}`);
    shell.openExternal(navigationUrl);
  });

  // 2. Prevent window.open / target="_blank" from opening insecure internal windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    log.info(`Intercepted new window request for: ${url}`);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 3. Configure strict Content Security Policy headers
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          process.env.NODE_ENV === 'development'
            ? "default-src 'self' 'unsafe-inline' http://localhost:5173 ws://localhost:5173 https://images.unsplash.com https://cdn.cloudflare.steamstatic.com data: blob:; img-src 'self' data: https: local-artwork: file:;"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: local-artwork: file:; font-src 'self' data:;"
        ]
      }
    });
  });

  log.info('Electron security policies and CSP configured successfully.');
}
