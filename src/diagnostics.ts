/**
 * Problems panel integration: converts ailinter findings to VS Code Diagnostics.
 * Enhanced from MVP with support for critical severity, smell types as codes,
 * and delta annotations.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { AilinterFinding } from './types';

/**
 * Update the VS Code Problems panel with ailinter findings for a document.
 * Only findings matching the given document URI are included.
 */
export function updateDiagnostics(
  document: vscode.TextDocument,
  findings: AilinterFinding[],
  collection: vscode.DiagnosticCollection
): void {
  const diagnostics: vscode.Diagnostic[] = [];

  const docDir = path.dirname(document.fileName);
  const normalizedDoc = path.normalize(document.fileName);

  // Debug: trace how many findings we're processing and the document path
  console.log(`[ailinter:diagnostics] Processing ${findings.length} findings for "${document.fileName}"`);
  console.log(`[ailinter:diagnostics] docDir: "${docDir}" normalizedDoc: "${normalizedDoc}"`);

  let matched = 0;
  let filtered = 0;
  let debugLogged = 0;

  for (const finding of findings) {
    // Normalize paths: resolve relative finding paths against doc dir
    const findingPath = path.isAbsolute(finding.file)
      ? finding.file
      : path.resolve(docDir, finding.file);
    const normalizedFinding = path.normalize(findingPath);

    if (normalizedFinding !== normalizedDoc) {
      filtered++;
      if (debugLogged < 5) {
        console.log(
          `[ailinter:diagnostics] FILTERED: finding.file="${finding.file}" → ` +
          `normalized="${normalizedFinding}" !== doc="${normalizedDoc}"`
        );
        debugLogged++;
      }
      continue;
    }
    matched++;

    const line = Math.max(0, finding.line - 1);
    const column = Math.max(0, (finding.column || 1) - 1);

    const range = new vscode.Range(line, column, line, Number.MAX_SAFE_INTEGER);

    const severity = mapSeverity(finding.severity);

    const diagnostic = new vscode.Diagnostic(
      range,
      `[ailinter] ${finding.message}`,
      severity
    );
    diagnostic.source = `ailinter (${finding.category})`;
    diagnostic.code = finding.smellType || finding.category;

    // Tag secrets and vulnerabilities as unnecessary (for special highlighting)
    if (finding.category === 'secret' || finding.category === 'vulnerability') {
      diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
    }

    diagnostics.push(diagnostic);
  }

  console.log(
    `[ailinter:diagnostics] Result: ${matched} matched, ${filtered} filtered out, ` +
    `${diagnostics.length} diagnostics set for "${document.fileName}"`
  );
  collection.set(document.uri, diagnostics);
}

/**
 * Clear diagnostics for a document.
 */
export function clearDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): void {
  collection.delete(document.uri);
}

/**
 * Convert ailinter severity to VS Code DiagnosticSeverity.
 */
function mapSeverity(severity: string): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'critical':
      return vscode.DiagnosticSeverity.Error;
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}
