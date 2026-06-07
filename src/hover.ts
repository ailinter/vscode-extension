/**
 * Hover provider: shows rich hover information with smell descriptions
 * and refactoring guidance — mirroring CodeScene's "Refactoring Guidance" UX.
 */
import * as vscode from 'vscode';
import { AilinterFinding, KNOWN_SMELLS } from './types';

export class AilinterHoverProvider implements vscode.HoverProvider {
  /** Per-file findings cache, keyed by absolute file path */
  private findings = new Map<string, AilinterFinding[]>();

  updateFindings(filePath: string, newFindings: AilinterFinding[]): void {
    this.findings.set(filePath, newFindings);
  }

  removeFile(filePath: string): void {
    this.findings.delete(filePath);
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const fileFindings = this.findings.get(document.fileName);
    if (!fileFindings || fileFindings.length === 0) return undefined;

    // Check all findings on this line
    const lineFindings = fileFindings.filter(f => f.line === position.line + 1);
    if (lineFindings.length === 0) return undefined;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    for (let i = 0; i < lineFindings.length; i++) {
      const f = lineFindings[i];
      if (i > 0) md.appendMarkdown('\n\n---\n\n');

      // ── Header: severity badge + smell name ────────────────────────────
      const badge = severityBadge(f.severity);
      md.appendMarkdown(`### ${badge}: ${f.smellType || f.category}\n\n`);

      // ── Finding message ────────────────────────────────────────────────
      md.appendMarkdown(`${f.message}\n\n`);

      // ── Category-specific guidance ──────────────────────────────────────
      if (f.category === 'quality' && f.smellType) {
        md.appendMarkdown('---\n\n');
        md.appendMarkdown('**🔧 Refactoring Guidance**\n\n');
        md.appendMarkdown(
          `This is a code quality issue of type \`${f.smellType}\`. ` +
            'Run the refactoring strategy command for step-by-step instructions.\n\n'
        );
        md.appendMarkdown(
          `[$(lightbulb) Get Refactoring Strategy](command:ailinter.getStrategy?${encodeURIComponent(
            JSON.stringify({ smell: f.smellType, file: f.file, line: f.line })
          )})`
        );
      }

      if (f.category === 'secret') {
        md.appendMarkdown('---\n\n');
        md.appendMarkdown('⚠️ **Hardcoded Secret Detected**\n\n');
        md.appendMarkdown(
          'Replace this hardcoded credential with an environment variable:\n\n'
        );
        md.appendMarkdown('```\n' +
          '// Instead of hardcoding:\n' +
          'apiKey = "sk-..."\n\n' +
          '// Use an environment variable:\n' +
          'apiKey = process.env.API_KEY\n' +
          '```\n\n');
        md.appendMarkdown(
          `[$(lock) Replace with Env Var](command:ailinter.replaceSecret?${encodeURIComponent(
            JSON.stringify({ file: f.file, line: f.line })
          )})`
        );
      }

      if (f.category === 'vulnerability') {
        md.appendMarkdown('---\n\n');
        md.appendMarkdown('⚠️ **Security Vulnerability**\n\n');
        md.appendMarkdown(
          'This vulnerability should be addressed immediately. ' +
            'Review the OWASP guidelines for the specific pattern detected.'
        );
      }

      if (f.category === 'metalinter') {
        md.appendMarkdown('---\n\n');
        md.appendMarkdown('**Go Metalinter Issue**\n\n');
        md.appendMarkdown(
          'This was detected by one of the embedded Go linters ' +
            '(go vet, staticcheck, gofmt, misspell, ineffassign).'
        );
      }
    }

    const hoverRange = new vscode.Range(
      position.line,
      0,
      position.line,
      document.lineAt(position.line).text.length
    );

    return new vscode.Hover(md, hoverRange);
  }
}

function severityBadge(severity: string): string {
  switch (severity) {
    case 'critical':
      return '🔴 CRITICAL';
    case 'error':
      return '🟠 ERROR';
    case 'warning':
      return '🟡 WARNING';
    default:
      return '🔵 INFO';
  }
}
