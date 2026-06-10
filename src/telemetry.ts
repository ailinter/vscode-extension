/**
 * AILINTER VS Code Extension — Telemetry Module
 *
 * Lightweight, zero-dependency telemetry for anonymous usage data.
 * Fire-and-forget event delivery to the AILINTER telemetry pipeline.
 * No file paths, source code, or personal data is ever collected.
 * Opt-out via the `ailinter.telemetry` setting.
 *
 * Design principles:
 *  - NEVER throw — all errors are caught silently
 *  - NEVER block — fire-and-forget fetch with .catch()
 *  - NEVER include file paths, file names, or source code
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as os from 'os';

const TELEMETRY_ENDPOINT = 'https://telemetry.ailinter.dev/v1/events';

let installId: string | undefined;
let extensionVersion: string | undefined;

/**
 * Initialize telemetry — called once on activation.
 * Generates a stable install ID from machine + user hash.
 */
export function initializeTelemetry(context: vscode.ExtensionContext): void {
  try {
    // Get or generate install ID (persisted across sessions)
    installId = context.globalState.get<string>('ailinter.installId');
    if (!installId) {
      const hash = crypto.createHash('sha256');
      hash.update(os.hostname() + os.userInfo().username);
      installId = hash.digest('hex').substring(0, 16);
      context.globalState.update('ailinter.installId', installId);
    }

    extensionVersion = getExtensionVersion();
  } catch {
    // Absolute safety — never break the extension for telemetry init
  }
}

/**
 * Safely read the extension version from package.json.
 * Extracted to reduce nesting in initializeTelemetry.
 */
function getExtensionVersion(): string {
  try {
    return vscode.extensions.getExtension('ailinter.ailinter')?.packageJSON?.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Send a telemetry event. Fire-and-forget — never blocks or throws.
 * Respects the `ailinter.telemetry` opt-out setting.
 */
export function sendEvent(
  name: string,
  attributes: Record<string, string | number | boolean> = {}
): void {
  try {
    const config = vscode.workspace.getConfiguration('ailinter');
    if (!config.get<boolean>('telemetry', true)) return;

    const resource = {
      'service.name': 'ailinter-vscode',
      'service.version': extensionVersion || 'unknown',
      'os.name': process.platform,
      'host.arch': process.arch,
      'install.id': installId || 'unknown',
      'vs_code.version': vscode.version,
    };

    const payload = { name, timestamp: new Date().toISOString(), attributes, resource };

    postEvent(payload);
  } catch {
    // Absolute safety — even if config read fails, don't throw
  }
}

/**
 * Fire-and-forget POST to the telemetry endpoint.
 * Extracted to reduce nesting in sendEvent.
 */
function postEvent(payload: unknown): void {
  fetch(TELEMETRY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Silent fail — never break the extension for telemetry
  });
}

/**
 * Get the install ID for logging/debugging purposes.
 */
export function getInstallId(): string | undefined {
  return installId;
}
