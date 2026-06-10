/**
 * Tests for cli-installer — validates platform detection,
 * asset name generation, and binary path resolution.
 *
 * AI-generated test fixture
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPlatformInfo, isAilinterAvailable, getAssetName } from '../cli-installer';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock vscode module for all tests
vi.mock('vscode', () => {
  const mockConfig = {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      if (key === 'path') return defaultValue ?? '';
      if (key === 'enable') return true;
      if (key === 'scanOnOpen') return true;
      return defaultValue;
    }),
    update: vi.fn(),
  };

  return {
    workspace: {
      getConfiguration: vi.fn(() => mockConfig),
      workspaceFolders: [],
      createFileSystemWatcher: vi.fn(() => ({
        onDidChange: vi.fn(),
        onDidCreate: vi.fn(),
        onDidDelete: vi.fn(),
      })),
    },
    window: {
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      withProgress: vi.fn((_opts: unknown, cb: Function) => cb({ report: vi.fn() })),
      createStatusBarItem: vi.fn(() => ({
        text: '',
        tooltip: '',
        command: '',
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
      })),
      activeTextEditor: undefined,
      registerTreeDataProvider: vi.fn(),
      registerWebviewViewProvider: vi.fn(),
    },
    commands: {
      executeCommand: vi.fn(),
      registerCommand: vi.fn(),
    },
    Uri: {
      file: vi.fn((p: string) => ({ fsPath: p, path: p })),
      parse: vi.fn((s: string) => ({ toString: () => s })),
    },
    EventEmitter: vi.fn(() => ({
      event: vi.fn(),
      fire: vi.fn(),
    })),
    languages: {
      createDiagnosticCollection: vi.fn(() => ({
        set: vi.fn(),
        clear: vi.fn(),
        dispose: vi.fn(),
      })),
      registerCodeLensProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
      registerCodeActionsProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    FileDecorationProvider: vi.fn(),
    FileDecoration: vi.fn(),
    ThemeColor: vi.fn(),
  };
});

// ── Disable tests that rely on spawning real processes ────────────────────────
// isAilinterAvailable spawns a child process which isn't useful in unit tests.
// We only test the pure functions here.

describe('getPlatformInfo', () => {
  // Save original platform/arch
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  afterEach(() => {
    // Restore after each test
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, configurable: true });
  });

  it('should detect macOS amd64', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    expect(getPlatformInfo()).toEqual({ os: 'darwin', arch: 'amd64' });
  });

  it('should detect macOS arm64 (Apple Silicon)', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    expect(getPlatformInfo()).toEqual({ os: 'darwin', arch: 'arm64' });
  });

  it('should detect Linux amd64', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    expect(getPlatformInfo()).toEqual({ os: 'linux', arch: 'amd64' });
  });

  it('should detect Windows amd64', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    expect(getPlatformInfo()).toEqual({ os: 'windows', arch: 'amd64' });
  });

  it('should detect Windows arm64', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    expect(getPlatformInfo()).toEqual({ os: 'windows', arch: 'arm64' });
  });

  it('should detect Linux arm64', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    expect(getPlatformInfo()).toEqual({ os: 'linux', arch: 'arm64' });
  });

  it('should fall back to linux/amd64 for unknown platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'android', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    expect(getPlatformInfo()).toEqual({ os: 'linux', arch: 'amd64' });
  });

  it('should fall back to amd64 for unknown architectures', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 's390x', configurable: true });
    expect(getPlatformInfo()).toEqual({ os: 'darwin', arch: 'amd64' });
  });
});

describe('getAssetName', () => {
  it('should generate correct name for macOS arm64', () => {
    expect(getAssetName('v1.0.0', { os: 'darwin', arch: 'arm64' }))
      .toBe('ailinter_v1.0.0_darwin_arm64');
  });

  it('should generate correct name for linux amd64', () => {
    expect(getAssetName('v1.0.0', { os: 'linux', arch: 'amd64' }))
      .toBe('ailinter_v1.0.0_linux_amd64');
  });

  it('should generate correct name for windows amd64 with .exe', () => {
    expect(getAssetName('v1.0.0', { os: 'windows', arch: 'amd64' }))
      .toBe('ailinter_v1.0.0_windows_amd64.exe');
  });

  it('should generate correct name for v0.3.0 darwin arm64', () => {
    expect(getAssetName('v0.3.0', { os: 'darwin', arch: 'arm64' }))
      .toBe('ailinter_v0.3.0_darwin_arm64');
  });
});

describe('isAilinterAvailable', () => {
  it('should return false for non-existent binary', async () => {
    const result = await isAilinterAvailable('/nonexistent/path/ailinter');
    expect(result).toBe(false);
  });

  it('should return false for empty string path', async () => {
    const result = await isAilinterAvailable('');
    expect(result).toBe(false);
  });
});
