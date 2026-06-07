/**
 * AILINTER VS Code Extension — Main Entry Point
 *
 * Orchestrates all providers:
 *   - Diagnostics (Problems panel)
 *   - Decorations (gutter icons + inline highlights)
 *   - CodeLens (function-level scores with delta)
 *   - Hover (refactoring guidance)
 *   - CodeActions (Quick Fix lightbulb)
 *   - Sidebar (project health tree view)
 *   - Status bar (score + delta)
 *   - Monitor (git merge-base delta tracking)
 *   - Git poller (periodic git change detection)
 *   - File system watcher (external change detection)
 *   - Executor (concurrency limiting)
 *   - Webview panel (rich documentation + refactoring)
 *
 * Phase 2 features:
 *   - Git merge-base delta: compare scores against main branch
 *   - Executor chain: concurrency-limited scanning
 *   - Git change polling: detect external changes every 9s
 *   - File system watcher: 1s debounced re-scan
 *   - Delta-aware CodeLens: ▲/▼ score changes in annotations
 *   - Beside-column webview: rich docs + refactoring panel
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
import { AilinterFileDecorationProvider } from './fileDecorations';
import { enqueueScan } from './queue';
import { scanExecutor } from './executor';
import { GitChangePoller } from './gitWatcher';
import { AilinterWebviewPanel } from './webview/panel';
import {
  createStatusBar,
  updateStatusBar,
  setStatusBarError,
  setStatusBarIdle,
  setStatusBarScanning,
  setStatusBarStale,
} from './statusbar';
import { DeltaDashboardProvider } from './deltaDashboard';
import { registerRulesCommands } from './rulesUI';
import { SavedFilesTracker } from './savedFilesTracker';

// ── Module-level state ───────────────────────────────────────────────────────

let diagnosticCollection: vscode.DiagnosticCollection;
let codeLensProvider: AilinterCodeLensProvider;
let codeLensRegistration: vscode.Disposable;
let hoverProvider: AilinterHoverProvider;
let codeActionProvider: AilinterCodeActionProvider;
let sidebarProvider: AilinterSidebarProvider;
let healthMonitor: CodeHealthMonitor;
let statusBar: vscode.StatusBarItem;
let fileDecorationProvider: AilinterFileDecorationProvider;
let webviewPanel: AilinterWebviewPanel;
let gitPoller: GitChangePoller | undefined;
let deltaDashboard: DeltaDashboardProvider;
let savedFilesTracker: SavedFilesTracker;

/** Per-file debounce timers for edit-triggered scans (onDidChangeTextDocument) */
const changeTimers = new Map<string, NodeJS.Timeout>();

/** Extension context, stored on activate for use by commands */
let extensionContext: vscode.ExtensionContext | undefined;

// ── Activate ─────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // Store context for use by command handlers
  extensionContext = context;

  // ── Initialize core components ─────────────────────────────────────────

  // Diagnostics collection (Problems panel)
  diagnosticCollection = vscode.languages.createDiagnosticCollection('ailinter');
  context.subscriptions.push(diagnosticCollection);

  // Status bar
  statusBar = createStatusBar();
  setStatusBarIdle();
  context.subscriptions.push(statusBar);

  // Health monitor (git merge-base delta tracking)
  healthMonitor = new CodeHealthMonitor();

  // Webview panel (rich documentation + refactoring)
  webviewPanel = new AilinterWebviewPanel();
  context.subscriptions.push({ dispose: () => webviewPanel.dispose() });

  // CodeLens provider — function-level scores with delta awareness
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

  // ── Delta Dashboard webview view (Feature 1) ─────────────────────────
  deltaDashboard = new DeltaDashboardProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DeltaDashboardProvider.viewType,
      deltaDashboard
    )
  );

  // ── Saved Files Tracker (Feature 3) ───────────────────────────────────
  savedFilesTracker = new SavedFilesTracker(context);
  savedFilesTracker.start();
  context.subscriptions.push({ dispose: () => savedFilesTracker.dispose() });

  // ── Commands ───────────────────────────────────────────────────────────
  registerCommands(context);

  // ── Register rules customization commands (Feature 2) ──────────────────
  registerRulesCommands(context);

  // ── FileDecorationProvider (Explorer file badges) ──────────────────────
  fileDecorationProvider = new AilinterFileDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(fileDecorationProvider)
  );

  // ── Event handlers ─────────────────────────────────────────────────────
  registerEventHandlers(context);

  // ── Git Change Poller ──────────────────────────────────────────────────
  // Periodically detects files changed via external tools (rebases, stashes).
  // Feature 3: Only re-scans files the user actually saved in the editor.
  // CodeScene pattern: GitChangeLister with 9s polling cadence.
  const wsFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = wsFolders?.length ? wsFolders[0].uri.fsPath : undefined;
  if (workspaceRoot) {
    gitPoller = new GitChangePoller(workspaceRoot, 9000);
    gitPoller.onDidChangeFiles((files) => {
      const activeFile = vscode.window.activeTextEditor?.document.fileName;
      if (activeFile && files.includes(vscode.workspace.asRelativePath(activeFile))) {
        // Feature 3: Only re-scan if the user saved this file in the editor
        if (savedFilesTracker.wasSavedByUser(activeFile)) {
          scanActiveFile(vscode.window.activeTextEditor!.document);
          // Clear the tracker entry so we don't re-scan on the next poll
          savedFilesTracker.removeFromTracker(activeFile);
        }
      }
    });
    gitPoller.start();
    context.subscriptions.push({ dispose: () => gitPoller?.stop() });
  }

  // ── File System Watcher ────────────────────────────────────────────────
  // Watches for external file changes (e.g., git checkout, editor outside VS Code).
  // Uses 1s debounce to avoid thrashing (CodeScene pattern from git-change-observer.ts).
  const fileWatcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{go,py,js,ts,jsx,tsx,java,cs,php,rb}'
  );
  let watcherTimer: NodeJS.Timeout | undefined;

  const handleExternalChange = (uri: vscode.Uri) => {
    const activeFile = vscode.window.activeTextEditor?.document.fileName;
    if (activeFile === uri.fsPath) {
      if (watcherTimer) clearTimeout(watcherTimer);
      watcherTimer = setTimeout(() => {
        const editor = vscode.window.activeTextEditor;
        if (editor) scanActiveFile(editor.document);
      }, 1000); // 1s debounce like CodeScene GitChangeObserver
    }
  };

  fileWatcher.onDidChange(handleExternalChange);
  fileWatcher.onDidCreate(handleExternalChange);
  context.subscriptions.push(fileWatcher);

  // ── Scan active file on activation ─────────────────────────────────────
  scanActiveFileOnActivation();

  // ── First-run welcome ──────────────────────────────────────────────────
  showFirstRunWelcome(context);

  // ── Log activation ─────────────────────────────────────────────────────
  console.log('AILINTER extension activated — Phase 2: git delta, executor, watchers, webview');
}

// ── Deactivate ───────────────────────────────────────────────────────────────

export function deactivate(): void {
  if (gitPoller) gitPoller.stop();
  if (diagnosticCollection) {
    diagnosticCollection.clear();
    diagnosticCollection.dispose();
  }
  disposeDecorations();
  clearCache();
  healthMonitor.clear();
  webviewPanel.dispose();

  // Clear all pending debounce timers
  for (const timer of changeTimers.values()) {
    clearTimeout(timer);
  }
  changeTimers.clear();

  console.log('AILINTER extension deactivated');
}

// ── Command registrations ────────────────────────────────────────────────────

/**
 * Register all AILINTER commands with VS Code.
 * Extracted from activate() to reduce function length and bump count.
 */
function registerCommands(context: vscode.ExtensionContext): void {
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
  // Phase 2: webview documentation commands
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.openDocs', handleOpenDocs)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.openRefactoring', handleOpenRefactoring)
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
  // Open Problems panel (same as Cmd+Shift+M)
  vscode.commands.executeCommand('workbench.actions.view.problems');
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
  const { smell, file, line } = args;

  // Try to open the webview panel first; fall back to external URL
  try {
    const context = getExtensionContext();
    if (context) {
      webviewPanel.showRefactoring(smell, file, line, context);
      return;
    }
  } catch {
    // Fall through to external URL
  }

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

/**
 * Phase 2: Open webview documentation for a code smell.
 * Triggered from hover, diagnostics, or command palette.
 */
function handleOpenDocs(args: { smell: string }): void {
  const context = getExtensionContext();
  if (context) {
    webviewPanel.showDocumentation(args.smell, context);
  }
}

/**
 * Phase 2: Open webview refactoring panel for a code smell.
 * Triggered from CodeAction "Open Docs Panel" or other entry points.
 */
function handleOpenRefactoring(args: { smell: string; file: string; line: number }): void {
  const context = getExtensionContext();
  if (context) {
    webviewPanel.showRefactoring(args.smell, args.file, args.line, context);
  }
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
      // Always cancel any pending debounced edit scan — save is authoritative
      const timer = changeTimers.get(document.fileName);
      if (timer) {
        clearTimeout(timer);
        changeTimers.delete(document.fileName);
      }
      await scanActiveFile(document);
    })
  );

  // On edit: debounced scan after 1s of inactivity (catches auto-save, undo, etc.)
  // Uses per-file timers (CodeScene pattern from open-files-observer.ts).
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.isUntitled) return;
      const config = vscode.workspace.getConfiguration('ailinter');
      if (!config.get<boolean>('enable', true)) return;

      const filePath = e.document.fileName;
      const existingTimer = changeTimers.get(filePath);
      if (existingTimer) clearTimeout(existingTimer);

      changeTimers.set(
        filePath,
        setTimeout(() => {
          changeTimers.delete(filePath);
          scanActiveFile(e.document);
        }, 1000)
      );
    })
  );

  // On file open: apply decorations if we have cached results
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      const cached = getCachedResult(editor.document.fileName);
      if (cached) {
        applyDecorations(editor, cached.findings);
        updateStatusBar(cached.score, { delta: cached.delta });
      } else {
        const config = vscode.workspace.getConfiguration('ailinter');
        if (config.get<boolean>('scanOnOpen', true)) {
          scanActiveFile(editor.document);
        } else {
          setStatusBarIdle();
        }
      }
    })
  );

  // On file close: clean up
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      // Cancel any pending debounced scan
      const timer = changeTimers.get(document.fileName);
      if (timer) {
        clearTimeout(timer);
        changeTimers.delete(document.fileName);
      }
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

  // ── Config file watcher: auto re-scan when .ailinter.toml changes ──────
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/.ailinter.toml');
  configWatcher.onDidChange(() => {
    console.log('[ailinter] .ailinter.toml changed — clearing cache and re-scanning');
    clearCache();
    codeLensProvider.clearMeta();
    const editor = vscode.window.activeTextEditor;
    if (editor) scanActiveFile(editor.document);
  });
  configWatcher.onDidCreate(() => {
    console.log('[ailinter] .ailinter.toml created — clearing cache and re-scanning');
    clearCache();
    codeLensProvider.clearMeta();
    const editor = vscode.window.activeTextEditor;
    if (editor) scanActiveFile(editor.document);
  });
  configWatcher.onDidDelete(() => {
    console.log('[ailinter] .ailinter.toml deleted — clearing cache and re-scanning');
    clearCache();
    codeLensProvider.clearMeta();
    const editor = vscode.window.activeTextEditor;
    if (editor) scanActiveFile(editor.document);
  });
  context.subscriptions.push(configWatcher);
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
 * Phase 2 enhancements:
 *  - Concurrency-limited via scanExecutor
 *  - Git merge-base delta computed alongside in-memory delta
 *  - Delta passed through to CodeLens provider
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

  const wsFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = wsFolders?.length ? wsFolders[0].uri.fsPath : undefined;

  // ── 1. Pre-scan: snapshot current score ────────────────────────────────
  const cachedBefore = getCachedResult(filePath);
  healthMonitor.snapshotBefore(filePath, cachedBefore?.score);

  // ── 2. Update UI — scanning state ──────────────────────────────────────
  setStatusBarScanning(relativePath);

  // ── 3. Run ailinter (concurrency-limited via scanExecutor) ─────────────
  let fileScore: FileScore;

  try {
    // Use per-file queue to deduplicate concurrent scans of the same file,
    // AND the concurrency-limiting executor to limit total binary invocations.
    fileScore = await enqueueScan(filePath, () =>
      scanExecutor.execute(() =>
        scanAndCache(filePath, binaryPath, workspaceRoot)
      )
    );
  } catch (err) {
    fileScore = handleScanError(err, filePath, relativePath, document, diagnosticCollection);
  }

  // ── fileScore IS GUARANTEED DEFINED HERE ───────────────────────────────

  // ── 4. Compute deltas ──────────────────────────────────────────────────
  // In-memory delta (before/after snapshot)
  const delta = healthMonitor.snapshotAfter(filePath, fileScore.score);

  // Git merge-base delta (compare vs main branch)
  let gitDelta: number | undefined;
  try {
    gitDelta = await healthMonitor.computeGitDelta(
      filePath,
      fileScore.score,
      binaryPath,
      workspaceRoot
    );
  } catch {
    gitDelta = undefined; // Silent fail — git might not be available
  }

  // ── 5. Filter findings ─────────────────────────────────────────────────
  const documentFindings = filterFindingsByFile(fileScore.findings, filePath);
  const totalRaw = fileScore.findings.length;
  const filteredCount = totalRaw - documentFindings.length;

  console.log(
    `[ailinter:scan] "${relativePath}": ${totalRaw} raw findings → ` +
    `${documentFindings.length} for this file (${filteredCount} filtered out)` +
    (gitDelta !== undefined ? ` | git-delta: ${gitDelta}` : '')
  );

  // ── 6. Update all providers ────────────────────────────────────────────
  updateAllProviders(document, filePath, fileScore, documentFindings, delta, relativePath, cachedBefore);

  // Store git delta in CodeLens for delta-aware display
  try {
    codeLensProvider.updateResults(filePath, fileScore.score, documentFindings, delta, gitDelta);
  } catch (e) {
    console.error('[ailinter] codelens delta update error:', e);
  }
}

// ── Scan error handler ────────────────────────────────────────────────────────

/**
 * Handle a scan failure by returning a FileScore from cache or creating an
 * empty error result. Shows warnings and updates status bar to reflect error.
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
    updateStatusBar(cached.score);
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

  // File decorations (Explorer file badges)
  try {
    fileDecorationProvider.updateFileIssues(filePath, documentFindings.length);
  } catch (e) { console.error('[ailinter] fileDecorations error:', e); }

  // Decorations (gutter icons + highlights)
  try {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.fileName === filePath) {
      applyDecorations(editor, documentFindings);
    }
  } catch (e) { console.error('[ailinter] decorations error:', e); }

  // CodeLens (function-level scores) — updated separately with delta

  // Hover (refactoring guidance)
  try { hoverProvider.updateFindings(filePath, documentFindings); }
  catch (e) { console.error('[ailinter] hover error:', e); }

  // Code Actions (Quick Fix lightbulb)
  try { codeActionProvider.updateFindings(filePath, documentFindings); }
  catch (e) { console.error('[ailinter] codeactions error:', e); }

  // Status bar — ALWAYS updates
  updateStatusBar(fileScore.score, { delta });

  // Sidebar (project health)
  try { updateSidebar(); }
  catch (e) { console.error('[ailinter] sidebar error:', e); }

  // Delta Dashboard (Feature 1) — update with all cached results
  try { updateDeltaDashboard(); }
  catch (e) { console.error('[ailinter] deltaDashboard error:', e); }

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

// ── Delta Dashboard Update (Feature 1) ────────────────────────────────────────

/**
 * Push all cached scan results to the delta dashboard webview.
 * Called after every scan and on cache changes.
 */
function updateDeltaDashboard(): void {
  const allScores = getAllCachedResults();
  const entries = allScores.map(f => ({
    path: f.path,
    score: f.score,
    delta: f.delta,
    findings: f.findings.length,
  }));
  deltaDashboard.update(entries);
}

// ── Extension context access ──────────────────────────────────────────────────

/**
 * Get the extension context stored during activation.
 * Used by commands that need to pass context to the webview panel.
 */
function getExtensionContext(): vscode.ExtensionContext | undefined {
  return extensionContext;
}
