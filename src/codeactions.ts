/**
 * Code Action (Quick Fix) provider:
 * - "Get Refactoring Strategy" for code quality smells
 * - "Replace Secret" for hardcoded secrets
 * - "Suppress Warning" to silence false positives
 * Mirrors CodeScene's Quick Fix lightbulb actions.
 */
import * as vscode from 'vscode';
import { AilinterFinding } from './types';

export class AilinterCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  private findings = new Map<string, AilinterFinding[]>();

  updateFindings(filePath: string, newFindings: AilinterFinding[]): void {
    this.findings.set(filePath, newFindings);
  }

  removeFile(filePath: string): void {
    this.findings.delete(filePath);
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.CodeAction[] | undefined {
    const fileFindings = this.findings.get(document.fileName);
    if (!fileFindings || fileFindings.length === 0) return undefined;

    // Get findings for the current line (considering multi-line ranges)
    const lineFindings = fileFindings.filter(
      f => f.line >= range.start.line + 1 && f.line <= range.end.line + 1
    );
    if (lineFindings.length === 0) return undefined;

    const actions: vscode.CodeAction[] = [];

    for (const f of lineFindings) {
      // ── 1. Refactoring strategy (quality smells) ──────────────────────────
      if (f.category === 'quality' && f.smellType) {
        const refactorAction = new vscode.CodeAction(
          `🔧 Get refactoring strategy for "${f.smellType}"`,
          vscode.CodeActionKind.QuickFix
        );
        refactorAction.command = {
          command: 'ailinter.getStrategy',
          title: 'Get Refactoring Strategy',
          arguments: [{ smell: f.smellType, file: f.file, line: f.line }],
        };
        refactorAction.diagnostics = [toDiagnostic(document, f)];
        refactorAction.isPreferred = true;
        actions.push(refactorAction);
      }

      // ── 2. Replace secret ──────────────────────────────────────────────
      if (f.category === 'secret') {
        const replaceAction = new vscode.CodeAction(
          '🔒 Replace with environment variable',
          vscode.CodeActionKind.QuickFix
        );
        replaceAction.command = {
          command: 'ailinter.replaceSecret',
          title: 'Replace Secret',
          arguments: [{ file: f.file, line: f.line }],
        };
        replaceAction.diagnostics = [toDiagnostic(document, f)];
        replaceAction.isPreferred = true;
        actions.push(replaceAction);
      }

      // ── 3. Vulnerability audit ──────────────────────────────────────────
      if (f.category === 'vulnerability') {
        const auditAction = new vscode.CodeAction(
          '🛡️ Review vulnerability details',
          vscode.CodeActionKind.QuickFix
        );
        auditAction.command = {
          command: 'ailinter.showVulnerabilityDetails',
          title: 'Vulnerability Details',
          arguments: [{ file: f.file, line: f.line, message: f.message }],
        };
        auditAction.diagnostics = [toDiagnostic(document, f)];
        actions.push(auditAction);
      }

      // ── 4. Suppress warning (for false positives / accepted risks) ─────
      const suppressAction = new vscode.CodeAction(
        '🔇 Suppress this warning',
        vscode.CodeActionKind.QuickFix
      );
      suppressAction.command = {
        command: 'ailinter.suppressWarning',
        title: 'Suppress Warning',
        arguments: [{ file: f.file, line: f.line, smellType: f.smellType }],
      };
      suppressAction.diagnostics = [toDiagnostic(document, f)];
      actions.push(suppressAction);
    }

    return actions;
  }
}

/** Convert an AilinterFinding to a VS Code Diagnostic */
function toDiagnostic(
  document: vscode.TextDocument,
  f: AilinterFinding
): vscode.Diagnostic {
  const line = Math.max(0, f.line - 1);
  const column = Math.max(0, (f.column || 1) - 1);
  const range = new vscode.Range(line, column, line, Number.MAX_SAFE_INTEGER);

  const severity =
    f.severity === 'critical' || f.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : f.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;

  const diagnostic = new vscode.Diagnostic(
    range,
    `[ailinter] ${f.message}`,
    severity
  );
  diagnostic.source = `ailinter (${f.category})`;
  diagnostic.code = f.smellType;
  return diagnostic;
}
