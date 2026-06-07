/**
 * Code Health Monitor: tracks before/after score deltas per file.
 * Mirrors CodeScene's "Score: 85 → 91 (+6)" tracking.
 *
 * Snapshots are taken:
 *   - BEFORE a scan (captures current score as baseline)
 *   - AFTER a scan (computes delta from baseline)
 */
import * as vscode from 'vscode';

interface ScoreEntry {
  /** Score before the most recent scan */
  before?: number;
  /** Score after the most recent scan */
  after: number;
  /** Human-readable label for the file */
  label: string;
}

/** Return type for getRegressions / getImprovements */
interface ScoredEntry {
  filePath: string;
  before: number;
  after: number;
  delta: number;
}

export class CodeHealthMonitor {
  private history = new Map<string, ScoreEntry>();

  // ── Event: fires when a delta is computed ──────────────────────────────────
  private _onDelta = new vscode.EventEmitter<{
    filePath: string;
    before: number;
    after: number;
    delta: number;
  }>();
  readonly onDelta = this._onDelta.event;

  /**
   * Call BEFORE scanning a file — records the current score as the baseline.
   * If no previous score exists, uses the current file score (if any) or 100.
   */
  snapshotBefore(filePath: string, currentScore?: number): void {
    const existing = this.history.get(filePath);
    this.history.set(filePath, {
      before: currentScore ?? existing?.after,
      after: existing?.after ?? 100, // will be overwritten by snapshotAfter
      label: vscode.workspace.asRelativePath(filePath),
    });
  }

  /**
   * Call AFTER scanning a file — computes the delta from before.
   * Returns the delta (positive = improvement, negative = regression).
   * Fires the `onDelta` event.
   */
  snapshotAfter(filePath: string, newScore: number): number {
    const existing = this.history.get(filePath);
    const before = existing?.before ?? 100;
    const delta = newScore - before;

    this.history.set(filePath, {
      before,
      after: newScore,
      label: vscode.workspace.asRelativePath(filePath),
    });

    this._onDelta.fire({ filePath, before, after: newScore, delta });
    return delta;
  }

  /**
   * Get the current delta for a file without modifying state.
   * Returns undefined if no history exists.
   */
  getDelta(filePath: string): number | undefined {
    const h = this.history.get(filePath);
    if (!h || h.before === undefined) return undefined;
    return h.after - h.before;
  }

  /**
   * Get formatted delta string, e.g. "+6", "-3", or undefined if no change.
   */
  getDeltaString(filePath: string): string | undefined {
    const delta = this.getDelta(filePath);
    if (delta === undefined) return undefined;
    if (delta === 0) return undefined;
    return delta > 0 ? `+${delta}` : `${delta}`;
  }

  /**
   * Get the full history entry for a file.
   */
  getEntry(filePath: string): ScoreEntry | undefined {
    return this.history.get(filePath);
  }

  /**
   * Remove a file from tracking (e.g., file deleted).
   */
  removeFile(filePath: string): void {
    this.history.delete(filePath);
  }

  /**
   * Get all files that have regressed (score decreased).
   */
  getRegressions(): ScoredEntry[] {
    return this.getFilteredEntries((before, after) => after < before);
  }

  /**
   * Get all files that have improved (score increased).
   */
  getImprovements(): ScoredEntry[] {
    return this.getFilteredEntries((before, after) => after > before);
  }

  /**
   * Filter history entries by a comparison predicate.
   * Shared implementation for getRegressions and getImprovements.
   */
  private getFilteredEntries(
    predicate: (before: number, after: number) => boolean
  ): ScoredEntry[] {
    const results: ScoredEntry[] = [];
    for (const [filePath, entry] of this.history) {
      if (entry.before !== undefined && predicate(entry.before, entry.after)) {
        results.push({
          filePath,
          before: entry.before,
          after: entry.after,
          delta: entry.after - entry.before,
        });
      }
    }
    return results;
  }

  /** Clear all history */
  clear(): void {
    this.history.clear();
  }
}
