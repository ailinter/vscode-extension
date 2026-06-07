/**
 * Inline editor decorations: gutter icons + highlights + overview ruler markers.
 * Mirrors CodeScene's inline code smell visualisation.
 *
 * NOTE: `gutterIconPath` accepts `ThemeIcon` at runtime (VS Code 1.86+), but
 * `@types/vscode` types it as `string | Uri`. We use a safe type assertion.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { AilinterFinding } from './types';

// ── Helper — create decoration with ThemeIcon support ────────────────────────
// ThemeIcon in gutterIconPath works at runtime in VS Code 1.86+ but
// @types/vscode does not include it. The assertion is safe.
function createDecoration(
  icon: vscode.ThemeIcon,
  bgColor: string,
  rulerColor: string,
  extra?: Partial<vscode.DecorationRenderOptions>
): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    gutterIconPath: icon as unknown as string | vscode.Uri,
    gutterIconSize: 'contain',
    backgroundColor: bgColor,
    isWholeLine: true,
    overviewRulerColor: rulerColor,
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    ...extra,
  });
}

// ── Decoration definitions ───────────────────────────────────────────────────

const criticalDecoration = createDecoration(
  new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')),
  'rgba(255, 0, 0, 0.08)',
  'rgba(255, 0, 0, 0.8)'
);

const errorDecoration = createDecoration(
  new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange')),
  'rgba(255, 120, 0, 0.06)',
  'rgba(255, 120, 0, 0.7)'
);

const warningDecoration = createDecoration(
  new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.yellow')),
  'rgba(255, 200, 0, 0.04)',
  'rgba(255, 200, 0, 0.6)'
);

const secretDecoration = createDecoration(
  new vscode.ThemeIcon('lock', new vscode.ThemeColor('charts.red')),
  'rgba(248, 81, 73, 0.08)',
  'rgba(248, 81, 73, 0.9)',
  { textDecoration: 'underline wavy #f85149' }
);

const vulnerabilityDecoration = createDecoration(
  new vscode.ThemeIcon('bug', new vscode.ThemeColor('charts.purple')),
  'rgba(180, 80, 255, 0.06)',
  'rgba(180, 80, 255, 0.7)'
);

// All decoration types reference for cleanup
const ALL_DECORATIONS = [
  criticalDecoration,
  errorDecoration,
  warningDecoration,
  secretDecoration,
  vulnerabilityDecoration,
];

// ── Apply / clear ────────────────────────────────────────────────────────────

export function applyDecorations(
  editor: vscode.TextEditor,
  findings: AilinterFinding[]
): void {
  const criticals: vscode.DecorationOptions[] = [];
  const errors: vscode.DecorationOptions[] = [];
  const warnings: vscode.DecorationOptions[] = [];
  const secrets: vscode.DecorationOptions[] = [];
  const vulns: vscode.DecorationOptions[] = [];

  const normalizedDoc = path.normalize(editor.document.fileName);
  let matched = 0;
  let filtered = 0;
  let debugLogged = 0;

  for (const f of findings) {
    // Only apply to the currently open file (normalize paths to handle relative vs absolute)
    const findingPath = path.isAbsolute(f.file)
      ? f.file
      : path.resolve(path.dirname(editor.document.fileName), f.file);
    const normalizedFinding = path.normalize(findingPath);

    if (normalizedFinding !== normalizedDoc) {
      filtered++;
      if (debugLogged < 3) {
        console.log(
          `[ailinter:decorations] FILTERED: finding.file="${f.file}" → ` +
          `normalized="${normalizedFinding}" !== doc="${normalizedDoc}"`
        );
        debugLogged++;
      }
      continue;
    }
    matched++;

    const range = new vscode.Range(f.line - 1, 0, f.line - 1, 0);

    const md = new vscode.MarkdownString();
    const severityBadge = getSeverityBadge(f.severity);
    md.appendMarkdown(
      `**${severityBadge} [ailinter] ${f.smellType || f.category}**\n\n${f.message}`
    );
    if (f.smellType) {
      md.appendMarkdown(
        `\n\n[Get Refactoring Strategy](command:ailinter.getStrategy?${encodeURIComponent(
          JSON.stringify({ smell: f.smellType, file: f.file, line: f.line })
        )})`
      );
    }
    md.isTrusted = true;

    const opts: vscode.DecorationOptions = { range, hoverMessage: md };

    if (f.category === 'secret') {
      secrets.push(opts);
    } else if (f.category === 'vulnerability') {
      vulns.push(opts);
    } else if (f.severity === 'critical') {
      criticals.push(opts);
    } else if (f.severity === 'error') {
      errors.push(opts);
    } else {
      warnings.push(opts);
    }
  }

  console.log(
    `[ailinter:decorations] Result: ${matched} matched, ${filtered} filtered out ` +
    `for "${editor.document.fileName}"`
  );

  editor.setDecorations(criticalDecoration, criticals);
  editor.setDecorations(errorDecoration, errors);
  editor.setDecorations(warningDecoration, warnings);
  editor.setDecorations(secretDecoration, secrets);
  editor.setDecorations(vulnerabilityDecoration, vulns);
}

/** Clear all decorations from the editor */
export function clearDecorations(editor: vscode.TextEditor): void {
  for (const dec of ALL_DECORATIONS) {
    editor.setDecorations(dec, []);
  }
}

/** Dispose all decoration types (call on deactivate) */
export function disposeDecorations(): void {
  for (const dec of ALL_DECORATIONS) {
    dec.dispose();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSeverityBadge(severity: string): string {
  switch (severity) {
    case 'critical':
      return '🔴 Critical';
    case 'error':
      return '🟠 Error';
    case 'warning':
      return '🟡 Warning';
    default:
      return '🔵 Info';
  }
}
