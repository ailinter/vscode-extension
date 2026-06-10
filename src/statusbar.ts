/**
 * Status bar item: shows current file score with delta tracking.
 * Minimal display: icon + score, colored by tier.
 * State-dependent click actions.
 *
 * Display patterns:
 *   $(shield) 85/100                        (score, colored)
 *   $(shield) 85/100  ▲ +6                  (improved)
 *   $(shield) AILINTER                      (idle)
 *   $(sync~spin) scanning                   (scanning)
 *   $(error) scan failed                    (error)
 *   $(shield) 85/100 ⚠️                     (stale)
 */
import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem | undefined;

export function createStatusBar(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    0
  );
  return statusBarItem;
}

function scoreColor(score: number): vscode.ThemeColor | undefined {
  if (score >= 80) return new vscode.ThemeColor('terminal.ansiGreen');
  if (score >= 60) return new vscode.ThemeColor('terminal.ansiYellow');
  return new vscode.ThemeColor('terminal.ansiRed');
}

/**
 * Update the status bar with the latest scan results.
 *
 * @param score Current file quality score (0-100)
 * @param options Optional delta for richer display
 */
export function updateStatusBar(
  score: number,
  options?: { delta?: number }
): void {
  if (!statusBarItem) return;

  const deltaStr = buildDeltaString(options?.delta);
  statusBarItem.text = `$(shield) ${score}/100${deltaStr}`;
  statusBarItem.color = scoreColor(score);

  // Tooltip shows score and delta
  const parts = [`Code Quality: ${score}/100`];
  if (options?.delta) {
    parts.push(
      options.delta > 0
        ? `Improved by ${options.delta}`
        : `Regressed by ${Math.abs(options.delta)}`
    );
  }
  statusBarItem.tooltip = parts.join(' · ') + ' · Click for details';

  statusBarItem.command = 'ailinter.showFileDetails';
  statusBarItem.show();
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
  statusBarItem.command = 'ailinter.showFileDetails';
  statusBarItem.show();
}

/**
 * Set the status bar to a scanning state.
 */
export function setStatusBarScanning(fileName?: string): void {
  if (!statusBarItem) return;
  statusBarItem.text = `$(sync~spin) scanning`;
  statusBarItem.tooltip = fileName
    ? `Scanning ${vscode.workspace.asRelativePath(fileName)}...`
    : 'AILINTER is scanning...';
  statusBarItem.command = undefined; // no action during scan
  statusBarItem.show();
}

/**
 * Set the status bar to an error state.
 */
export function setStatusBarError(message: string): void {
  if (!statusBarItem) return;
  statusBarItem.text = `$(error) scan failed`;
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  statusBarItem.color = undefined;
  statusBarItem.tooltip = `Error: ${message} — Click to retry`;
  statusBarItem.command = 'ailinter.scanFile'; // retry on click
  statusBarItem.show();
}

/**
 * Append a stale-data indicator to the current status bar text.
 * Used when a scan fails but we have a cached result to show.
 */
export function setStatusBarStale(): void {
  if (!statusBarItem) return;
  statusBarItem.text = statusBarItem.text + ' ⚠️';
  statusBarItem.tooltip = (statusBarItem.tooltip as string || '') + ' (stale)';
}

/**
 * Build the delta string for the status bar display.
 * Returns: "  ▲ +6" or "  ▼ -3" or "" if no meaningful delta
 */
function buildDeltaString(delta?: number): string {
  if (delta === undefined || delta === 0) return '';
  return delta > 0 ? `  ▲ +${delta}` : `  ▼ ${delta}`;
}
