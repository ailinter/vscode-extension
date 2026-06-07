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
    const topRange = new vscode.Range(0, 0, 0, 0);
    const scoreIcon = fileResult.score >= 80 ? '$(shield)' : '$(alert)';
    const scoreColor = fileResult.score >= 80 ? '🟢' : fileResult.score >= 60 ? '🟡' : '🔴';
    const findingCount = fileResult.findings.length;

    lenses.push(
      new vscode.CodeLens(topRange, {
        title: `${scoreColor} AILINTER: ${fileResult.score}/100  —  ${findingCount} issue${findingCount !== 1 ? 's' : ''}`,
        tooltip: `File quality score: ${fileResult.score}/100\n${findingCount} findings (${fileResult.findings.filter(f => f.severity === 'critical').length} critical, ${fileResult.findings.filter(f => f.severity === 'error').length} errors, ${fileResult.findings.filter(f => f.severity === 'warning').length} warnings)`,
        command: 'ailinter.showFileDetails',
        arguments: [document.fileName],
      })
    );

    // ── 2. Per-function / per-block issue clusters ──────────────────────────
    const clusters = this.clusterFindings(document, fileResult.findings);

    for (const cluster of clusters) {
      const range = new vscode.Range(cluster.startLine, 0, cluster.startLine, 0);
      const worst = worstSeverity(cluster.findings);
      const icon = worst === 'critical' ? '🔴' : worst === 'error' ? '🟠' : '🟡';
      const count = cluster.findings.length;

      lenses.push(
        new vscode.CodeLens(range, {
          title: `${icon} ${count} issue${count !== 1 ? 's' : ''}${cluster.label ? ` — ${cluster.label}` : ''}`,
          tooltip: cluster.findings.map(f => `[${f.severity}] ${f.message}`).join('\n'),
          command: 'ailinter.focusIssues',
          arguments: [cluster.findings.map(f => f.line)],
        })
      );
    }

    return lenses;
  }

  /**
   * Group findings into clusters (likely same function).
   * Findings within FUNCTION_GROUP_LINES of each other form a cluster.
   */
  private clusterFindings(
    document: vscode.TextDocument,
    findings: AilinterFinding[]
  ): { startLine: number; findings: AilinterFinding[]; label?: string }[] {
    if (findings.length === 0) return [];

    // Get function name at a given line (heuristic)
    const functionAtLine = (line: number): string | undefined => {
      for (let l = line; l >= 0; l--) {
        if (l >= document.lineCount) continue;
        const text = document.lineAt(l).text;
        // Match common function declarations
        const funcMatch = text.match(
          /(?:function\s+(\w+)|def\s+(\w+)|func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)|(\w+)\s*=\s*(?:function|\(|\w+\s*=>))/
        );
        if (funcMatch) {
          return funcMatch[1] || funcMatch[2] || funcMatch[3] || funcMatch[4];
        }
      }
      return undefined;
    };

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
          label: functionAtLine(current[0].line),
        });
        current = [curr];
      }
    }
    clusters.push({
      startLine: current[0].line,
      findings: current,
      label: functionAtLine(current[0].line),
    });

    return clusters;
  }
}

function worstSeverity(findings: AilinterFinding[]): string {
  if (findings.some(f => f.severity === 'critical')) return 'critical';
  if (findings.some(f => f.severity === 'error')) return 'error';
  return 'warning';
}
