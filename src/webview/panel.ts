/**
 * AILINTER Webview Panel — rich beside-column documentation and refactoring
 * guidance panel, inspired by CodeScene's CodeSceneCWFDocsTabPanel.
 *
 * Provides:
 *  - Smell documentation with descriptions and severity
 *  - Before/After code examples
 *  - Refactoring strategy via postMessage to extension
 *  - Apply/Copy/Reject buttons for refactoring suggestions
 *  - VS Code theme-aware styling
 *  - **Staleness detection**: warns when the function body changes
 *    after documentation is loaded (Feature 4)
 *
 * CodeScene reference: src/codescene-tab/webview-panel.ts
 */
import * as vscode from 'vscode';
import { KNOWN_SMELLS } from '../types';
import { buildDocHtml } from './content';
import { buildRefactoringHtml, getRefactoringStrategy } from './refactoring';

export class AilinterWebviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  // ── Staleness detection state (Feature 4) ─────────────────────────────
  private functionSnapshot: { startLine: number; endLine: number; hash: string } | undefined;
  private staleListener: vscode.Disposable | undefined;

  /**
   * Show smell documentation in the beside-column panel.
   * Creates the panel on first use, reuses on subsequent calls.
   *
   * @param smellType The code smell type (e.g., "deep_nesting")
   * @param context Extension context for resource URIs
   */
  showDocumentation(smellType: string, context: vscode.ExtensionContext): void {
    this.ensurePanel('AILINTER: ' + formatSmellName(smellType));

    this.panel!.webview.html = buildDocHtml(smellType, this.panel!.webview, context.extensionUri);

    // Listen for messages from the webview
    this.panel!.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case 'getStrategy':
            // Route to showRefactoring with real CLI data
            this.showRefactoring(
              message.smell,
              message.filePath || '',
              message.line || 1,
              context
            );
            break;
          case 'openUrl':
            vscode.env.openExternal(vscode.Uri.parse(message.url));
            break;
          case 'close':
            if (this.panel) {
              this.panel.dispose();
              this.panel = undefined;
            }
            break;
        }
      },
      undefined,
      this.disposables
    );

    this.panel!.reveal(vscode.ViewColumn.Beside, true);
  }

  /**
   * Show refactoring suggestions in the beside-column panel.
   * Fetches real refactoring strategy data from the ailinter CLI
   * (get-refactoring-strategy command) and displays it with
   * actual before/after code examples.
   *
   * Shows a loading spinner while the CLI is running, then renders
   * the full markdown output as styled HTML.
   *
   * @param smellType The code smell type (e.g., "deep_nesting")
   * @param filePath Path to the file being refactored
   * @param line Line number of the issue
   * @param context Extension context
   */
  async showRefactoring(
    smellType: string,
    filePath: string,
    line: number,
    context: vscode.ExtensionContext
  ): Promise<void> {
    this.ensurePanel('AILINTER Refactoring: ' + formatSmellName(smellType));

    // Get binary path from VS Code settings (default: "ailinter")
    const binaryPath = vscode.workspace.getConfiguration('ailinter').get<string>('path', 'ailinter');

    // Show loading state immediately
    this.panel!.webview.html = this.buildLoadingHtml(smellType);
    this.panel!.reveal(vscode.ViewColumn.Beside, true);

    // Fetch real strategy from CLI
    const strategyOutput = await getRefactoringStrategy(smellType, binaryPath);

    // Render real content
    this.panel!.webview.html = buildRefactoringHtml(smellType, strategyOutput, filePath, line);

    // ── Start staleness detection (Feature 4) ───────────────────────────
    this.startStalenessDetection(filePath, line);

    this.panel!.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case 'getStrategy':
            vscode.commands.executeCommand('ailinter.getStrategy', {
              smell: message.smell,
              file: message.filePath,
              line: message.line,
            });
            break;
          case 'copyCode':
            vscode.env.clipboard.writeText(message.code);
            vscode.window.showInformationMessage('Copied refactoring code to clipboard');
            break;
        }
      },
      undefined,
      this.disposables
    );

    this.panel!.reveal(vscode.ViewColumn.Beside, true);
  }

  /**
   * Build a loading spinner HTML page while waiting for the CLI.
   */
  private buildLoadingHtml(smellType: string): string {
    const smellName = formatSmellName(smellType);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { padding: 24px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 200px; }
    .spinner { width: 32px; height: 32px; border: 3px solid var(--vscode-panel-border); border-top: 3px solid var(--vscode-textLink-foreground); border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { margin-top: 16px; font-size: 14px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <p>Fetching refactoring strategy for <strong>${smellName}</strong>…</p>
</body>
</html>`;
  }

  /**
   * Ensure the webview panel exists, creating it if necessary.
   */
  private ensurePanel(title: string): void {
    if (this.panel) {
      this.panel.title = title;
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'ailinterDocs',
      title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposeStalenessDetection();
      this.disposables.forEach(d => d.dispose());
      this.disposables = [];
    }, null, this.disposables);

    this.panel.iconPath = vscode.Uri.joinPath(
      vscode.extensions.getExtension('ailinter.ailinter')?.extensionUri || vscode.Uri.parse(''),
      'icon.png'
    );
  }

  // ── Staleness Detection (Feature 4) ─────────────────────────────────────

  /**
   * Start monitoring the function body for changes after showing refactoring
   * guidance. If the function body changes, posts a 'stale' message to the
   * webview so it can display a warning.
   *
   * Uses a simple hash of the function body text to detect changes,
   * avoiding expensive diff computations.
   */
  private async startStalenessDetection(filePath: string, line: number): Promise<void> {
    // Dispose any previous staleness listener
    this.disposeStalenessDetection();

    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      const startLine = this.findFunctionStart(doc, line);
      const endLine = this.findFunctionEnd(doc, startLine);
      const body = doc.getText(new vscode.Range(startLine, 0, endLine, 0));
      this.functionSnapshot = { startLine, endLine, hash: simpleHash(body) };

      // Listen for document changes
      this.staleListener = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.fileName !== filePath) return;
        if (!this.functionSnapshot || !this.panel) return;

        const snapshot = this.functionSnapshot;
        const endLine = Math.min(snapshot.endLine, e.document.lineCount - 1);
        if (snapshot.startLine >= e.document.lineCount) {
          // File was truncated — definitely stale
          this.postStaleWarning();
          return;
        }

        const newBody = e.document.getText(
          new vscode.Range(snapshot.startLine, 0, endLine, 0)
        );
        const newHash = simpleHash(newBody);

        if (newHash !== snapshot.hash) {
          this.postStaleWarning();
        }
      });

      // Auto-dispose after 2 minutes to avoid leaking listeners on long-lived panels
      setTimeout(() => {
        if (this.staleListener) {
          this.staleListener.dispose();
          this.staleListener = undefined;
        }
      }, 2 * 60 * 1000);

    } catch {
      // Silently fail — staleness detection is a nice-to-have, not critical
      this.functionSnapshot = undefined;
    }
  }

  /**
   * Post a staleness warning message to the webview.
   */
  private postStaleWarning(): void {
    if (!this.panel) return;
    try {
      this.panel.webview.postMessage({
        type: 'stale',
        message: '⚠️ The function body has changed since this guidance was loaded. The refactoring suggestions may no longer apply. Save the file and re-run the scan for updated guidance.',
      });
    } catch {
      // Webview might be disposed
    }
    // Dispose the listener after first warning — no need to keep monitoring
    this.disposeStalenessDetection();
  }

  /**
   * Dispose the staleness detection listener.
   */
  private disposeStalenessDetection(): void {
    if (this.staleListener) {
      this.staleListener.dispose();
      this.staleListener = undefined;
    }
    this.functionSnapshot = undefined;
  }

  /**
   * Walk up from the given line to find the function declaration.
   * Supports Go, TypeScript, JavaScript, Python, Java, and C-family languages.
   */
  private findFunctionStart(doc: vscode.TextDocument, line: number): number {
    // Search upward from the given line (up to 30 lines back)
    const searchStart = Math.max(0, line - 30);
    for (let i = line; i >= searchStart; i--) {
      const text = doc.lineAt(i).text;

      // Go functions
      if (/^\s*func\s/.test(text)) return i;

      // JS/TS: function declarations
      if (/^\s*(export\s+)?(async\s+)?function\s/.test(text)) return i;

      // JS/TS: arrow functions assigned to const/let/var
      if (/^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/.test(text)) return i;

      // JS/TS: methods in classes
      if (/^\s*(public|private|protected|static|async)\s.*\(/.test(text) && /\{/.test(text)) return i;

      // Java/C#: method declarations
      if (/^\s*(public|private|protected|static|async|virtual|override)\s+[\w<>[\]]+\s+\w+\s*\(/.test(text)) return i;

      // Python: def
      if (/^\s*def\s/.test(text)) return i;
    }
    return line;
  }

  /**
   * Walk down from the function start to find the closing brace.
   */
  private findFunctionEnd(doc: vscode.TextDocument, startLine: number): number {
    let depth = 0;
    let foundOpeningBrace = false;
    const maxLookahead = startLine + 200; // Safety limit

    for (let i = startLine; i < Math.min(doc.lineCount, maxLookahead); i++) {
      const text = doc.lineAt(i).text;
      for (const ch of text) {
        if (ch === '{') {
          depth++;
          foundOpeningBrace = true;
        } else if (ch === '}') {
          depth--;
          if (foundOpeningBrace && depth === 0) {
            return i + 1; // End range is exclusive
          }
        }
      }
    }
    return Math.min(startLine + 50, doc.lineCount); // Fallback
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Close the panel if it's open.
   */
  dispose(): void {
    this.disposeStalenessDetection();
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }

  /**
   * Check if the panel is currently visible.
   */
  get isVisible(): boolean {
    return this.panel !== undefined && this.panel.visible;
  }
}

/**
 * Simple non-cryptographic hash of a string.
 * Used for detecting function body changes (not for security).
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Format a smell type key into a human-readable name.
 * "deep_nesting" → "Deep Nesting"
 */
function formatSmellName(smellType: string): string {
  return smellType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
