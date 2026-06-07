/**
 * AILINTER VS Code Extension — Main Entry Point
 *
 * Orchestrates all providers:
 *   - Diagnostics (Problems panel)
 *   - Decorations (gutter icons + inline highlights)
 *   - CodeLens (function-level scores)
 *   - Hover (refactoring guidance)
 *   - CodeActions (Quick Fix lightbulb)
 *   - Sidebar (project health tree view)
 *   - Status bar (score + delta)
 *   - Monitor (before/after delta tracking)
 *
 * Activation: on save, on file open
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { scanAndCache, getCachedResult, getAllCachedResults, clearCache } from './ailinter';
import { AilinterFinding, FileScore, ProjectHealth } from './types';
import { applyDecorations, clearDecorations, disposeDecorations } from './decorations';
import { AilinterCodeLensProvider } from './codelens';
import { AilinterHoverProvider } from './hover';
import { AilinterCodeActionProvider } from './codeactions';
import { CodeHealthMonitor } from './monitor';
import { AilinterSidebarProvider } from './sidebar';
import { updateDiagnostics } from './diagnostics';
import {
  createStatusBar,
  updateStatusBar,
  setStatusBarIdle,
  setStatusBarScanning,
  setStatusBarStale,
} from './statusbar';

// ── Module-level state ───────────────────────────────────────────────────────

let diagnosticCollection: vscode.DiagnosticCollection;
let codeLensProvider: AilinterCodeLensProvider;
let codeLensRegistration: vscode.Disposable;
let hoverProvider: AilinterHoverProvider;
let codeActionProvider: AilinterCodeActionProvider;
let sidebarProvider: AilinterSidebarProvider;
let healthMonitor: CodeHealthMonitor;
let statusBar: vscode.StatusBarItem;

// ── Activate ─────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // ── Initialize core components ─────────────────────────────────────────

  // Diagnostics collection (Problems panel)
  diagnosticCollection = vscode.languages.createDiagnosticCollection('ailinter');
  context.subscriptions.push(diagnosticCollection);

  // Status bar
  statusBar = createStatusBar();
  setStatusBarIdle();
  context.subscriptions.push(statusBar);

  // Health monitor (before/after delta tracking)
  healthMonitor = new CodeHealthMonitor();

  // CodeLens provider — function-level scores
  codeLensProvider = new AilinterCodeLensProvider();
  codeLensRegistration = vscode.languages.registerCodeLensProvider(
    { scheme: 'file' },
    codeLensProvider
  );
  context.subscriptions.push(codeLensRegistration);

  // Hover provider — rich refactoring guidance
  hoverProvider = new AilinterHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      hoverProvider
    )
  );

  // Code Action provider — Quick Fix lightbulb
  codeActionProvider = new AilinterCodeActionProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      codeActionProvider,
      { providedCodeActionKinds: AilinterCodeActionProvider.providedCodeActionKinds }
    )
  );

  // Sidebar tree view
  sidebarProvider = new AilinterSidebarProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ailinterSidebar', sidebarProvider)
  );

  // ── Commands ───────────────────────────────────────────────────────────

  // Show file details (also used by status bar click)
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.showFileDetails', (filePath?: string) => {
      const path = filePath || vscode.window.activeTextEditor?.document.fileName;
      if (!path) {
        vscode.window.showInformationMessage(
          'AILINTER — Open a file and save it to see code quality results.'
        );
        return;
      }
      const cached = getCachedResult(path);
      if (!cached) {
        vscode.window.showInformationMessage(
          `AILINTER — No scan results for ${vscode.workspace.asRelativePath(path)}. Save the file to scan.`
        );
        return;
      }
      const delta = healthMonitor.getDeltaString(path);
      vscode.window.showInformationMessage(
        `AILINTER — ${vscode.workspace.asRelativePath(path)}: ${cached.score}/100${delta ? ` (${delta})` : ''} — ${cached.findings.length} issues`,
        { modal: false }
      );
    })
  );

  // Focus on issues at specific lines
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.focusIssues', (lines: number[]) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || lines.length === 0) return;
      const firstLine = Math.min(...lines);
      const range = new vscode.Range(firstLine - 1, 0, firstLine - 1, 0);
      editor.selection = new vscode.Selection(range.start, range.end);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    })
  );

  // Get refactoring strategy (opens documentation or runs ailinter strategy)
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.getStrategy', (args: { smell: string; file: string; line: number }) => {
      const { smell } = args;
      // Open ailinter docs for this smell in the browser
      vscode.env.openExternal(
        vscode.Uri.parse(`https://ailinter.dev/docs/smells/${smell}`)
      );
      // Also show a quick info message with steps
      const message = `Refactoring strategy for "${smell}": Extract method → simplify control flow → reduce nesting. See ailinter.dev/docs/smells/${smell} for details.`;
      vscode.window.showInformationMessage(message, { modal: false });
    })
  );

  // Replace secret with environment variable
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.replaceSecret', (args: { file: string; line: number }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const lineIdx = args.line - 1;
      if (lineIdx < 0 || lineIdx >= editor.document.lineCount) return;

      const line = editor.document.lineAt(lineIdx);
      const indent = line.text.match(/^\s*/)?.[0] || '';
      const varName = 'SECRET_KEY';

      // Replace the line with an env var pattern
      editor.edit(editBuilder => {
        const range = new vscode.Range(lineIdx, 0, lineIdx, line.text.length);
        editBuilder.replace(range, `${indent}${varName} = process.env.${varName}  // TODO: Set ${varName} in environment`);
      });

      vscode.window.showInformationMessage(
        `Replaced secret on line ${args.line} with environment variable \`${varName}\``
      );
    })
  );

  // Suppress warning
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.suppressWarning', (args: { file: string; line: number; smellType?: string }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const lineIdx = args.line - 1;
      if (lineIdx < 0 || lineIdx >= editor.document.lineCount) return;

      const line = editor.document.lineAt(lineIdx);
      const comment = line.text.includes('//')
        ? ' // ailinter:disable'
        : '  // ailinter:disable';

      editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(lineIdx, line.text.length), comment);
      });

      vscode.window.showInformationMessage(
        `Suppressed warning on line ${args.line}${args.smellType ? ` (${args.smellType})` : ''}`
      );
    })
  );

  // Show vulnerability details
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.showVulnerabilityDetails', (args: { file: string; line: number; message: string }) => {
      vscode.window.showWarningMessage(
        `[Vulnerability] ${args.message}`,
        { modal: false, detail: `File: ${args.file}, Line: ${args.line}` }
      );
    })
  );

  // Manual scan command
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.scanFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor to scan.');
        return;
      }
      await scanActiveFile(editor.document);
    })
  );

  // ── Event handlers ─────────────────────────────────────────────────────

  // On save: scan the saved file and update all providers
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const config = vscode.workspace.getConfiguration('ailinter');
      if (!config.get<boolean>('enable', true)) return;

      await scanActiveFile(document);
    })
  );

  // On file open: apply decorations if we have cached results
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      const cached = getCachedResult(editor.document.fileName);
      if (cached) {
        applyDecorations(editor, cached.findings);
      } else {
        // Optionally auto-scan on open
        const config = vscode.workspace.getConfiguration('ailinter');
        if (config.get<boolean>('scanOnOpen', false)) {
          scanActiveFile(editor.document);
        }
      }
    })
  );

  // On file close: clean up
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      // No cleanup needed — keep cache for reopen
    })
  );

  // On configuration change: re-scan if relevant settings changed
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ailinter')) {
        // Clear cache — settings may affect results
        clearCache();
        // Re-scan active file if open
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          scanActiveFile(editor.document);
        }
      }
    })
  );

  // ── Scan active file on activation ─────────────────────────────────────
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const config = vscode.workspace.getConfiguration('ailinter');
    if (config.get<boolean>('enable', true) && config.get<boolean>('scanOnOpen', false)) {
      scanActiveFile(editor.document);
    }
  }

  // ── First-run welcome ──────────────────────────────────────────────────
  const hasShownWelcome = context.globalState.get<boolean>('ailinter.welcomeShown');
  if (!hasShownWelcome) {
    // Delay slightly to let the editor finish its startup rendering
    setTimeout(() => {
      vscode.window.showInformationMessage(
        '🛡️ AILINTER is ready! Save any file to scan for quality, secrets, and vulnerabilities.',
        'Open Walkthrough',
        'Dismiss'
      ).then(selection => {
        if (selection === 'Open Walkthrough') {
          vscode.commands.executeCommand(
            'workbench.action.openWalkthrough',
            'ailinter.ailinter#ailinter.gettingStarted'
          );
        }
      });
      context.globalState.update('ailinter.welcomeShown', true);
    }, 1500);
  }

  // ── Register walkthrough command ───────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.openWalkthrough', () => {
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        'ailinter.ailinter#ailinter.gettingStarted'
      );
    })
  );

  // ── Log activation ─────────────────────────────────────────────────────
  console.log('AILINTER extension activated — CodeScene-inspired UX loaded');
}

// ── Deactivate ───────────────────────────────────────────────────────────────

export function deactivate(): void {
  if (diagnosticCollection) {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
  }
  disposeDecorations();
  clearCache();
  healthMonitor.clear();
  console.log('AILINTER extension deactivated');
}

// ── Path-based finding filter ─────────────────────────────────────────────────

/**
 * Filter findings to only include those matching the given file path.
 * This ensures status bar count matches Problems panel count.
 *
 * Root cause of mismatch: ailinter CLI `--format problems` output includes
 * metalinter (govet/staticcheck) findings with mangled file paths
 * (e.g., "/path/file.go:34:16:1:1: [govet] ...") that don't match any real
 * document path. These are filtered by updateDiagnostics/applyDecorations
 * but were still counted in fileScore.findings.length.
 */
function filterFindingsByFile(
  findings: AilinterFinding[],
  filePath: string
): AilinterFinding[] {
  const normalizedTarget = path.normalize(filePath);
  const targetDir = path.dirname(normalizedTarget);

  return findings.filter(f => {
    const findingPath = path.isAbsolute(f.file)
      ? f.file
      : path.resolve(targetDir, f.file);
    return path.normalize(findingPath) === normalizedTarget;
  });
}

// ── Core scan logic ──────────────────────────────────────────────────────────

/**
 * Scan a document, update all providers with the results.
 * This is the central coordination point.
 */
async function scanActiveFile(document: vscode.TextDocument): Promise<void> {
  const config = vscode.workspace.getConfiguration('ailinter');
  const binaryPath = config.get<string>('path', 'ailinter');

  const filePath = document.fileName;
  const relativePath = vscode.workspace.asRelativePath(filePath);

  // ── 1. Pre-scan: snapshot current score ────────────────────────────────
  const cachedBefore = getCachedResult(filePath);
  healthMonitor.snapshotBefore(filePath, cachedBefore?.score);

  // ── 2. Update UI — scanning state ──────────────────────────────────────
  setStatusBarScanning(relativePath);

  try {
    // ── 3. Run ailinter ──────────────────────────────────────────────────
    const fileScore = await scanAndCache(filePath, binaryPath);

    // ── 4. Compute delta ─────────────────────────────────────────────────
    const delta = healthMonitor.snapshotAfter(filePath, fileScore.score);

    // ── 5. Filter findings by document path ────────────────────────────────
    // ailinter CLI may return findings for files other than the requested
    // document (e.g., govet metalinter output with mangled paths). Filter them
    // so ALL providers see a consistent set matching only this document.
    const documentFindings = filterFindingsByFile(fileScore.findings, filePath);
    const totalRaw = fileScore.findings.length;
    const filteredCount = totalRaw - documentFindings.length;

    console.log(
      `[ailinter:scan] "${relativePath}": ${totalRaw} raw findings → ` +
      `${documentFindings.length} for this file (${filteredCount} filtered out)`
    );

    // ── 6. Update all providers ──────────────────────────────────────────

    // Diagnostics (Problems panel)
    updateDiagnostics(document, documentFindings, diagnosticCollection);

    // Decorations (gutter icons + highlights)
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.fileName === filePath) {
      applyDecorations(editor, documentFindings);
    }

    // CodeLens (function-level scores)
    codeLensProvider.updateResults(filePath, fileScore.score, documentFindings);

    // Hover (refactoring guidance)
    hoverProvider.updateFindings(filePath, documentFindings);

    // Code Actions (Quick Fix lightbulb)
    codeActionProvider.updateFindings(filePath, documentFindings);

    // Status bar (score + delta)
    updateStatusBar(fileScore.score, {
      delta,
      findingCount: documentFindings.length,
      fileName: filePath,
    });

    // Sidebar (project health)
    updateSidebar();

    // ── 6. Notify on regression ──────────────────────────────────────────
    if (delta !== undefined && delta < 0) {
      vscode.window.showWarningMessage(
        `AILINTER: ${relativePath} score regressed from ${fileScore.score - delta} → ${fileScore.score} (${delta})`,
        { modal: false }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`AILINTER scan error: ${message}`);

    // Don't lose the score — show last known good result
    const cached = getCachedResult(filePath);
    if (cached) {
      // Restore status bar with the cached score
      updateStatusBar(cached.score, {
        delta: undefined,
        findingCount: cached.findings.length,
        fileName: filePath,
      });
      // Append stale indicator
      setStatusBarStale();
    } else {
      // No prior scan — show idle state with hint about the error
      setStatusBarIdle();
      statusBar.text = '$(shield) AILINTER: --';
      statusBar.tooltip = `Scan failed: ${message}. Try saving the file again.`;
    }

    // Show a single non-modal warning so the user knows something happened
    if (cached) {
      vscode.window.showWarningMessage(
        `AILINTER scan failed for ${relativePath}. Showing cached score from ${cached.lastScanned.toLocaleTimeString()}.`,
        { modal: false }
      );
    } else {
      vscode.window.showWarningMessage(
        `AILINTER scan failed: ${message}`,
        { modal: false }
      );
    }
  }
}

// ── Sidebar update ───────────────────────────────────────────────────────────

/**
 * Recompute project health from the cache and push to the sidebar.
 */
function updateSidebar(): void {
  const allScores = getAllCachedResults();
  if (allScores.length === 0) {
    sidebarProvider.clear();
    return;
  }

  const allFindings = allScores.flatMap(f => f.findings);

  // Compute top smells
  const smellCounts = new Map<string, number>();
  for (const f of allFindings) {
    if (f.smellType) {
      smellCounts.set(f.smellType, (smellCounts.get(f.smellType) || 0) + 1);
    }
  }
  const topSmells = Array.from(smellCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([smell, count]) => ({ smell, count }));

  const health: ProjectHealth = {
    overallScore: Math.round(
      allScores.reduce((sum, f) => sum + f.score, 0) / allScores.length
    ),
    fileCount: allScores.length,
    filesWithIssues: allScores.filter(f => f.findings.length > 0).length,
    totalFindings: allFindings.length,
    criticalCount: allFindings.filter(f => f.severity === 'critical').length,
    errorCount: allFindings.filter(f => f.severity === 'error').length,
    warningCount: allFindings.filter(f => f.severity === 'warning').length,
    topSmells,
  };

  sidebarProvider.update(health, allScores);
}
