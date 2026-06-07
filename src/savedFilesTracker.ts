/**
 * Saved Files Tracker — tracks files explicitly saved by the user in the
 * VS Code editor, distinguishing them from files changed by git operations
 * (rebases, stashes, checkouts).
 *
 * This enables the "only re-scan files the user actually edited" pattern:
 * - When the git poller detects file changes, only re-scan if the user
 *   actually saved the file in the editor.
 * - Periodically clears the set to prevent unbounded memory growth.
 *
 * Inspired by CodeScene's SavedFilesTracker:
 *   src/saved-files-tracker.ts
 */
import * as vscode from 'vscode';
import * as path from 'path';

export class SavedFilesTracker {
  private savedFiles: Set<string> = new Set();
  private clearInterval: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private clearIntervalMs: number = 5 * 60 * 1000 // 5 minutes
  ) {}

  /**
   * Start tracking. Registers the on-save listener and periodic clear.
   */
  start(): void {
    if (this.disposables.length > 0) return; // Already started

    const saveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
      this.onFileSaved(document);
    });
    this.disposables.push(saveDisposable);
    this.context.subscriptions.push(saveDisposable);

    // Periodic clear to prevent unbounded growth
    this.clearInterval = setInterval(() => {
      this.savedFiles.clear();
    }, this.clearIntervalMs);
  }

  /**
   * Called when a file is saved. Only tracks files that are open in the editor
   * (visible or in a tab), excluding generated files.
   */
  private onFileSaved(document: vscode.TextDocument): void {
    const filePath = document.fileName;

    // Skip generated/compiled files
    if (this.shouldSkip(filePath)) return;

    // Only track if file is open in the editor (user-initiated save)
    if (this.isFileOpenInEditor(filePath)) {
      this.savedFiles.add(filePath);
    }
  }

  /**
   * Check if a file is currently open in any editor tab.
   */
  private isFileOpenInEditor(filePath: string): boolean {
    // Check visible editors
    const isVisible = vscode.window.visibleTextEditors.some(
      (editor) => editor.document.fileName === filePath
    );
    if (isVisible) return true;

    // Check background tabs
    try {
      return vscode.window.tabGroups.all.some((tabGroup) =>
        tabGroup.tabs.some((tab) =>
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.fsPath === filePath
        )
      );
    } catch {
      // Tab API might not be available in all VS Code versions
      return false;
    }
  }

  /**
   * Check if a file path should be skipped (generated files, node_modules, etc.).
   */
  private shouldSkip(filePath: string): boolean {
    const basename = path.basename(filePath);
    // Skip common generated files
    if (basename === 'package-lock.json' || basename === 'yarn.lock') return true;
    if (basename === 'go.sum' || basename === 'pnpm-lock.yaml') return true;
    return false;
  }

  /**
   * Check if a file was saved by the user (tracked in the set).
   */
  wasSavedByUser(filePath: string): boolean {
    return this.savedFiles.has(filePath);
  }

  /**
   * Get a copy of all tracked saved file paths.
   */
  getSavedFiles(): Set<string> {
    return new Set(this.savedFiles);
  }

  /**
   * Clear all tracked files. Useful when switching branches.
   */
  clearSavedFiles(): void {
    this.savedFiles.clear();
  }

  /**
   * Remove a specific file from tracking.
   */
  removeFromTracker(filePath: string): void {
    this.savedFiles.delete(filePath);
  }

  /**
   * Get the number of tracked files.
   */
  get size(): number {
    return this.savedFiles.size;
  }

  /**
   * Stop tracking and clean up.
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    if (this.clearInterval) {
      clearInterval(this.clearInterval);
      this.clearInterval = undefined;
    }
    this.savedFiles.clear();
  }
}
