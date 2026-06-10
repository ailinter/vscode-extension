/**
 * Delta Dashboard — sidebar webview showing all scanned files with
 * quality score deltas. Like `git status` for code quality.
 *
 * Features:
 *  - Sort by worst delta first, then worst score
 *  - Color-coded scores (green ≥ 80, yellow ≥ 60, red < 60)
 *  - Click to open file at the issue location
 *  - Shows top 50 files (most changed/worst quality)
 *
 * Inspired by CodeScene's DeltaAnalysisTreeProvider and their
 * delta dashboard webview pattern.
 */
import * as vscode from 'vscode';

interface FileScoreEntry {
  path: string;
  score: number;
  delta?: number;
  findings: number;
}

export class DeltaDashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ailinter.deltaDashboard';
  private _view?: vscode.WebviewView;
  private _scores: FileScoreEntry[] = [];

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.buildHtml();
    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === 'openFile') {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.path));
      }
    });
  }

  /**
   * Update the dashboard with fresh file scores.
   * Called after every scan and on cache changes.
   */
  update(fileScores: Array<{ path: string; score: number; delta?: number; findings: number }>): void {
    this._scores = fileScores;
    if (this._view) {
      this._view.webview.html = this.buildHtml();
    }
  }

  private buildHtml(): string {
    if (this._scores.length === 0) {
      return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { padding:12px; font-family:var(--vscode-font-family); font-size:13px; color:var(--vscode-foreground); }
  p { color:var(--vscode-descriptionForeground); }
</style></head><body>
  <p>No files scanned yet. Save a file to begin.</p>
</body></html>`;
    }

    // Sort: worst delta first, then worst score
    const sorted = [...this._scores].sort((a, b) => {
      if (a.delta !== undefined && b.delta !== undefined && a.delta !== b.delta) {
        return a.delta - b.delta;
      }
      return a.score - b.score;
    });

    const rows = sorted.slice(0, 50).map(f => {
      const deltaStr = f.delta !== undefined
        ? (f.delta > 0
            ? `<span style="color:var(--vscode-terminal-ansiGreen)">▲ +${f.delta}</span>`
            : f.delta < 0
              ? `<span style="color:var(--vscode-terminal-ansiRed)">▼ ${f.delta}</span>`
              : `<span style="color:var(--vscode-descriptionForeground)">—</span>`)
        : '';

      const color = f.score >= 80 ? 'var(--vscode-terminal-ansiGreen)'
        : f.score >= 60 ? 'var(--vscode-terminal-ansiYellow)'
        : 'var(--vscode-terminal-ansiRed)';

      const fileName = f.path.split('/').pop() || f.path;
      const escapedPath = f.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      return `<tr onclick="openFile('${escapedPath}')">
        <td class="score" style="color:${color}">${f.score}</td>
        <td class="file">${escapeHtml(fileName)}</td>
        <td class="delta">${deltaStr}</td>
        <td class="issues">${f.findings}</td>
      </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:var(--vscode-font-family); font-size:13px; color:var(--vscode-foreground); background:var(--vscode-sideBar-background); }
  table { width:100%; border-collapse:collapse; }
  th { padding:6px 8px; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--vscode-descriptionForeground); text-align:left; border-bottom:1px solid var(--vscode-panel-border); }
  tr { cursor:pointer; }
  tr:hover { background:var(--vscode-list-hoverBackground); }
  td { padding:4px 8px; border-bottom:1px solid var(--vscode-panel-border); white-space:nowrap; }
  td.score { font-weight:600; width:60px; }
  td.file { overflow:hidden; text-overflow:ellipsis; max-width:200px; }
  td.delta { width:60px; text-align:center; font-size:0.9em; }
  td.issues { width:40px; text-align:right; color:var(--vscode-descriptionForeground); }
  .header { padding:10px 8px 6px; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:var(--vscode-descriptionForeground); border-bottom:1px solid var(--vscode-panel-border); }
  .summary { padding:8px 8px; font-size:11px; color:var(--vscode-descriptionForeground); border-bottom:1px solid var(--vscode-panel-border); }
</style></head><body>
  <div class="header">$(shield) Code Quality Delta</div>
  <div class="summary">${this._scores.length} files scanned</div>
  <table>
    <thead><tr>
      <th>Score</th><th>File</th><th>Δ</th><th>#</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="padding:12px;color:var(--vscode-descriptionForeground)">No changes detected</td></tr>'}</tbody>
  </table>
  <script>
    const vscode = acquireVsCodeApi();
    function openFile(path) { vscode.postMessage({ type:'openFile', path }); }
  </script>
</body></html>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
