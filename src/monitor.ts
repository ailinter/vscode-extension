/**
 * Code Quality Monitor: tracks before/after score deltas per file.
 * Mirrors CodeScene's "Score: 85 → 91 (+6)" tracking.
 *
 * Phase 2 enhancement: now includes Git merge-base delta analysis,
 * comparing current file scores against the merge-base (main branch)
 * to show how code quality has changed since the branch was created.
 *
 * Snapshots are taken:
 *   - BEFORE a scan (captures current score as baseline)
 *   - AFTER a scan (computes delta from baseline)
 *   - GIT MERGE-BASE: compares against main branch point
 */
import { exec } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { runAilinter } from './ailinter';

const execAsync = promisify(exec);

interface ScoreEntry {
  /** Score before the most recent scan (undefined = first scan) */
  before?: number;
  /** Score after the most recent scan (undefined = before snapshot, not yet scanned) */
  after?: number;
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

export class CodeQualityMonitor {
  private history = new Map<string, ScoreEntry>();
  private baselineScores = new Map<string, number>();

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
   * If no previous score exists, leaves `before` undefined (no delta will be shown).
   * The `after` field will be overwritten by `snapshotAfter`.
   */
  snapshotBefore(filePath: string, currentScore?: number): void {
    const existing = this.history.get(filePath);
    this.history.set(filePath, {
      before: currentScore ?? existing?.after,
      after: existing?.after, // will be overwritten by snapshotAfter
      label: vscode.workspace.asRelativePath(filePath),
    });
  }

  /**
   * Call AFTER scanning a file — computes the delta from before.
   * Returns the delta (positive = improvement, negative = regression), or
   * undefined if no baseline score exists (first scan).
   * Fires the `onDelta` event only when a baseline exists.
   */
  snapshotAfter(filePath: string, newScore: number): number | undefined {
    const existing = this.history.get(filePath);
    const before = existing?.before;

    // No baseline — store the score but don't compute delta.
    // Never default to 100 — that creates misleading "▼ -21" regressions.
    if (before === undefined) {
      this.history.set(filePath, {
        before: undefined,
        after: newScore,
        label: vscode.workspace.asRelativePath(filePath),
      });
      return undefined;
    }

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
   * Compute the git merge-base delta: compares current score against
   * the file's score at the merge-base commit (main branch).
   *
   * This tells the developer how their changes on the current branch
   * have affected code quality compared to main.
   *
   * CodeScene pattern: getMergeBaseCommit → git show for baseline.
   *
   * @param filePath Absolute path to the file
   * @param currentScore Current computed score
   * @param binaryPath Path to ailinter binary
   * @param workspaceRoot Workspace root for git operations
   * @returns Delta (positive = improvement vs merge-base), or undefined if
   *          the file didn't exist at merge-base or git is unavailable
   */
  async computeGitDelta(
    filePath: string,
    currentScore: number,
    binaryPath: string,
    workspaceRoot?: string
  ): Promise<number | undefined> {
    if (!workspaceRoot) return undefined;

    try {
      const mergeBase = await this.getMergeBaseCommit(workspaceRoot);
      if (!mergeBase) return undefined;

      const oldScore = await this.computeBaselineScore(filePath, mergeBase, binaryPath, workspaceRoot);
      if (oldScore === undefined) return undefined;

      this.baselineScores.set(filePath, oldScore);
      return currentScore - oldScore;
    } catch {
      return undefined; // Git not available or file didn't exist
    }
  }

  /**
   * Get the merge-base commit (HEAD vs main/master/develop).
   * Implements the CodeScene getMergeBaseCommit pattern.
   */
  private async getMergeBaseCommit(workspaceRoot: string): Promise<string | undefined> {
    try {
      // Try main first, fall back to master, then develop
      for (const branch of ['main', 'master', 'develop']) {
        const { stdout } = await execAsync(
          `git merge-base HEAD ${branch}`,
          { cwd: workspaceRoot, timeout: 5000 }
        );
        const commit = stdout.trim();
        if (commit) return commit;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Compute the score of a file at the merge-base commit.
   * Runs ailinter on the old file content via stdin.
   *
   * Returns undefined if the file didn't exist at that commit (new file).
   */
  private async computeBaselineScore(
    filePath: string,
    mergeBase: string,
    binaryPath: string,
    workspaceRoot: string
  ): Promise<number | undefined> {
    try {
      // Get the relative path for the git show command
      const relativePath = path.relative(workspaceRoot, filePath);

      // Checkout file content at merge-base
      const { stdout: oldContent } = await execAsync(
        `git show ${mergeBase}:${relativePath}`,
        { cwd: workspaceRoot, timeout: 10000 }
      );

      if (!oldContent) return undefined;

      // Run ailinter on the old content via stdin
      const result = await runAilinter(filePath, binaryPath, {
        useStdin: true,
        fileContent: oldContent,
      });

      return result.score;
    } catch {
      return undefined; // File didn't exist at merge-base
    }
  }

  /**
   * Get the cached git baseline score for a file.
   */
  getBaselineScore(filePath: string): number | undefined {
    return this.baselineScores.get(filePath);
  }

  /**
   * Get the current delta for a file without modifying state.
   * Returns undefined if no history exists.
   */
  getDelta(filePath: string): number | undefined {
    const h = this.history.get(filePath);
    if (!h || h.before === undefined || h.after === undefined) return undefined;
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
    this.baselineScores.delete(filePath);
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
      if (entry.before !== undefined && entry.after !== undefined && predicate(entry.before, entry.after)) {
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
    this.baselineScores.clear();
  }
}

/**
 * Legacy alias for backward compatibility.
 * CodeQualityMonitor now includes git delta capabilities.
 */
export { CodeQualityMonitor as GitDeltaMonitor };
