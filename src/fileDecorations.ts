/**
 * FileDecorationProvider — shows issue count badges on file icons in the
 * VS Code Explorer (file tree).
 *
 * Inspired by CodeScene's FileWithIssuesDecorationProvider, which renders a
 * numeric badge (e.g., "5") next to files that have code quality issues.
 */
import * as vscode from 'vscode';

export class AilinterFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  /** filePath (absolute) → issue count */
  private fileIssues = new Map<string, number>();

  /**
   * Update the issue count for a file and fire decoration change.
   * Call this after each scan completes.
   */
  updateFileIssues(filePath: string, count: number): void {
    this.fileIssues.set(filePath, count);
    this._onDidChangeFileDecorations.fire(vscode.Uri.file(filePath));
  }

  /**
   * Remove a file from decoration tracking (e.g., when it's closed/deleted).
   */
  removeFile(filePath: string): void {
    this.fileIssues.delete(filePath);
    this._onDidChangeFileDecorations.fire(vscode.Uri.file(filePath));
  }

  /** Clear all tracked issues */
  clear(): void {
    this.fileIssues.clear();
    this._onDidChangeFileDecorations.fire(undefined as any);
  }

  /**
   * VS Code calls this for each visible file in the Explorer.
   * Return a FileDecoration with the badge count if the file has issues.
   */
  provideFileDecoration(
    uri: vscode.Uri,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.FileDecoration> {
    const count = this.fileIssues.get(uri.fsPath);
    if (!count || count === 0) {
      return undefined;
    }

    return {
      badge: count > 99 ? '99+' : String(count),
      tooltip: `${count} AILINTER issue${count !== 1 ? 's' : ''} found`,
      color: new vscode.ThemeColor('terminal.ansiYellow'),
    };
  }
}
