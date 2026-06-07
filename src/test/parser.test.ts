/**
 * Tests for parseOutput — validates ailinter CLI output parsing.
 *
 * Covers:
 * - Legacy score format: "Quality Score: 99/100"
 * - Inline score format: "# /path/file.go score=99 label=Go Ahead ..."
 * - Finding formats: full, no-column, range, govet verbose, metalinter, compiler
 * - Govet false-positive filtering
 */
import { describe, it, expect, vi } from 'vitest';
import { parseOutput } from '../ailinter';

// parseOutput is pure — it just processes strings. The vscode import in ailinter.ts
// is unused by parseOutput itself, so an empty mock is sufficient.
vi.mock('vscode', () => ({}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeScoreLine(score: number): string {
  return `Quality Score: ${score}/100`;
}

function makeFinding(
  file: string,
  line: number,
  col: number,
  severity: string,
  message: string,
  category?: string
): string {
  const cat = category ? ` (${category})` : '';
  return `${file}:${line}:${col}: ${severity}: ${message}${cat}`;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parseOutput', () => {
  describe('score parsing', () => {
    it('should parse legacy format score', () => {
      const result = parseOutput(makeScoreLine(85));
      expect(result.score).toBe(85);
    });

    it('should parse legacy format score with leading text', () => {
      const output = `# /path/file.go\n${makeScoreLine(42)}`;
      const result = parseOutput(output);
      expect(result.score).toBe(42);
    });

    it('should parse inline score format', () => {
      const output = '# /path/file.go score=99 label="Go Ahead" lines=200 lang=go';
      const result = parseOutput(output);
      expect(result.score).toBe(99);
    });

    it('should default to score 100 when no score line found', () => {
      const result = parseOutput('some random output\nwithout a score line');
      expect(result.score).toBe(100);
    });

    it('should use the last score when multiple present', () => {
      const output = `${makeScoreLine(50)}\n${makeScoreLine(80)}`;
      const result = parseOutput(output);
      expect(result.score).toBe(80);
    });
  });

  describe('finding formats', () => {
    it('should parse full format: file:line:col: severity: message (category)', () => {
      const line = makeFinding('src/main.go', 10, 5, 'warning', 'deep nesting detected', 'quality');
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        file: 'src/main.go',
        line: 10,
        column: 5,
        severity: 'warning',
        message: 'deep nesting detected',
        category: 'quality',
      });
    });

    it('should parse no-column format: file:line: severity: message (category)', () => {
      const line = 'src/main.go:10: warning: deep nesting detected (quality)';
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].line).toBe(10);
      expect(result.findings[0].column).toBeUndefined();
    });

    it('should parse no-column format without category', () => {
      const line = 'src/main.go:10: warning: deep nesting detected';
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].category).toBe('quality');
    });

    it('should parse range format: file:line:startCol-endCol: severity: message', () => {
      const line = 'src/main.go:10:5-15: warning: long method (quality)';
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].column).toBe(5);
      expect(result.findings[0].endColumn).toBe(15);
    });

    it('should parse govet verbose format', () => {
      // Use a non-excluded message to avoid false-positive filtering
      const line = '/path/file.go:20:17:1:1: [govet] printf: non-constant format string in call to fmt.Errorf ()';
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].file).toBe('/path/file.go');
      expect(result.findings[0].line).toBe(20);
      expect(result.findings[0].column).toBe(17);
      expect(result.findings[0].severity).toBe('warning');
      expect(result.findings[0].category).toBe('metalinter');
    });

    it('should parse metalinter format: file:line:col: [tool] message', () => {
      const line = 'src/main.go:10:5: [staticcheck] unnecessary conversion (SA1021)';
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe('warning');
      expect(result.findings[0].category).toBe('metalinter');
      expect(result.findings[0].message).toBe('unnecessary conversion');
    });

    it('should parse compiler/govet error format: file:line:col: message', () => {
      // Use a message that does NOT trigger shouldExcludeFinding
      const line = 'internal/analyzer/report.go:20:17: assignment mismatch: 2 variables but 3 values';
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe('error');
      expect(result.findings[0].category).toBe('metalinter');
      expect(result.findings[0].message).toBe('assignment mismatch: 2 variables but 3 values');
    });
  });

  describe('smell detection', () => {
    it('should detect deep_nesting smell from message', () => {
      const line = makeFinding('src/main.go', 10, 5, 'warning', 'Deep nesting detected at line 42', 'quality');
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings[0].smellType).toBe('deep_nesting');
    });

    it('should detect brain_method smell from message', () => {
      const line = makeFinding('src/main.go', 10, 5, 'warning', 'Brain method detected', 'quality');
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings[0].smellType).toBe('brain_method');
    });

    it('should detect complex_conditional smell from message', () => {
      const line = makeFinding('src/main.go', 10, 5, 'warning', 'Complex condition detected', 'quality');
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings[0].smellType).toBe('complex_conditional');
    });

    it('should not set smellType for non-quality findings', () => {
      const line = makeFinding('src/main.go', 10, 5, 'critical', 'Hardcoded API key detected', 'secret');
      const result = parseOutput(`${makeScoreLine(80)}\n${line}`);
      expect(result.findings[0].smellType).toBeUndefined();
    });
  });

  describe('govet false-positive filtering (shouldExcludeFinding)', () => {
    it('should exclude package error findings', () => {
      const lines = [
        makeScoreLine(95),
        '/path/file.go:34:16:1:1: [govet] package error: undefined: Foo ()',
      ];
      const result = parseOutput(lines.join('\n'));
      expect(result.findings).toHaveLength(0);
    });

    it('should exclude "could not import" findings', () => {
      const lines = [
        makeScoreLine(95),
        '/path/file.go:34:16:1:1: [govet] could not import fmt ()',
      ];
      const result = parseOutput(lines.join('\n'));
      expect(result.findings).toHaveLength(0);
    });

    it('should exclude "too many errors" findings', () => {
      const lines = [
        makeScoreLine(95),
        '/path/file.go:34:16:1:1: [govet] too many errors ()',
      ];
      const result = parseOutput(lines.join('\n'));
      expect(result.findings).toHaveLength(0);
    });

    it('should exclude "undefined:" metalinter findings', () => {
      const lines = [
        makeScoreLine(95),
        '/path/file.go:34:16: [govet] undefined: SomeType (govet)',
      ];
      const result = parseOutput(lines.join('\n'));
      expect(result.findings).toHaveLength(0);
    });

    it('should keep non-excluded metalinter findings', () => {
      const lines = [
        makeScoreLine(95),
        '/path/file.go:34:16:1:1: [govet] printf: non-constant format string in call to fmt.Errorf ()',
      ];
      const result = parseOutput(lines.join('\n'));
      expect(result.findings).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty output', () => {
      const result = parseOutput('');
      expect(result.score).toBe(100);
      expect(result.findings).toHaveLength(0);
    });

    it('should handle blank lines', () => {
      const lines = [
        makeScoreLine(80),
        '',
        makeFinding('src/main.go', 10, 5, 'warning', 'test finding', 'quality'),
        '',
      ];
      const result = parseOutput(lines.join('\n'));
      expect(result.findings).toHaveLength(1);
    });

    it('should parse multiple findings', () => {
      const lines = [
        makeScoreLine(70),
        makeFinding('src/main.go', 10, 5, 'warning', 'deep nesting', 'quality'),
        makeFinding('src/main.go', 42, 3, 'error', 'complex method', 'quality'),
        makeFinding('src/main.go', 100, 1, 'critical', 'hardcoded secret', 'secret'),
      ];
      const result = parseOutput(lines.join('\n'));
      expect(result.findings).toHaveLength(3);
      expect(result.score).toBe(70);
    });

    it('should handle cross-platform line endings (\\r\\n)', () => {
      const lines = `${makeScoreLine(85)}\r\n${makeFinding('src/main.go', 10, 5, 'warning', 'test', 'quality')}`;
      const result = parseOutput(lines);
      expect(result.findings).toHaveLength(1);
    });

    it('should skip empty file paths in compiler format', () => {
      const lines = [
        makeScoreLine(95),
        ':1:1: [govet] bogus header line',
      ];
      const result = parseOutput(lines.join('\n'));
      expect(result.findings).toHaveLength(0);
    });
  });
});
