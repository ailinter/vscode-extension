/**
 * CodeLens provider: shows function-level quality scores and per-function
 * issue counts above each function — similar to CodeScene's inline annotations.
 *
 * Phase 2 enhancement: delta-aware CodeLens now shows ▲/▼ score changes
 * compared to the git merge-base, alongside the absolute score.
 *
 * Uses resolveCodeLens for lazy command resolution to avoid VS Code's
 * CommandsConverter cache disposal issue (CS-5276 pattern from CodeScene).
 * Commands with arguments are cached internally by VS Code and disposed when
 * providers refresh — by resolving lazily, we avoid this caching entirely.
 */
import * as vscode from 'vscode';
import { AilinterFinding } from './types';

// ── Grouping threshold: findings within this many lines are considered
//     part of the same function / logical block.
const FUNCTION_GROUP_LINES = 20;

export class AilinterCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  /** Per-file results: fileName → { score, findings, delta } */
  private results = new Map<string, {
    score: number;
    findings: AilinterFinding[];
    delta?: number;
    gitDelta?: number;
  }>();

  /**
   * Metadata for lazy CodeLens resolution.
   * Keyed by `${range.start.line}:${range.start.character}` for uniqueness.
   */
  private lensMeta = new Map<string, {
    filePath: string;
    score: number;
    findingCount: number;
  }>();

  /** Getter for the number of cached results (for status reporting) */
  get cachedCount(): number {
    return this.results.size;
  }

  /**
   * Called by extension.ts when new scan results arrive.
   * Fires change event so lenses re-render.
   *
   * @param filePath Absolute path to the scanned file
   * @param score Current quality score
   * @param findings Detected findings
   * @param delta Optional delta from last snapshot (in-memory before/after)
   * @param gitDelta Optional git merge-base delta (vs main branch)
   */
  updateResults(
    filePath: string,
    score: number,
    findings: AilinterFinding[],
    delta?: number,
    gitDelta?: number
  ): void {
    this.results.set(filePath, { score, findings, delta, gitDelta });
    this._onDidChangeCodeLenses.fire();
  }

  /** Remove stale results for files that no longer exist */
  removeFile(filePath: string): void {
    this.results.delete(filePath);
    this.lensMeta.clear();
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const fileResult = this.results.get(document.fileName);
    if (!fileResult) return [];

    const lenses: vscode.CodeLens[] = [];

    // ── 1. File-level score at the very top ────────────────────────────────
    const scoreLens = buildFileScoreLens(document.fileName, fileResult);
    this.lensMeta.set('__file__', {
      filePath: document.fileName,
      score: fileResult.score,
      findingCount: fileResult.findings.length,
    });
    lenses.push(scoreLens);

    // ── 2. Per-function / per-block issue clusters ──────────────────────────
    const clusters = clusterFindings(document, fileResult.findings);
    for (const cluster of clusters) {
      const clusterLens = buildClusterLens(cluster);
      const key = `${cluster.startLine}:0`;
      this.lensMeta.set(key, {
        filePath: document.fileName,
        score: fileResult.score,
        findingCount: cluster.findings.length,
      });
      lenses.push(clusterLens);
    }

    return lenses;
  }

  /**
   * Lazy command resolution — VS Code calls this when a CodeLens becomes visible.
   * This avoids the CommandsConverter cache disposal issue that causes
   * "Actual command not found" errors when providers refresh.
   */
  async resolveCodeLens(codeLens: vscode.CodeLens, _token: vscode.CancellationToken): Promise<vscode.CodeLens> {
    const key = `${codeLens.range.start.line}:${codeLens.range.start.character}`;
    const meta = this.lensMeta.get(key) || this.lensMeta.get('__file__');
    if (meta && codeLens.command) {
      codeLens.command.arguments = [meta.filePath];
    }
    return codeLens;
  }

  /** Clear lens metadata (e.g., on cache invalidation) */
  clearMeta(): void {
    this.lensMeta.clear();
  }

  /**
   * Get the delta for a specific file (used by extension.ts to pass through).
   */
  getFileDelta(filePath: string): number | undefined {
    const r = this.results.get(filePath);
    return r?.delta;
  }

  /**
   * Get the git delta for a specific file.
   */
  getFileGitDelta(filePath: string): number | undefined {
    const r = this.results.get(filePath);
    return r?.gitDelta;
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function buildFileScoreLens(
  filePath: string,
  fileResult: { score: number; findings: AilinterFinding[]; delta?: number; gitDelta?: number }
): vscode.CodeLens {
  const topRange = new vscode.Range(0, 0, 0, 0);
  const findingCount = fileResult.findings.length;

  const severityCounts = countFindingsBySeverity(fileResult.findings);

  // Only show git merge-base delta in file-level CodeLens (vs main branch).
  // The in-memory before/after delta defaults to undefined for first scans
  // and is too noisy for inline display — we show it in status bar instead.
  const displayDelta = fileResult.gitDelta;

  return new vscode.CodeLens(topRange, {
    title: formatScoreTitle(fileResult.score, findingCount, displayDelta),
    tooltip: buildScoreTooltip(fileResult.score, findingCount, severityCounts, displayDelta),
    command: 'ailinter.showFileDetails',
    arguments: [filePath],
  });
}

function buildClusterLens(
  cluster: { startLine: number; findings: AilinterFinding[]; label?: string }
): vscode.CodeLens {
  const range = new vscode.Range(cluster.startLine, 0, cluster.startLine, 0);
  const worst = worstSeverity(cluster.findings);
  const icon = worst === 'critical' ? '🔴' : worst === 'error' ? '🟠' : '🟡';
  const count = cluster.findings.length;
  const label = cluster.label ? ` — ${cluster.label}` : '';

  return new vscode.CodeLens(range, {
    title: `${icon} ${count} issue${count !== 1 ? 's' : ''}${label}`,
    tooltip: cluster.findings.map(f => `[${f.severity}] ${f.message}`).join('\n'),
    command: 'ailinter.focusIssues',
    arguments: [cluster.findings.map(f => f.line)],
  });
}

/**
 * Format the score title with optional delta indicator.
 *
 * Display patterns:
 *   🟢 AILINTER: 85/100  ▲ +6  — 3 issues   (improvement)
 *   🔴 AILINTER: 72/100  ▼ -3  — 5 issues   (regression)
 *   🟢 AILINTER: 85/100  — 3 issues          (no delta)
 */
function formatScoreTitle(score: number, findingCount: number, delta?: number): string {
  const scoreColor = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';
  const deltaStr = buildDeltaString(delta);
  return `${scoreColor} AILINTER: ${score}/100${deltaStr} — ${findingCount} issue${findingCount !== 1 ? 's' : ''}`;
}

/**
 * Build the tooltip with severity breakdown and delta info.
 */
function buildScoreTooltip(
  score: number,
  findingCount: number,
  severityCounts: { critical: number; error: number; warning: number },
  delta?: number
): string {
  let tip = `File quality score: ${score}/100\n`;
  tip += `${findingCount} findings (${severityCounts.critical} critical, ${severityCounts.error} errors, ${severityCounts.warning} warnings)`;

  if (delta !== undefined) {
    if (delta > 0) {
      tip += `\n\n🟢 Improved by ${delta} points since last scan`;
    } else if (delta < 0) {
      tip += `\n\n🔴 Regressed by ${Math.abs(delta)} points since last scan`;
    }
  }

  return tip;
}

/**
 * Build a delta string for display, e.g. "  ▲ +6" or "  ▼ -3".
 */
function buildDeltaString(delta?: number): string {
  if (delta === undefined || delta === 0) return '';
  return delta > 0 ? `  ▲ +${delta}` : `  ▼ ${delta}`;
}

function countFindingsBySeverity(findings: AilinterFinding[]): { critical: number; error: number; warning: number } {
  return {
    critical: findings.filter(f => f.severity === 'critical').length,
    error: findings.filter(f => f.severity === 'error').length,
    warning: findings.filter(f => f.severity === 'warning').length,
  };
}

/**
 * Group findings into clusters (likely same function).
 * Findings within FUNCTION_GROUP_LINES of each other form a cluster.
 */
function clusterFindings(
  document: vscode.TextDocument,
  findings: AilinterFinding[]
): { startLine: number; findings: AilinterFinding[]; label?: string }[] {
  if (findings.length === 0) return [];

  // Sort by line
  const sorted = [...findings].sort((a, b) => a.line - b.line);
  const clusters: { startLine: number; findings: AilinterFinding[]; label?: string }[] = [];
  let current: AilinterFinding[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.line - prev.line <= FUNCTION_GROUP_LINES) {
      current.push(curr);
    } else {
      clusters.push({
        startLine: current[0].line,
        findings: current,
        label: findFunctionName(document, current[0].line),
      });
      current = [curr];
    }
  }
  clusters.push({
    startLine: current[0].line,
    findings: current,
    label: findFunctionName(document, current[0].line),
  });

  return clusters;
}

/**
 * Get function name at a given line (heuristic).
 * Scans backwards from the given line to find the nearest function declaration.
 */
function findFunctionName(document: vscode.TextDocument, line: number): string | undefined {
  const FUNC_PATTERN = /(?:function\s+(\w+)|def\s+(\w+)|func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)|(\w+)\s*=\s*(?:function|\(|\w+\s*=>))/;
  for (let l = line; l >= 0; l--) {
    if (l >= document.lineCount) continue;
    const text = document.lineAt(l).text;
    const funcMatch = text.match(FUNC_PATTERN);
    if (funcMatch) {
      return funcMatch[1] || funcMatch[2] || funcMatch[3] || funcMatch[4];
    }
  }
  return undefined;
}

function worstSeverity(findings: AilinterFinding[]): string {
  if (findings.some(f => f.severity === 'critical')) return 'critical';
  if (findings.some(f => f.severity === 'error')) return 'error';
  return 'warning';
}
