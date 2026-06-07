/**
 * CodeLens provider: shows function-level quality scores and per-function
 * issue counts above each function — similar to CodeScene's inline annotations.
 */
import * as vscode from 'vscode';
import { AilinterFinding } from './types';

// ── Grouping threshold: findings within this many lines are considered
//     part of the same function / logical block.
const FUNCTION_GROUP_LINES = 20;

export class AilinterCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  /** Per-file results: fileName → { score, findings } */
  private results = new Map<string, { score: number; findings: AilinterFinding[] }>();

  /** Getter for the number of cached results (for status reporting) */
  get cachedCount(): number {
    return this.results.size;
  }

  /**
   * Called by extension.ts when new scan results arrive.
   * Fires change event so lenses re-render.
   */
  updateResults(filePath: string, score: number, findings: AilinterFinding[]): void {
    this.results.set(filePath, { score, findings });
    this._onDidChangeCodeLenses.fire();
  }

  /** Remove stale results for files that no longer exist */
  removeFile(filePath: string): void {
    this.results.delete(filePath);
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const fileResult = this.results.get(document.fileName);
    if (!fileResult) return [];

    const lenses: vscode.CodeLens[] = [];

    // ── 1. File-level score at the very top ────────────────────────────────
    lenses.push(buildFileScoreLens(document, fileResult));

    // ── 2. Per-function / per-block issue clusters ──────────────────────────
    const clusters = clusterFindings(document, fileResult.findings);
    for (const cluster of clusters) {
      lenses.push(buildClusterLens(cluster));
    }

    return lenses;
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

function buildFileScoreLens(
  document: vscode.TextDocument,
  fileResult: { score: number; findings: AilinterFinding[] }
): vscode.CodeLens {
  const topRange = new vscode.Range(0, 0, 0, 0);
  const findingCount = fileResult.findings.length;

  const severityCounts = countFindingsBySeverity(fileResult.findings);
  const tooltip = `File quality score: ${fileResult.score}/100\n${findingCount} findings (${severityCounts.critical} critical, ${severityCounts.error} errors, ${severityCounts.warning} warnings)`;

  return new vscode.CodeLens(topRange, {
    title: formatScoreTitle(fileResult.score, findingCount),
    tooltip,
    command: 'ailinter.showFileDetails',
    arguments: [document.fileName],
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

function formatScoreTitle(score: number, findingCount: number): string {
  const scoreColor = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';
  return `${scoreColor} AILINTER: ${score}/100  —  ${findingCount} issue${findingCount !== 1 ? 's' : ''}`;
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
