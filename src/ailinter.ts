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
  return fileCache.get(filePath);
}

export function getAllCachedResults(): FileScore[] {
  return Array.from(fileCache.values());
}

export function clearCache(): void {
  fileCache.clear();
}

// ── Known smell message matchers ─────────────────────────────────────────────
const SMELL_MESSAGE_PATTERNS: { pattern: RegExp; smell: string }[] = [
  { pattern: /deep\s*nest/i, smell: 'deep_nesting' },
  { pattern: /brain\s*method/i, smell: 'brain_method' },
  { pattern: /bumpy\s*road/i, smell: 'bumpy_road' },
  { pattern: /complex\s*condition/i, smell: 'complex_conditional' },
  { pattern: /god\s*class/i, smell: 'god_class' },
  { pattern: /long\s*parameter/i, smell: 'long_parameter_list' },
  { pattern: /primitive\s*obsess/i, smell: 'primitive_obsession' },
  { pattern: /duplicat/i, smell: 'duplicated_code' },
  { pattern: /long\s*method/i, smell: 'long_method' },
  { pattern: /long\s*file/i, smell: 'long_file' },
  { pattern: /complex\s*method/i, smell: 'complex_method' },
  { pattern: /cyclomatic/i, smell: 'high_cyclomatic_complexity' },
  { pattern: /data\s*class/i, smell: 'data_class' },
  { pattern: /refused\s*bequest/i, smell: 'refused_bequest' },
  { pattern: /shotgun\s*surgery/i, smell: 'shotgun_surgery' },
  { pattern: /parallel\s*inheritance/i, smell: 'parallel_inheritance' },
  { pattern: /global\s*data/i, smell: 'global_data' },
  { pattern: /magic\s*number/i, smell: 'magic_number' },
  { pattern: /misplaced\s*function/i, smell: 'misplaced_function' },
  { pattern: /low\s*cohesion/i, smell: 'low_cohesion' },
];

function detectSmellType(message: string): string | undefined {
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

// Format 4: metalinter format — file:line:col: [tool] message (code)
// Uses a fixed severity of 'warning' since these tools don't report severity
const FINDING_METALINTER = /^(.+?):(\d+):(\d+):\s*\[(\w+)\]\s*(.+?)(?:\s*\((\w+)\))?$/m;

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
    let m = trimmed.match(FINDING_RANGE);
    if (m) {
      findings.push(buildFinding(m, 1, 2, 3, 5, 4, 6));
      continue;
    }

    // Try full format (with column)
    m = trimmed.match(FINDING_FULL);
    if (m) {
      findings.push(buildFinding(m, 1, 2, 3, 4, undefined, 5));
      continue;
    }

    // Try metalinter format (e.g. [staticcheck], [govet])
    m = trimmed.match(FINDING_METALINTER);
    if (m) {
      findings.push(buildMetalinterFinding(m));
      continue;
    }

    // Try no-column format
    m = trimmed.match(FINDING_NO_COL);
    if (m) {
      findings.push(buildFinding(m, 1, 2, undefined, 3, undefined, 4));
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
 * Build a finding from the metalinter regex format:
 *   file:line:col: [tool] message (code)
 *
 * These findings always get severity 'warning' and category 'metalinter'
 * since the output doesn't carry an explicit severity keyword.
 */
function buildMetalinterFinding(m: RegExpMatchArray): AilinterFinding {
  const message = m[5].trim();
  return {
    file: m[1],
    line: parseInt(m[2], 10),
    column: parseInt(m[3], 10),
    severity: 'warning',
    message,
    category: 'metalinter',
    smellType: detectSmellType(message),
    score: undefined,
  };
}

// ── Cache updating helpers ───────────────────────────────────────────────────

export function updateCache(filePath: string, result: ScanResult): FileScore {
  // Resolve to absolute path, then normalise (handles both relative and absolute inputs)
  const normalised = path.resolve(path.normalize(filePath));
  const existing = fileCache.get(normalised);
  const previousScore = existing?.score;

  const fileScore: FileScore = {
    path: normalised,
    score: result.score,
    previousScore,
    delta: previousScore !== undefined ? result.score - previousScore : undefined,
    lastScanned: new Date(),
    findings: result.findings,
  };

  fileCache.set(normalised, fileScore);
  return fileScore;
}

/**
 * Run ailinter on a file, update the cache, and return the result.
 */
export async function scanAndCache(
  filePath: string,
  binaryPath: string
): Promise<FileScore> {
  const result = await runAilinter(filePath, binaryPath);
  return updateCache(filePath, result);
}
