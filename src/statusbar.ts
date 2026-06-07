/**
 * Status bar item: shows current file score with delta tracking.
 * Enhanced from MVP: now includes before/after delta, issue count,
 * and click commands for detailed view.
 *
 * Display patterns:
 *   $(shield) AILINTER: 85/100  ▲ +6  — 3 issues          (improved)
 *   $(shield) AILINTER: 72/100  ▼ -3  — 5 issues          (regressed)
 *   $(shield) AILINTER: 85/100  — 3 issues                 (unchanged)
 *   $(shield) AILINTER: ready — save to scan               (no data)
 */
import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem | undefined;

export function createStatusBar(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'ailinter.showFileDetails';
  return statusBarItem;
}

/**
 * Update the status bar with the latest scan results.
 *
 * @param score Current file quality score (0-100)
 * @param options Optional metadata for richer display
 */
export function updateStatusBar(
  score: number,
  options?: {
    delta?: number;
    findingCount?: number;
    fileName?: string;
  }
): void {
  if (!statusBarItem) return;

  const deltaStr = buildDeltaString(options?.delta);
  const issueStr = buildIssueString(options?.findingCount);

  statusBarItem.text = `$(shield) AILINTER: ${score}/100${deltaStr}${issueStr}`;

  statusBarItem.backgroundColor = undefined;
  statusBarItem.color = colorForScore(score);

  statusBarItem.tooltip = buildTooltip(score, options);
  statusBarItem.show();
}

function colorForScore(score: number): string | undefined {
  if (score >= 80) return '#3fb950';  // green
  if (score >= 60) return '#d29922';  // yellow
  return '#f85149';                    // red
}

function buildIssueString(findingCount?: number): string {
  if (findingCount === undefined) return '';
  return ` — ${findingCount} issue${findingCount !== 1 ? 's' : ''}`;
}

function buildTooltip(score: number, options?: {
  delta?: number;
  findingCount?: number;
  fileName?: string;
}): string {
  const parts: string[] = [`Code Quality: ${score}/100`];
  if (options?.delta !== undefined) {
    parts.push(
      options.delta >= 0
        ? `Improved by ${options.delta} points`
        : `Regressed by ${Math.abs(options.delta)} points`
    );
  }
  if (options?.findingCount !== undefined) {
    parts.push(`${options.findingCount} issues found`);
  }
  if (options?.fileName) {
    parts.push(`File: ${vscode.workspace.asRelativePath(options.fileName)}`);
  }
  parts.push('Click for details');
  return parts.join(' · ');
}

/**
 * Set the status bar to an idle/ready state.
 */
export function setStatusBarIdle(): void {
  if (!statusBarItem) return;
  statusBarItem.text = `$(shield) AILINTER`;
  statusBarItem.color = undefined;
  statusBarItem.backgroundColor = undefined;
  statusBarItem.tooltip = 'AILINTER — save a file to scan';
  statusBarItem.show();
}

/**
 * Set the status bar to a scanning state.
 */
export function setStatusBarScanning(fileName?: string): void {
  if (!statusBarItem) return;
  const fileLabel = fileName
    ? ` — ${vscode.workspace.asRelativePath(fileName)}`
    : '';
  statusBarItem.text = `$(sync~spin) AILINTER scanning${fileLabel}`;
  statusBarItem.tooltip = 'AILINTER is scanning...';
  statusBarItem.show();
}

/**
 * Set the status bar to an error state.
 */
export function setStatusBarError(message: string): void {
  if (!statusBarItem) return;
  statusBarItem.text = `$(error) AILINTER: Error`;
  statusBarItem.tooltip = `Error: ${message}`;
  statusBarItem.color = '#f85149';
  statusBarItem.show();
}

/**
 * Append a stale-data indicator to the current status bar text.
 * Used when a scan fails but we have a cached result to show.
 */
export function setStatusBarStale(): void {
  if (!statusBarItem) return;
  // Remove any existing stale marker first, then append fresh one
  statusBarItem.text = statusBarItem.text.replace(' ⚠️', '') + ' ⚠️';
  const existing = (statusBarItem.tooltip as string) || '';
  if (!existing.includes('(stale)')) {
    statusBarItem.tooltip = existing + ' (stale — showing last successful scan)';
  }
}

/**
 * Build the delta string for the status bar display.
 * Returns: "  ▲ +6" or "  ▼ -3" or "" if no meaningful delta
 */
function buildDeltaString(delta?: number): string {
  if (delta === undefined || delta === 0) return '';
  return delta > 0 ? `  ▲ +${delta}` : `  ▼ ${delta}`;
}
