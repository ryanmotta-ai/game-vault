export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_PRIORITIES: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40
};

const SENSITIVE_KEYS = new Set([
  'token',
  'refreshtoken',
  'access_token',
  'client_secret',
  'clientsecret',
  'password',
  'secret',
  'authorization',
  'auth'
]);

function sanitizeData(obj: unknown, depth = 0): unknown {
  if (depth > 4) return '[MaxDepth]';
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeData(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof val === 'object' && val !== null) {
      sanitized[key] = sanitizeData(val, depth + 1);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

export class Logger {
  private currentLevel: LogLevel = 'DEBUG';
  private prefix: string;

  constructor(prefix = 'GameVault') {
    this.prefix = prefix;
  }

  public setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  public child(childPrefix: string): Logger {
    return new Logger(`${this.prefix}:${childPrefix}`);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITIES[level] >= LOG_LEVEL_PRIORITIES[this.currentLevel];
  }

  private format(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(sanitizeData(meta))}` : '';
    return `[${timestamp}] [${level}] [${this.prefix}] ${message}${metaStr}`;
  }

  public debug(message: string, meta?: unknown): void {
    if (this.shouldLog('DEBUG')) {
      console.debug(this.format('DEBUG', message, meta));
    }
  }

  public info(message: string, meta?: unknown): void {
    if (this.shouldLog('INFO')) {
      console.info(this.format('INFO', message, meta));
    }
  }

  public warn(message: string, meta?: unknown): void {
    if (this.shouldLog('WARN')) {
      console.warn(this.format('WARN', message, meta));
    }
  }

  public error(message: string, meta?: unknown): void {
    if (this.shouldLog('ERROR')) {
      console.error(this.format('ERROR', message, meta));
    }
  }
}

export const logger = new Logger();
