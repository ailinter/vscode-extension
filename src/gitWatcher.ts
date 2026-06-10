/**
 * Git Change Poller — periodically polls git for changed files and fires
 * callbacks when changes are detected.
 *
 * Inspired by CodeScene's GitChangeLister pattern:
 *   src/git/git-change-lister.ts
 *
 * Uses a periodic poll (every 9 seconds by default) to detect files that
 * have been modified via external tools, rebases, or stash operations.
 *
 * The poll interval matches CodeScene's 9-second cadence, balancing
 * responsiveness with system resource usage.
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Callback type for file change notifications.
 * Receives an array of changed file paths (relative to workspace root).
 */
export type GitChangeCallback = (files: string[]) => void;

/**
 * Periodically polls the git working tree for changed files and
 * notifies registered callbacks.
 *
 * Uses `git diff --name-only` to detect unstaged changes and
 * `git diff --cached --name-only` for staged changes.
 */
export class GitChangePoller {
  private interval: NodeJS.Timeout | undefined;
  private onChangeCallbacks: GitChangeCallback[] = [];

  /**
   * @param workspaceRoot Absolute path to the workspace root (where .git lives)
   * @param pollIntervalMs Polling interval in milliseconds (default: 9000 — matches CodeScene)
   */
  constructor(
    private workspaceRoot: string,
    private pollIntervalMs: number = 9000
  ) {}

  /**
   * Register a callback for when files change.
   * Multiple callbacks are supported and all will be called.
   *
   * @param callback Function receiving array of changed file paths
   */
  onDidChangeFiles(callback: GitChangeCallback): void {
    this.onChangeCallbacks.push(callback);
  }

  /**
   * Start the polling interval. The first poll happens immediately
   * (on next tick), then at the configured interval.
   */
  start(): void {
    if (this.interval) return; // Already started

    // Immediate first check
    void this.poll();

    this.interval = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  /**
   * Stop the polling interval. Safe to call even if not started.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /**
   * Perform a single poll of the working tree.
   * Combines unstaged and staged file changes.
   */
  private async poll(): Promise<void> {
    try {
      // Get unstaged changes (working tree vs index)
      const { stdout: unstaged } = await execAsync(
        'git diff --name-only',
        { cwd: this.workspaceRoot, timeout: 5000 }
      );

      // Get staged changes (index vs HEAD)
      const { stdout: staged } = await execAsync(
        'git diff --cached --name-only',
        { cwd: this.workspaceRoot, timeout: 5000 }
      );

      // Merge and deduplicate
      const allOutput = [unstaged, staged].filter(s => s.trim().length > 0).join('\n');
      const files = [...new Set(
        allOutput
          .split('\n')
          .map(f => f.trim())
          .filter(f => f.length > 0 && !f.includes(' -> ')) // skip rename arrows
      )];

      if (files.length > 0) {
        this.onChangeCallbacks.forEach(cb => cb(files));
      }
    } catch {
      // Git errors are silently ignored — the poller retries on next interval.
      // This matches CodeScene's approach: "if it fails at the first run,
      // a second one will succeed" (git-change-lister.ts).
    }
  }

  /**
   * Get whether the poller is currently running.
   */
  get isRunning(): boolean {
    return this.interval !== undefined;
  }
}
