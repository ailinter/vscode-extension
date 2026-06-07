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
  setStatusBarError,
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
  registerCommands(context);

  // ── Event handlers ─────────────────────────────────────────────────────
  registerEventHandlers(context);

  // ── Scan active file on activation ─────────────────────────────────────
  scanActiveFileOnActivation();

  // ── First-run welcome ──────────────────────────────────────────────────
  showFirstRunWelcome(context);

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

// ── Command registrations ────────────────────────────────────────────────────

/**
 * Register all AILINTER commands with VS Code.
 * Extracted from activate() to reduce function length and bump count.
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // Each callback is extracted to a named handler function to avoid bumpy_road
  // from inline closures creating indentation bumps.
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.showFileDetails', handleShowFileDetails)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.focusIssues', handleFocusIssues)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.getStrategy', handleGetStrategy)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.replaceSecret', handleReplaceSecret)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.suppressWarning', handleSuppressWarning)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.showVulnerabilityDetails', handleShowVulnerabilityDetails)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.scanFile', handleScanFileCommand)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.openWalkthrough', handleOpenWalkthrough)
  );
}

// ── Command handlers ──────────────────────────────────────────────────────────

function handleShowFileDetails(filePath?: string): void {
  const path = filePath || vscode.window.activeTextEditor?.document.fileName;
  if (!path) {
    vscode.window.showInformationMessage('AILINTER — Open a file and save it to see code quality results.');
    return;
  }
  const cached = getCachedResult(path);
  if (!cached) {
    vscode.window.showInformationMessage(`AILINTER — No scan results for ${vscode.workspace.asRelativePath(path)}. Save the file to scan.`);
    return;
  }
  const delta = healthMonitor.getDeltaString(path);
  vscode.window.showInformationMessage(
    `AILINTER — ${vscode.workspace.asRelativePath(path)}: ${cached.score}/100${delta ? ` (${delta})` : ''} — ${cached.findings.length} issues`,
    { modal: false }
  );
}

function handleFocusIssues(lines: number[]): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || lines.length === 0) return;
  const firstLine = Math.min(...lines);
  const range = new vscode.Range(Math.max(0, firstLine - 1), 0, Math.max(0, firstLine - 1), 0);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

function handleGetStrategy(args: { smell: string; file: string; line: number }): void {
  const { smell } = args;
  vscode.env.openExternal(vscode.Uri.parse(`https://ailinter.dev/docs/smells/${smell}`));
  const message = `Refactoring strategy for "${smell}": Extract method → simplify control flow → reduce nesting. See ailinter.dev/docs/smells/${smell} for details.`;
  vscode.window.showInformationMessage(message, { modal: false });
}

function handleReplaceSecret(args: { file: string; line: number }): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const lineIdx = args.line - 1;
  if (lineIdx < 0 || lineIdx >= editor.document.lineCount) return;
  const line = editor.document.lineAt(lineIdx);
  const indent = line.text.match(/^\s*/)?.[0] || '';
  const varName = 'SECRET_KEY';
  editor.edit(editBuilder => {
    const range = new vscode.Range(lineIdx, 0, lineIdx, line.text.length);
    editBuilder.replace(range, `${indent}${varName} = process.env.${varName}  // TODO: Set ${varName} in environment`);
  });
  vscode.window.showInformationMessage(`Replaced secret on line ${args.line} with environment variable \`${varName}\``);
}

function handleSuppressWarning(args: { file: string; line: number; smellType?: string }): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const lineIdx = args.line - 1;
  if (lineIdx < 0 || lineIdx >= editor.document.lineCount) return;
  const line = editor.document.lineAt(lineIdx);
  const comment = line.text.includes('//') ? ' // ailinter:disable' : '  // ailinter:disable';
  editor.edit(editBuilder => {
    editBuilder.insert(new vscode.Position(lineIdx, line.text.length), comment);
  });
  vscode.window.showInformationMessage(`Suppressed warning on line ${args.line}${args.smellType ? ` (${args.smellType})` : ''}`);
}

function handleShowVulnerabilityDetails(args: { file: string; line: number; message: string }): void {
  vscode.window.showWarningMessage(
    `[Vulnerability] ${args.message}`,
    { modal: false, detail: `File: ${args.file}, Line: ${args.line}` }
  );
}

async function handleScanFileCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor to scan.');
    return;
  }
  await scanActiveFile(editor.document);
}

function handleOpenWalkthrough(): void {
  vscode.commands.executeCommand('workbench.action.openWalkthrough', 'ailinter.ailinter#ailinter.gettingStarted');
}

// ── Event handler registrations ───────────────────────────────────────────────

/**
 * Register all document event handlers (save, open, close, config change).
 * Extracted from activate() to reduce function length and bump count.
 */
function registerEventHandlers(context: vscode.ExtensionContext): void {
  // On save: scan the saved file
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
        const config = vscode.workspace.getConfiguration('ailinter');
        if (config.get<boolean>('scanOnOpen', true)) {
          scanActiveFile(editor.document);
        }
      }
    })
  );

  // On file close: clean up
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(() => {
      // No cleanup needed — keep cache for reopen
    })
  );

  // On configuration change: re-scan if relevant settings changed
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ailinter')) {
        clearCache();
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          scanActiveFile(editor.document);
        }
      }
    })
  );
}

// ── Activation helpers ───────────────────────────────────────────────────────

/**
 * Scan the currently active file if the extension config permits.
 * Called once on activation.
 */
function scanActiveFileOnActivation(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const config = vscode.workspace.getConfiguration('ailinter');
  if (!config.get<boolean>('enable', true)) return;
  if (!config.get<boolean>('scanOnOpen', true)) return;
  scanActiveFile(editor.document);
}

/**
 * Show the first-run welcome message with a one-time delay.
 * Extracted from activate() to reduce function length.
 */
function showFirstRunWelcome(context: vscode.ExtensionContext): void {
  const hasShownWelcome = context.globalState.get<boolean>('ailinter.welcomeShown');
  if (hasShownWelcome) return;
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
 *
 * Resolution strategy (tried in order):
 * 1. If finding path is absolute → compare directly
 * 2. If finding path is relative → resolve against workspace root first
 *    (this is where the CLI was invoked from), then doc dir as fallback
 */
export function filterFindingsByFile(
  findings: AilinterFinding[],
  filePath: string
): AilinterFinding[] {
  const normalizedTarget = path.resolve(path.normalize(filePath));
  const targetDir = path.dirname(normalizedTarget);
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = (workspaceFolders?.length ?? 0) > 0
    ? workspaceFolders![0].uri.fsPath
    : undefined;

  return findings.filter(f => {
    if (path.isAbsolute(f.file)) {
      return path.normalize(f.file) === normalizedTarget;
    }

    // Relative path — try workspace root first (CLI CWD)
    if (workspaceRoot) {
      const wsPath = path.resolve(workspaceRoot, f.file);
      if (path.normalize(wsPath) === normalizedTarget) {
        return true;
      }
    }

    // Fallback: resolve against document directory
    const docPath = path.resolve(targetDir, f.file);
    return path.normalize(docPath) === normalizedTarget;
  });
}

// ── Core scan logic ──────────────────────────────────────────────────────────

/**
 * Scan a document, update all providers with the results.
 * This is the central coordination point.
 *
 * BULLETPROOF design:
 * - Only scanAndCache is wrapped in try/catch
 * - fileScore is ALWAYS defined after the try/catch block
 * - Each provider update has its own try/catch so one failure
 *   doesn't cascade and kill the entire scan
 * - Status bar always updates with whatever score we have
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

  // ── 3. Run ailinter (only this is in try/catch) ────────────────────────
  const wsFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = wsFolders?.length ? wsFolders[0].uri.fsPath : undefined;

  let fileScore: FileScore;

  try {
    fileScore = await scanAndCache(filePath, binaryPath, workspaceRoot);
  } catch (err) {
    fileScore = handleScanError(err, filePath, relativePath, document, diagnosticCollection);
  }

  // ── fileScore IS GUARANTEED DEFINED HERE ───────────────────────────────

  // Compute delta (safe even if scan failed — monitor has the before snapshot)
  const delta = healthMonitor.snapshotAfter(filePath, fileScore.score);

  // Filter findings by document path — ensures all providers see consistent set
  const documentFindings = filterFindingsByFile(fileScore.findings, filePath);
  const totalRaw = fileScore.findings.length;
  const filteredCount = totalRaw - documentFindings.length;

  console.log(
    `[ailinter:scan] "${relativePath}": ${totalRaw} raw findings → ` +
    `${documentFindings.length} for this file (${filteredCount} filtered out)`
  );

  // ── Update all providers — each in its own try-catch ───────────────────
  updateAllProviders(document, filePath, fileScore, documentFindings, delta, relativePath, cachedBefore);
}

// ── Scan error handler ────────────────────────────────────────────────────────

/**
 * Handle a scan failure by returning a FileScore from cache or creating an
 * empty error result. Shows warnings and updates status bar to reflect error.
 * Extracted from scanActiveFile() to reduce function length and nesting depth.
 */
function handleScanError(
  err: unknown,
  filePath: string,
  relativePath: string,
  document: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection
): FileScore {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`AILINTER scan error: ${message}`);

  const cached = getCachedResult(filePath);
  if (cached) {
    const result: FileScore = { ...cached, lastScanned: new Date() };
    updateStatusBar(cached.score, { delta: undefined, findingCount: cached.findings.length, fileName: filePath });
    setStatusBarStale();
    vscode.window.showWarningMessage(
      `AILINTER scan failed for ${relativePath}. Showing cached score (${cached.lastScanned.toLocaleTimeString()}).`,
      { modal: false }
    );
    return result;
  }

  // No cache — create an empty error result with diagnostic
  const errorDiagnostic = new vscode.Diagnostic(
    new vscode.Range(0, 0, 0, 0),
    `🛡️ AILINTER scan failed: ${message}. Check the binary path and try again.`,
    vscode.DiagnosticSeverity.Information
  );
  errorDiagnostic.source = 'ailinter';
  diagnosticCollection.set(document.uri, [errorDiagnostic]);
  setStatusBarError(message);

  vscode.window.showWarningMessage(
    `AILINTER scan failed for ${relativePath}. No cached score available.`,
    { modal: false }
  );

  return {
    path: filePath, score: 0, previousScore: undefined, delta: undefined,
    lastScanned: new Date(), findings: [],
  };
}

// ── Provider update ───────────────────────────────────────────────────────────

/**
 * Update all VS Code providers with scan results (diagnostics, decorations,
 * codelens, hover, code actions, status bar, sidebar).
 * Each provider update is wrapped in its own try-catch so one failure doesn't
 * cascade and kill the entire scan.
 * Extracted from scanActiveFile() to reduce function length and bump count.
 */
function updateAllProviders(
  document: vscode.TextDocument,
  filePath: string,
  fileScore: FileScore,
  documentFindings: AilinterFinding[],
  delta: number | undefined,
  relativePath: string,
  cachedBefore: FileScore | undefined
): void {
  // Diagnostics (Problems panel)
  try { updateDiagnostics(document, documentFindings, diagnosticCollection); }
  catch (e) { console.error('[ailinter] diagnostics error:', e); }

  // Decorations (gutter icons + highlights)
  try {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.fileName === filePath) {
      applyDecorations(editor, documentFindings);
    }
  } catch (e) { console.error('[ailinter] decorations error:', e); }

  // CodeLens (function-level scores)
  try { codeLensProvider.updateResults(filePath, fileScore.score, documentFindings); }
  catch (e) { console.error('[ailinter] codelens error:', e); }

  // Hover (refactoring guidance)
  try { hoverProvider.updateFindings(filePath, documentFindings); }
  catch (e) { console.error('[ailinter] hover error:', e); }

  // Code Actions (Quick Fix lightbulb)
  try { codeActionProvider.updateFindings(filePath, documentFindings); }
  catch (e) { console.error('[ailinter] codeactions error:', e); }

  // Status bar — ALWAYS updates
  updateStatusBar(fileScore.score, { delta, findingCount: documentFindings.length, fileName: filePath });

  // Sidebar (project health)
  try { updateSidebar(); }
  catch (e) { console.error('[ailinter] sidebar error:', e); }

  // Regression notification
  try {
    if (delta !== undefined && delta < 0 && cachedBefore) {
      vscode.window.showWarningMessage(
        `AILINTER: ${relativePath} score regressed from ${fileScore.score - delta} → ${fileScore.score} (${delta})`,
        { modal: false }
      );
    }
  } catch (e) { console.error('[ailinter] regression notification error:', e); }
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
