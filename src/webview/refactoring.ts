/**
 * Webview refactoring suggestion HTML — displays actionable refactoring
 * guidance fetched from the ailinter CLI.
 *
 * Fetches real refactoring strategy data from the ailinter CLI
 * (get-refactoring-strategy command) instead of using hardcoded examples.
 *
 * Inspired by CodeScene's refactoring-components.ts and the refactoring
 * presentation pattern in CodeSceneTabPanel.
 */

import * as cp from 'child_process';
import * as vscode from 'vscode';
import { promisify } from 'util';

const execAsync = promisify(cp.exec);

/**
 * Fetch real refactoring strategy from the ailinter CLI.
 * Calls `ailinter get-refactoring-strategy <smell_type>` which returns
 * markdown with step-by-step instructions, before/after Go code examples,
 * and verification checklists.
 *
 * Falls back to a descriptive error message if the binary isn't available
 * or the smell type isn't found.
 *
 * @param smellType The code smell type (e.g., "deep_nesting", "bumpy_road")
 * @param binaryPath Path to the ailinter binary (default: "ailinter")
 * @returns Markdown string with the refactoring strategy
 */
export async function getRefactoringStrategy(
  smellType: string,
  binaryPath: string = 'ailinter'
): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `${binaryPath} get-refactoring-strategy ${smellType}`,
      {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      }
    );
    return stdout;
  } catch (err: any) {
    return `# ${formatSmellName(smellType)}\n\nUnable to fetch refactoring strategy: ${err.message || 'Unknown error'}\n\nMake sure the ailinter binary is installed and up to date (≥ v0.9.0).`;
  }
}

/**
 * Build the full HTML for the refactoring strategy page, showing real
 * before/after code examples fetched from the ailinter CLI.
 *
 * @param smellType The code smell type (e.g., "deep_nesting")
 * @param strategyOutput Raw markdown output from `ailinter get-refactoring-strategy`
 * @param filePath Optional absolute path to the file being refactored
 * @param line Optional line number of the issue
 * @returns Complete HTML document string
 */
export function buildRefactoringHtml(
  smellType: string,
  strategyOutput: string,
  filePath?: string,
  line?: number
): string {
  const smellName = formatSmellName(smellType);
  const locationHtml = filePath
    ? `<p class="file-location">📄 ${escapeHtml(getRelativePath(filePath))}${line ? `:${line}` : ''}</p>`
    : '';
  const html = markdownToHtml(strategyOutput);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' 'unsafe-eval' https:; font-src 'self' https:;">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/vs2015.min.css" integrity="sha384-BE+nmfgoK1j3fBxbLI64Jzf52Mx/QAyw+4O7GyPYevJnAyrljCoRtQkYNfCfuWPF" crossorigin="anonymous">
  <style>
    body { padding: 24px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 14px); color: var(--vscode-foreground); background: var(--vscode-editor-background); line-height: 1.6; max-width: 800px; margin: 0 auto; }
    h1 { font-size: 1.4em; font-weight: 600; color: var(--vscode-textLink-foreground); margin-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 12px; }
    h2 { font-size: 1.15em; margin-top: 24px; margin-bottom: 8px; color: var(--vscode-sideBarTitle-foreground); font-weight: 600; }
    h3 { font-size: 1.05em; margin-top: 20px; margin-bottom: 6px; font-weight: 600; }
    p { margin-bottom: 12px; }
    pre { background: var(--vscode-textCodeBlock-background); padding: 16px; border-radius: 6px; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: 13px; line-height: 1.5; border: 1px solid var(--vscode-panel-border); }
    code { font-family: var(--vscode-editor-font-family); }
    :not(pre) > code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
    ul, ol { margin-bottom: 12px; padding-left: 24px; }
    li { margin-bottom: 4px; }
    strong { font-weight: 600; }
    .file-location { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    #stale-warning { display: none; padding: 8px; background: var(--vscode-inputValidation-warningBackground); margin-top: 12px; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>🔧 ${smellName}</h1>
  ${locationHtml}
  <div id="content">
    ${html}
  </div>
  <div id="stale-warning"></div>
  <script>
    const acquireVsCodeApi = (function() {
      let api;
      return function() { if (!api) api = (typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : { postMessage: function() {} }); return api; };
    })();
    const vscode = acquireVsCodeApi();
    window.addEventListener('message', (e) => {
      if (e.data.type === 'stale') {
        const warning = document.getElementById('stale-warning');
        if (warning) {
          warning.textContent = e.data.message;
          warning.style.display = 'block';
        }
      }
    });
  </script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" integrity="sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp" crossorigin="anonymous"></script>
  <script>hljs.highlightAll();</script>
</body>
</html>`;
}

/**
 * Simple markdown-to-HTML converter for VS Code webview display.
 * Handles the format produced by `ailinter get-refactoring-strategy`:
 * - Code blocks (```go ... ```)
 * - Headers (# to ###)
 * - Bold (**text**)
 * - Italic (*text*)
 * - Inline code (`code`)
 * - Unordered and ordered lists
 * - Paragraphs
 */
function markdownToHtml(md: string): string {
  let html = md;

  // Code blocks (handle before inline code to avoid conflicts)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = escapeHtml(code);
    const langClass = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${langClass}>${escaped}</code></pre>`;
  });

  // Headers (must come before bold/italic to avoid ## being treated as bold)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)(?=\n|$)/g, (match) => {
    if (match.includes('<ul>')) return match; // already wrapped
    return '<ol>' + match + '</ol>';
  });

  // Checklist items
  html = html.replace(/^- \[ \] (.+)$/gm, '<li class="checklist unchecked">⬜ $1</li>');
  html = html.replace(/^- \[x\] (.+)$/gm, '<li class="checklist checked">✅ $1</li>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Paragraphs: wrap consecutive non-empty text blocks
  const lines = html.split('\n');
  const result: string[] = [];
  let inPre = false;
  let inList = false;
  let inLi = false;
  let inHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('<pre>')) {
      inPre = true;
      result.push(line);
      continue;
    }
    if (inPre) {
      result.push(line);
      if (trimmed.endsWith('</pre>')) inPre = false;
      continue;
    }

    // Track list state
    if (trimmed.startsWith('<ul>') || trimmed.startsWith('<ol>')) {
      inList = true;
      result.push(line);
      continue;
    }
    if (trimmed.startsWith('</ul>') || trimmed.startsWith('</ol>')) {
      inList = false;
      result.push(line);
      continue;
    }
    if (trimmed.startsWith('<li')) {
      inLi = true;
      result.push(line);
      continue;
    }
    if (trimmed.startsWith('</li>')) {
      inLi = false;
      result.push(line);
      continue;
    }
    if (inList || inLi) {
      result.push(line);
      continue;
    }
    if (trimmed.startsWith('<h') && (trimmed.endsWith('</h1>') || trimmed.endsWith('</h2>') || trimmed.endsWith('</h3>'))) {
      inHeader = true;
      result.push(line);
      continue;
    }
    if (inHeader) {
      result.push(line);
      inHeader = false;
      continue;
    }
    if (trimmed.startsWith('<hr>')) {
      result.push(line);
      continue;
    }

    // Empty line = paragraph break
    if (trimmed === '') {
      result.push('</p><p>');
      continue;
    }

    // Regular text
    result.push(line);
  }

  html = result.join('\n');

  // Wrap in paragraphs if not already wrapped
  if (!html.startsWith('<')) {
    html = '<p>' + html + '</p>';
  }

  // Clean up empty paragraphs and structural issues
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p><h/g, '<h');
  html = html.replace(/<\/h([123])><\/p>/g, '</h$1>');
  html = html.replace(/<p><ul>/g, '<ul>');
  html = html.replace(/<\/ul><\/p>/g, '</ul>');
  html = html.replace(/<p><ol>/g, '<ol>');
  html = html.replace(/<\/ol><\/p>/g, '</ol>');
  html = html.replace(/<p><li/g, '<li');
  html = html.replace(/<\/li><\/p>/g, '</li>');
  html = html.replace(/<p><hr>/g, '<hr>');
  html = html.replace(/<\/p><p><\/p>/g, '</p>');
  html = html.replace(/<p><\/p>/g, '');

  return html;
}

/**
 * Escape HTML entities.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format snake_case to human-readable.
 */
function formatSmellName(smellType: string): string {
  return smellType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get relative path for display.
 */
function getRelativePath(filePath: string): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const root = workspaceFolders[0].uri.fsPath;
    if (filePath.startsWith(root)) {
      return filePath.substring(root.length + 1);
    }
  }
  return filePath;
}


