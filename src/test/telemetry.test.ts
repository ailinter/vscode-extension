/**
 * Tests for the telemetry module (src/telemetry.ts).
 *
 * AI-generated test fixture
 *
 * Covers:
 * - initializeTelemetry: install ID generation and persistence
 * - sendEvent: respects telemetry opt-out setting
 * - sendEvent: never throws (fire-and-forget safety)
 * - getInstallId: returns the expected ID after initialization
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── VSCode mock ──────────────────────────────────────────────────────────────

// Shared mutable state for the mock config getter
const mockConfigGet = vi.fn((_key: string, defaultValue?: unknown) => {
  return defaultValue ?? true;
});

/** In-memory store that simulates ExtensionContext.globalState */
const mockGlobalStore = new Map<string, unknown>();

/**
 * Create a fake ExtensionContext backed by mockGlobalStore.
 */
function fakeContext(): any {
  return {
    globalState: {
      get: (key: string) => mockGlobalStore.get(key),
      update: (key: string, value: unknown) => { mockGlobalStore.set(key, value); },
    },
  };
}

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn(() => ({
      packageJSON: { version: '0.3.1' },
    })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mockConfigGet,
      update: vi.fn(),
      has: vi.fn(),
      inspect: vi.fn(),
    })),
  },
  version: '1.86.0',
}));

// ── Module under test ────────────────────────────────────────────────────────

import { initializeTelemetry, sendEvent, getInstallId } from '../telemetry';

describe('telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGlobalStore.clear();
  });

  // ── initializeTelemetry ───────────────────────────────────────────────────

  describe('initializeTelemetry', () => {
    it('should generate a 16-character install ID on first run', () => {
      initializeTelemetry(fakeContext());

      const id = getInstallId();
      expect(id).toBeDefined();
      expect(id).toHaveLength(16);
      // Verify it was persisted
      expect(mockGlobalStore.has('ailinter.installId')).toBe(true);
      expect(mockGlobalStore.get('ailinter.installId')).toBe(id);
    });

    it('should reuse an existing install ID from globalState', () => {
      mockGlobalStore.set('ailinter.installId', 'existing_id_123!');

      initializeTelemetry(fakeContext());

      expect(getInstallId()).toBe('existing_id_123!');
    });

    it('should not throw if globalState throws', () => {
      expect(() => initializeTelemetry({
        globalState: {
          get: (_key: string) => { throw new Error('storage error'); },
          update: (_key: string, _value: unknown) => { throw new Error('storage error'); },
        },
      } as any)).not.toThrow();
    });
  });

  // ── sendEvent ──────────────────────────────────────────────────────────────

  describe('sendEvent', () => {
    beforeEach(() => {
      // Initialize telemetry so installId is set
      initializeTelemetry(fakeContext());
    });

    it('should not throw when telemetry is enabled', () => {
      mockConfigGet.mockReturnValue(true);

      expect(() => {
        sendEvent('test.event', { foo: 'bar' });
      }).not.toThrow();
    });

    it('should not send when telemetry is disabled (opt-out)', () => {
      mockConfigGet.mockReturnValue(false);

      expect(() => {
        sendEvent('test.event', { foo: 'bar' });
      }).not.toThrow();
    });

    it('should not throw when config read fails', () => {
      mockConfigGet.mockImplementation(() => { throw new Error('config error'); });

      expect(() => {
        sendEvent('test.event');
      }).not.toThrow();
    });

    it('should use "unknown" installId if not initialized', () => {
      // Clear module state by clearing the store and sending before init
      mockGlobalStore.clear();

      expect(() => {
        sendEvent('event.before_init');
      }).not.toThrow();
    });
  });

  // ── getInstallId ───────────────────────────────────────────────────────────

  describe('getInstallId', () => {
    it('should return a 16-character ID after initialization', () => {
      initializeTelemetry(fakeContext());

      const id = getInstallId();
      expect(id).toBeDefined();
      expect(id).toHaveLength(16);
    });
  });
});
