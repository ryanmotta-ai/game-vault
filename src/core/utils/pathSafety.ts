import path from 'node:path';

// Windows reserved filenames (case-insensitive)
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]);

/**
 * Sanitizes a remote filename to ensure it cannot escape local directories
 * and conforms to Windows and cross-platform filesystem constraints.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed_file';
  }

  // 1. Take only the basename in case paths were included
  let safeName = path.basename(filename);

  // 2. Replace path traversal sequences ('..' or separators)
  safeName = safeName.replace(/(\.\.[\/\\]|\.\.)/g, '_');

  // 3. Replace Windows illegal characters: < > : " / \ | ? * and ASCII control characters (0-31)
  safeName = safeName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

  // 4. Strip trailing dots and spaces (illegal on Windows)
  safeName = safeName.replace(/[. ]+$/, '');

  // 5. Handle Windows reserved device names (e.g. CON, AUX, COM1.iso)
  const ext = path.extname(safeName);
  const baseWithoutExt = path.basename(safeName, ext).toLowerCase();

  if (WINDOWS_RESERVED_NAMES.has(baseWithoutExt)) {
    safeName = `_${safeName}`;
  }

  // 6. Enforce safe length limit (max 180 chars to leave headroom for MAX_PATH)
  if (safeName.length > 180) {
    const safeExt = path.extname(safeName);
    const maxBase = 180 - safeExt.length;
    safeName = `${safeName.substring(0, maxBase)}${safeExt}`;
  }

  // 7. Fallback if empty after sanitization
  if (!safeName || safeName.trim() === '' || safeName === '.') {
    return 'unnamed_file';
  }

  return safeName;
}

/**
 * Validates that a target path is strictly contained within a parent directory.
 */
export function isSubPath(parentDir: string, targetPath: string): boolean {
  const relative = path.relative(parentDir, targetPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
