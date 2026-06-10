/**
 * AILINTER CLI wrapper — spawns the binary, parses output, caches results.
 * Supports both per-file and workspace-wide scans.
 */
import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  AilinterFinding,
  FileScore,
  KNOWN_SMELLS,
  ScanResult,
} from './types';

// ── Cache ────────────────────────────────────────────────────────────────────
const fileCache = new Map<string, FileScore>();

export function getCachedResult(filePath: string): FileScore | undefined {
  // Must normalize the same way updateCache does, otherwise cache key mismatch
  const normalised = path.resolve(path.normalize(filePath));
  return fileCache.get(normalised);
}

export function getAllCachedResults(): FileScore[] {
  return Array.from(fileCache.values());
}

export function clearCache(): void {
  fileCache.clear();
}

// ── Known smell message matchers ─────────────────────────────────────────────
const SMELL_MESSAGE_PATTERNS: { pattern: RegExp; smell: string }[] = [
  { pattern: /deep[_\s]*nest/i, smell: 'deep_nesting' },
  { pattern: /brain[_\s]*method/i, smell: 'brain_method' },
  { pattern: /bumpy[_\s]*road/i, smell: 'bumpy_road' },
  { pattern: /complex[_\s]*condition/i, smell: 'complex_conditional' },
  { pattern: /god[_\s]*class/i, smell: 'god_class' },
  { pattern: /long[_\s]*parameter/i, smell: 'long_parameter_list' },
  { pattern: /primitive[_\s]*obsess/i, smell: 'primitive_obsession' },
  { pattern: /duplicat/i, smell: 'duplicated_code' },
  { pattern: /long[_\s]*method/i, smell: 'long_method' },
  { pattern: /long[_\s]*file/i, smell: 'long_file' },
  { pattern: /complex[_\s]*method/i, smell: 'complex_method' },
  { pattern: /cyclomatic/i, smell: 'high_cyclomatic_complexity' },
  { pattern: /data[_\s]*class/i, smell: 'data_class' },
  { pattern: /refused[_\s]*bequest/i, smell: 'refused_bequest' },
  { pattern: /shotgun[_\s]*surgery/i, smell: 'shotgun_surgery' },
  { pattern: /parallel[_\s]*inheritance/i, smell: 'parallel_inheritance' },
  { pattern: /global[_\s]*data/i, smell: 'global_data' },
  { pattern: /magic[_\s]*number/i, smell: 'magic_number' },
  { pattern: /misplaced[_\s]*function/i, smell: 'misplaced_function' },
  { pattern: /low[_\s]*cohesion/i, smell: 'low_cohesion' },
];

function detectSmellType(message: string): string | undefined {
  // Pass 1: Try extracting from message prefix (CLI format: "smell_name: details")
  // e.g., "complex_method: scanDir CC=18" — extract "complex_method" directly
  const prefixMatch = message.match(/^(\w+):\s/);
  if (prefixMatch) {
    const possibleSmell = prefixMatch[1];
    for (const { smell } of SMELL_MESSAGE_PATTERNS) {
      if (possibleSmell === smell || possibleSmell === smell.replace(/_/g, ' ')) {
        return smell;
      }
    }
  }

  // Pass 2: Fall back to pattern matching in the full message
  for (const { pattern, smell } of SMELL_MESSAGE_PATTERNS) {
    if (pattern.test(message)) return smell;
  }
  return undefined;
}

// ── Run ailinter ─────────────────────────────────────────────────────────────

export function runAilinter(
  filePath: string,
  binaryPath: string,
  options?: { secrets?: boolean; useStdin?: boolean; fileContent?: string }
): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const args = ['check', filePath, '--format', 'problems'];
    // By default --no-secrets to keep AI context clean; pass secrets:true for full scan
    if (!options?.secrets) {
      args.push('--no-secrets');
    }

    const SCAN_TIMEOUT_MS = 30000;

    const proc = cp.spawn(binaryPath, args, {
      timeout: SCAN_TIMEOUT_MS,
      stdio: options?.useStdin ? ['pipe', 'pipe', 'pipe'] : undefined,
    });

    // Track whether a timeout occurred
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, SCAN_TIMEOUT_MS);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    if (options?.useStdin && options?.fileContent) {
      proc.stdin?.write(options.fileContent);
      proc.stdin?.end();
    }

    proc.on('close', (code) => {
      clearTimeout(timeoutTimer);

      if (timedOut) {
        reject(new Error('Scan timed out after 30s'));
        return;
      }

      // Code 0 = clean, code 1 = findings found (both are valid)
      if (code !== null && code > 1) {
        reject(new Error(stderr || `ailinter exited with code ${code}`));
        return;
      }
      const result = parseOutput(stdout + '\n' + stderr);
      resolve(result);
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeoutTimer);

      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `AILINTER binary not found at "${binaryPath}". Install with: brew install ailinter`
          )
        );
      } else {
        reject(new Error(`Failed to run ailinter: ${err.message}`));
      }
    });
  });
}

/**
 * Filter out false-positive go vet findings that occur in single-file mode.
 * When `ailinter check <file>` runs go vet on a single file, it can't resolve
 * cross-file package imports, producing spurious "package error", "undefined:",
 * and "could not import" messages. These are not real defects.
 */
export function shouldExcludeFinding(finding: AilinterFinding): boolean {
  // Exclude go vet package-level errors — false positives in single-file mode
  if (finding.category === 'metalinter') {
    if (finding.message.includes('package error:')) return true;
    if (finding.message.includes('could not import')) return true;
    if (finding.message.includes('too many errors')) return true;
    if (finding.message.includes('invalid package name')) return true;
    // "undefined:" from go vet in single-file mode: can't resolve cross-file refs
    if (finding.message.includes('undefined:')) return true;
  }
  return false;
}

// ── Parse output ─────────────────────────────────────────────────────────────

// Format A: "Quality Score: 99/100" (legacy CLI format)
const SCORE_LINE = /Quality Score:\s*(\d+)\/100/i;
// Format B: "# /path/file.go score=99 label=Go Ahead ..." (current --format problems)
const SCORE_INLINE = /(?:^|\s)score=(\d+)/i;

// Format 1: file:line:column: severity: message (category)
const FINDING_FULL = /^(.+?):(\d+):(\d+):\s*(error|warning|info|critical):\s*(.+?)(?:\s*\((\w+)\))?$/m;

// Format 2: file:line: severity: message (category) — no column
const FINDING_NO_COL = /^(.+?):(\d+):\s*(error|warning|info|critical):\s*(.+?)(?:\s*\((\w+)\))?$/m;

// Format 3: file:line:column-endcol: severity: message (category)
const FINDING_RANGE = /^(.+?):(\d+):(\d+)-(\d+):\s*(error|warning|info|critical):\s*(.+?)(?:\s*\((\w+)\))?$/m;

// Format 4a: govet verbose format — file:line:col:\d+:\d+: [tool] message (code)
// This handles the extra ":1:1:" suffix govet sometimes emits after the column:
//   /path/file.go:20:17:1:1: [govet] package error: undefined: Foo ()
// Groups: 1=file, 2=line, 3=col, 4=tool, 5=message, 6=code
const FINDING_GOVET_VERBOSE = /^(.+?):(\d+):(\d+):\d+:\d+:\s*\[(\w+)\]\s*(.+?)(?:\s*\((\w+)\))?$/m;

// Format 4b: metalinter format — file:line:col: [tool] message (code)
// Uses a fixed severity of 'warning' since these tools don't report severity
const FINDING_METALINTER = /^(.+?):(\d+):(\d+):\s*\[(\w+)\]\s*(.+?)(?:\s*\((\w+)\))?$/m;

// Format 5: govet/compiler error format — file:line:col: message (no severity keyword)
//   internal/analyzer/report.go:20:17: undefined: QualityResult
// Groups: 1=file, 2=line, 3=col, 4=message
// These get assigned severity 'error' since they're compiler/runtime errors.
const FINDING_COMPILER = /^(.+?):(\d+):(\d+):\s*(.+)$/m;

export function parseOutput(output: string): ScanResult {
  const findings: AilinterFinding[] = [];
  let score = 100;
  let unmatchedLines = 0;

  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Score line — try legacy format first, then inline score=NN format
    const scoreMatch = trimmed.match(SCORE_LINE) ?? trimmed.match(SCORE_INLINE);
    if (scoreMatch) {
      score = parseInt(scoreMatch[1], 10);
      continue;
    }

    // Try range format first (most specific)
    // Groups: 1=file, 2=line, 3=startCol, 4=endCol, 5=severity, 6=message, 7=category
    let m = trimmed.match(FINDING_RANGE);
    if (m) {
      const finding = buildFinding(m, 1, 2, 3, 5, 4, 6, 7);
      if (!shouldExcludeFinding(finding)) findings.push(finding);
      continue;
    }

    // Try full format (with column)
    // Groups: 1=file, 2=line, 3=col, 4=severity, 5=message, 6=category
    m = trimmed.match(FINDING_FULL);
    if (m) {
      const finding = buildFinding(m, 1, 2, 3, 4, undefined, 5, 6);
      if (!shouldExcludeFinding(finding)) findings.push(finding);
      continue;
    }

    // Try govet verbose format (path:line:col:\d+:\d+: [tool] ...)
    // Must come before FINDING_METALINTER since it's more specific (extra :\d+:\d+: group)
    m = trimmed.match(FINDING_GOVET_VERBOSE);
    if (m) {
      const finding = buildMetalinterFinding(m);
      if (!shouldExcludeFinding(finding)) findings.push(finding);
      continue;
    }

    // Try metalinter format (e.g. [staticcheck], [govet])
    // Groups: 1=file, 2=line, 3=col, 4=tool, 5=message, 6=code
    m = trimmed.match(FINDING_METALINTER);
    if (m) {
      const finding = buildMetalinterFinding(m);
      if (!shouldExcludeFinding(finding)) findings.push(finding);
      continue;
    }

    // Try no-column format
    // Groups: 1=file, 2=line, 3=severity, 4=message, 5=category
    m = trimmed.match(FINDING_NO_COL);
    if (m) {
      const finding = buildFinding(m, 1, 2, undefined, 3, undefined, 4, 5);
      if (!shouldExcludeFinding(finding)) findings.push(finding);
      continue;
    }

    // Try compiler/govet error format (file:line:col: message, no severity keyword)
    // These are compilation errors that don't have a severity marker.
    // Groups: 1=file, 2=line, 3=col, 4=message
    // Skip lines with empty file paths (govet header like ":1:1: [govet]...")
    m = trimmed.match(FINDING_COMPILER);
    if (m && m[1].trim().length > 0) {
      const finding = buildCompilerFinding(m);
      if (!shouldExcludeFinding(finding)) findings.push(finding);
      continue;
    }

    unmatchedLines++;
    if (unmatchedLines <= 5) {
      console.log(`[ailinter:parse] UNMATCHED: "${trimmed.substring(0, 100)}"`);
    }
  }

  // Log first 5 findings for debug
  console.log(
    `[ailinter:parse] Parsed: score=${score}, findings=${findings.length}, ` +
    `unmatched=${unmatchedLines}, totalLines=${lines.length}`
  );
  for (let i = 0; i < Math.min(5, findings.length); i++) {
    const f = findings[i];
    console.log(
      `[ailinter:parse] Finding[${i}]: file="${f.file}" line=${f.line} ` +
      `col=${f.column ?? '-'} sev=${f.severity} cat=${f.category} msg="${f.message.substring(0, 60)}"`
    );
  }
  // Log last 2 findings to catch govet/metalinter patterns
  if (findings.length > 5) {
    for (let i = Math.max(5, findings.length - 2); i < findings.length; i++) {
      const f = findings[i];
      console.log(
        `[ailinter:parse] Finding[${i}]: file="${f.file}" line=${f.line} ` +
        `col=${f.column ?? '-'} sev=${f.severity} cat=${f.category} msg="${f.message.substring(0, 60)}"`
      );
    }
  }

  return { score, findings };
}

function buildFinding(
  m: RegExpMatchArray,
  fileIdx: number,
  lineIdx: number,
  colIdx: number | undefined,
  sevIdx: number,
  endColIdx: number | undefined,
  msgIdx: number,
  catIdx?: number
): AilinterFinding {
  const message = m[msgIdx].trim();
  const category = (m[catIdx ?? 0] || 'quality') as AilinterFinding['category'];
  const severity = m[sevIdx] as AilinterFinding['severity'];
  const smellType = category === 'quality' ? detectSmellType(message) : undefined;

  const finding: AilinterFinding = {
    file: m[fileIdx],
    line: parseInt(m[lineIdx], 10),
    severity,
    message,
    category,
    smellType,
    score: undefined,
  };

  if (colIdx !== undefined && m[colIdx]) {
    finding.column = parseInt(m[colIdx], 10);
  }
  if (endColIdx !== undefined && m[endColIdx]) {
    finding.endColumn = parseInt(m[endColIdx], 10);
  }

  return finding;
}

/**
 * Build an AilinterFinding from base components.
 * Shared factory used by buildMetalinterFinding and buildCompilerFinding.
 */
function buildFindingSimple(
  file: string,
  line: number,
  column: number,
  message: string,
  severity: AilinterFinding['severity'],
  category: AilinterFinding['category'] = 'metalinter'
): AilinterFinding {
  return {
    file,
    line,
    column,
    severity,
    message: message.trim(),
    category,
    smellType: detectSmellType(message),
    score: undefined,
  };
}

/**
 * Build a finding from the metalinter regex format:
 *   file:line:col: [tool] message (code)
 * Groups: 1=file, 2=line, 3=col, 4=tool, 5=message, 6=code
 */
function buildMetalinterFinding(m: RegExpMatchArray): AilinterFinding {
  return buildFindingSimple(m[1], parseInt(m[2], 10), parseInt(m[3], 10), m[5], 'warning');
}

/**
 * Build a finding from the compiler/govet error format:
 *   file:line:col: message (no severity keyword)
 * These get severity 'error' since they're compilation/runtime failures.
 * Groups: 1=file, 2=line, 3=col, 4=message
 */
function buildCompilerFinding(m: RegExpMatchArray): AilinterFinding {
  return buildFindingSimple(m[1], parseInt(m[2], 10), parseInt(m[3], 10), m[4], 'error');
}

// ── Cache updating helpers ───────────────────────────────────────────────────

/**
 * Check whether a finding's file path matches a target file path.
 * Normalizes both paths for comparison.
 * Returns true if they refer to the same file.
 *
 * For relative finding paths (e.g., "internal/analyzer/report.go"), tries:
 * 1. workspaceRoot (where CLI was invoked from) — most correct for govet output
 * 2. targetPath's directory — fallback for other relative paths
 */
function findingMatchesFile(
  finding: AilinterFinding,
  targetPath: string,
  workspaceRoot?: string
): boolean {
  const normalizedTarget = path.resolve(path.normalize(targetPath));
  const targetDir = path.dirname(normalizedTarget);

  if (path.isAbsolute(finding.file)) {
    return path.normalize(finding.file) === normalizedTarget;
  }

  // Relative path — try workspace root first (CLI CWD)
  if (workspaceRoot) {
    const wsPath = path.resolve(workspaceRoot, finding.file);
    if (path.normalize(wsPath) === normalizedTarget) {
      return true;
    }
  }

  // Fallback: resolve against document directory
  const resolved = path.resolve(targetDir, finding.file);
  return path.normalize(resolved) === normalizedTarget;
}

export function updateCache(filePath: string, result: ScanResult, workspaceRoot?: string): FileScore {
  // Resolve to absolute path, then normalise (handles both relative and absolute inputs)
  const normalised = path.resolve(path.normalize(filePath));
  const existing = fileCache.get(normalised);
  const previousScore = existing?.score;

  // Strip findings whose file path doesn't match — avoids polluting cache
  // with mangled govet/staticcheck paths (e.g., "file.go:20:17:1:1: [govet]...")
  const cleanFindings = result.findings.filter(f => {
    const matches = findingMatchesFile(f, normalised, workspaceRoot);
    if (!matches) {
      console.log(`[ailinter:cache] Stripping finding with mismatched path: "${f.file}"`);
    }
    return matches;
  });

  const fileScore: FileScore = {
    path: normalised,
    score: result.score,
    previousScore,
    delta: previousScore !== undefined ? result.score - previousScore : undefined,
    lastScanned: new Date(),
    findings: cleanFindings,
  };

  fileCache.set(normalised, fileScore);
  return fileScore;
}

/**
 * Run ailinter on a file, update the cache, and return the result.
 */
export async function scanAndCache(
  filePath: string,
  binaryPath: string,
  workspaceRoot?: string
): Promise<FileScore> {
  const result = await runAilinter(filePath, binaryPath);
  return updateCache(filePath, result, workspaceRoot);
}
