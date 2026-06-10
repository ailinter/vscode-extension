/**
 * Shared types for the AILINTER VS Code extension.
 * Maps ailinter CLI output to IDE-friendly structures.
 */

export interface AilinterFinding {
  file: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: 'critical' | 'error' | 'warning' | 'info';
  message: string;
  category: 'quality' | 'secret' | 'vulnerability' | 'metalinter';
  /** Specific smell type (deep_nesting, brain_method, etc.) — only for quality issues */
  smellType?: string;
  /** Overall file score at the time this finding was reported */
  score?: number;
}

export interface FileScore {
  path: string;
  score: number;
  previousScore?: number;
  delta?: number;
  lastScanned: Date;
  findings: AilinterFinding[];
}

export interface ProjectQuality {
  overallScore: number;
  fileCount: number;
  filesWithIssues: number;
  totalFindings: number;
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  topSmells: { smell: string; count: number }[];
}

/**
 * Result from running ailinter on a single file
 */
export interface ScanResult {
  score: number;
  findings: AilinterFinding[];
}

// Known code smells that ailinter detects
export const KNOWN_SMELLS = [
  'deep_nesting',
  'brain_method',
  'bumpy_road',
  'complex_conditional',
  'god_class',
  'long_parameter_list',
  'primitive_obsession',
  'duplicated_code',
  'long_method',
  'long_file',
  'complex_method',
  'high_cyclomatic_complexity',
  'data_class',
  'refused_bequest',
  'shotgun_surgery',
  'parallel_inheritance',
  'global_data',
  'magic_number',
  'misplaced_function',
  'low_cohesion',
] as const;

export type KnownSmell = (typeof KNOWN_SMELLS)[number];
