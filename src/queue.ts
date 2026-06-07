/**
 * Per-file review queue — prevents duplicate concurrent scans of the same file.
 *
 * Inspired by CodeScene's ReviewRequestQueue: when a scan is already in progress
 * for a file, subsequent requests re-use the same promise instead of starting
 * a second process. This avoids resource waste and race conditions.
 */
import { FileScore } from './types';

const activeScans = new Map<string, Promise<FileScore>>();

/**
 * Enqueue a scan for a file path.
 * If a scan for the same file is already in progress, returns the existing
 * promise instead of starting a new one.
 *
 * @param filePath — Absolute file path (used as dedup key)
 * @param scanFn — Async function that performs the scan
 * @returns The FileScore result (shared if deduplicated)
 */
export async function enqueueScan(
  filePath: string,
  scanFn: () => Promise<FileScore>
): Promise<FileScore> {
  const existing = activeScans.get(filePath);
  if (existing) {
    return existing;
  }

  const promise = scanFn().finally(() => {
    activeScans.delete(filePath);
  });
  activeScans.set(filePath, promise);
  return promise;
}

/**
 * Clear all active scan promises (e.g., on deactivate).
 */
export function clearActiveScans(): void {
  activeScans.clear();
}

/**
 * Get the number of active scans currently in-flight.
 */
export function activeScanCount(): number {
  return activeScans.size;
}
