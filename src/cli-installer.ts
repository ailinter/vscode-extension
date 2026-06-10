/**
 * AILINTER CLI Auto-Installer
 *
 * Handles detection of the AILINTER binary and automatic download from
 * GitHub Releases when it's not found on the system.
 *
 * The binary is cached in the extension's globalStoragePath after download
 * so the user only needs to download once.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { sendEvent } from './telemetry';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlatformInfo {
  os: string;   // 'darwin' | 'linux' | 'windows'
  arch: string; // 'amd64' | 'arm64'
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

const GITHUB_REPO = 'ailinter/ailinter';
const API_BASE = `https://api.github.com/repos/${GITHUB_REPO}`;
const RELEASE_LATEST_URL = `${API_BASE}/releases/latest`;
/** Fetches all releases (up to 30) — used when channel is "latest" to find prereleases */
const RELEASES_URL = `${API_BASE}/releases?per_page=30`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether the binary at `binaryPath` is a working AILINTER CLI.
 * Spawns "ailinter --version" — exit code 0 means the binary works.
 */
export async function isAilinterAvailable(binaryPath: string): Promise<boolean> {
  if (!binaryPath) {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    let proc: cp.ChildProcess;
    try {
      proc = cp.spawn(binaryPath, ['--version'], {
        timeout: 10_000,
        stdio: 'ignore',
      });
    } catch {
      resolve(false);
      return;
    }

    proc.on('error', () => {
      resolve(false);
    });

    proc.on('close', (code) => {
      // Code 0 = binary works (--version exits 0 on success)
      resolve(code === 0);
    });
  });
}

/**
 * Main entry point. Resolves the AILINTER binary path by trying (in order):
 *   1. User-configured `ailinter.path` setting
 *   2. System PATH for `ailinter`
 *   3. Cached binary in globalStoragePath
 *   4. Prompt user to download from GitHub
 *
 * Returns the resolved binary path string, or `undefined` if unavailable.
 */
export async function checkAndPromptInstall(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('ailinter');

  // ── Step 1: Check configured path ──────────────────────────────────────
  const configuredPath = config.get<string>('path', '');
  if (configuredPath) {
    if (await isAilinterAvailable(configuredPath)) {
      console.log(`[ailinter] Using configured path: ${configuredPath}`);
      sendEvent('cli.already_installed', { source: 'auto' });
      return configuredPath;
    }
    console.log(`[ailinter] Configured path "${configuredPath}" not found — falling back`);
  }

  // ── Step 2: Check system PATH ──────────────────────────────────────────
  const pathBinary = 'ailinter';
  if (await isAilinterAvailable(pathBinary)) {
    console.log('[ailinter] Found ailinter on PATH');
    sendEvent('cli.already_installed', { source: 'brew' });
    return pathBinary;
  }

  // ── Step 3: Check cached binary in globalStoragePath ───────────────────
  const cachedPath = getCachedBinaryPath(context);
  if (cachedPath) {
    if (await isAilinterAvailable(cachedPath)) {
      console.log(`[ailinter] Found cached binary at: ${cachedPath}`);
      // Update config so other components use this path
      config.update('path', cachedPath, vscode.ConfigurationTarget.Global);
      sendEvent('cli.already_installed', { source: 'cached' });
      return cachedPath;
    }
    // Stale cache entry — remove it so we can re-download
    try { fs.unlinkSync(cachedPath); } catch { /* ignore */ }
  }

  // ── Step 4: Prompt user to download ────────────────────────────────────
  sendEvent('cli.install.prompted');

  const selection = await vscode.window.showInformationMessage(
    '🛡️ AILINTER CLI not found. Download and install automatically?',
    'Download',
    'Not now'
  );

  if (selection === 'Download') {
    try {
      const downloadedPath = await downloadAndInstall(context);
      if (downloadedPath) {
        // Update the status bar to show AILINTER is ready
        vscode.commands.executeCommand('setContext', 'ailinter:cliReady', true);
        sendEvent('cli.already_installed', { source: 'auto' });
        return downloadedPath;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ailinter] Download failed: ${message}`);
      sendEvent('cli.install.failed', {
        error_type: message.toLowerCase().includes('timeout') ? 'timeout'
          : message.toLowerCase().includes('rate limit') ? 'rate_limit'
          : message.toLowerCase().includes('corrupted') ? 'corrupted'
          : 'unknown',
      });
      vscode.window.showErrorMessage(
        `Failed to download AILINTER CLI: ${message}. ` +
        'Install manually with: brew install ailinter/ailinter/ailinter'
      );
    }
    return undefined;
  }

  console.log('[ailinter] User declined auto-install');
  return undefined;
}

// ── Download & Install ───────────────────────────────────────────────────────

/**
 * Download the latest AILINTER CLI release for the current platform,
 * cache it in the extension's globalStoragePath, and verify it works.
 *
 * Returns the path to the cached binary on success, or `undefined` on failure.
 *
 * @throws {Error} If fetching release info or downloading fails.
 */
export async function downloadAndInstall(
  context: vscode.ExtensionContext
): Promise<string> {
  const platform = getPlatformInfo();

  // ── 1. Fetch release info from GitHub API ──────────────────────────────
  // "stable" channel: /releases/latest (excludes pre-releases)
  // "latest" channel: includes pre-releases
  const config = vscode.workspace.getConfiguration('ailinter');
  const channel = config.get<string>('cliUpdateChannel', 'stable');
  const includePrerelease = channel === 'latest';
  const release = await fetchLatestRelease(includePrerelease);
  sendEvent('cli.install.started', { channel });

  // ── 2. Find the matching asset for this platform ───────────────────────
  const assetName = getAssetName(release.tag_name, platform);
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(
      `No asset found for ${platform.os}/${platform.arch}. ` +
      `Expected name: "${assetName}". Available: ${release.assets.map((a) => a.name).join(', ')}`
    );
  }

  // ── 3. Ensure the install directory exists ─────────────────────────────
  const installDir = context.globalStoragePath;
  if (!fs.existsSync(installDir)) {
    fs.mkdirSync(installDir, { recursive: true });
  }

  const binaryName = platform.os === 'windows' ? 'ailinter.exe' : 'ailinter';
  const binaryPath = path.join(installDir, binaryName);

  // ── 4. Download with progress ──────────────────────────────────────────
  const downloadStartTime = Date.now();
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'AILINTER',
      cancellable: false,
    },
    async (progress) => {
      progress.report({
        message: `Downloading CLI v${release.tag_name.replace(/^v/, '')} for ${platform.os}/${platform.arch}...`,
      });

      await downloadFile(asset.browser_download_url, binaryPath);

      // Make executable on macOS/Linux
      if (platform.os !== 'windows') {
        progress.report({ message: 'Setting permissions...' });
        fs.chmodSync(binaryPath, 0o755);
      }

      progress.report({ message: 'Verifying installation...' });
      const available = await isAilinterAvailable(binaryPath);
      if (!available) {
        // Clean up broken download
        try { fs.unlinkSync(binaryPath); } catch { /* ignore */ }
        throw new Error('Downloaded binary failed verification — it may be corrupted');
      }
    }
  );

  // ── 5. Update config ──────────────────────────────────────────────────
  config.update('path', binaryPath, vscode.ConfigurationTarget.Global);

  console.log(`[ailinter] Successfully installed CLI at: ${binaryPath}`);
  sendEvent('cli.install.completed', {
    duration_seconds: Math.round((Date.now() - downloadStartTime) / 1000),
    channel,
  });
  return binaryPath;
}

// ── Platform Detection ───────────────────────────────────────────────────────

/**
 * Detect the current OS and CPU architecture for asset matching.
 */
export function getPlatformInfo(): PlatformInfo {
  const nodePlatform = process.platform; // 'darwin', 'linux', 'win32'
  const nodeArch = process.arch;         // 'x64' → 'amd64', 'arm64' → 'arm64'

  let os: string;
  switch (nodePlatform) {
    case 'darwin':
      os = 'darwin';
      break;
    case 'win32':
      os = 'windows';
      break;
    case 'linux':
      os = 'linux';
      break;
    default:
      os = 'linux'; // Fallback to linux for unsupported platforms
      break;
  }

  let arch: string;
  switch (nodeArch) {
    case 'x64':
      arch = 'amd64';
      break;
    case 'arm64':
      arch = 'arm64';
      break;
    default:
      arch = 'amd64'; // Fallback
      break;
  }

  return { os, arch };
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Build the asset name expected for the given release tag and platform.
 *
 * Release assets follow the pattern:
 *   ailinter_v{version}_{os}_{arch}
 *   ailinter_v{version}_windows_amd64.exe  (Windows only)
 */
export function getAssetName(tagName: string, platform: PlatformInfo): string {
  const base = `ailinter_${tagName}_${platform.os}_${platform.arch}`;
  return platform.os === 'windows' ? `${base}.exe` : base;
}

/**
 * Get the path to the cached binary in the extension's globalStoragePath.
 * Returns `undefined` if no cached binary exists.
 */
function getCachedBinaryPath(context: vscode.ExtensionContext): string | undefined {
  const installDir = context.globalStoragePath;
  if (!fs.existsSync(installDir)) {
    return undefined;
  }

  const binaryName = process.platform === 'win32' ? 'ailinter.exe' : 'ailinter';
  const binaryPath = path.join(installDir, binaryName);

  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }
  return undefined;
}

/**
 * Fetch the latest release info from GitHub API.
 *
 * When `includePrerelease` is true, fetches all releases and returns the
 * newest one (which may be a pre-release). When false, uses the dedicated
 * /releases/latest endpoint which excludes pre-releases by default.
 *
 * @throws {Error} If the API returns a non-200 response (403 = rate limit, etc.)
 */
async function fetchLatestRelease(includePrerelease: boolean = false): Promise<GitHubRelease> {
  const url = includePrerelease ? RELEASES_URL : RELEASE_LATEST_URL;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ailinter-vscode-extension',
    },
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        'GitHub API rate limit exceeded (60 req/hr for unauthenticated requests). ' +
        'Please try again later, or install manually from: ' +
        'https://github.com/ailinter/ailinter/releases'
      );
    }
    throw new Error(
      `GitHub API returned ${response.status}: ${response.statusText}. ` +
      'Install manually from: https://github.com/ailinter/ailinter/releases'
    );
  }

  if (includePrerelease) {
    // Fetch all releases and return the newest one (may be a prerelease)
    const releases = (await response.json()) as GitHubRelease[];
    if (releases.length === 0) {
      throw new Error('No releases found in the repository');
    }
    return releases[0]; // Already sorted by GitHub, newest first
  }

  return (await response.json()) as GitHubRelease;
}

/**
 * Download a file from `url` and save it to `destinationPath`.
 * Uses streaming to avoid loading the entire file into memory.
 * Supports both http/https and file:// protocols.
 */
async function downloadFile(url: string, destinationPath: string): Promise<void> {
  // Use Node.js built-in https module to avoid pulling in extra dependencies
  const http = url.startsWith('https') ? await import('https') : await import('http');

  return new Promise<void>((resolve, reject) => {
    http.get(url, (response) => {
      if (response.statusCode !== 200) {
        // Handle redirects (301/302/307/308)
        if (response.statusCode === 301 || response.statusCode === 302 ||
            response.statusCode === 307 || response.statusCode === 308) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            response.resume(); // Drain current response
            downloadFile(redirectUrl, destinationPath).then(resolve).catch(reject);
            return;
          }
        }
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(destinationPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        fs.unlink(destinationPath, () => {}); // Clean up partial download
        reject(err);
      });
    }).on('error', (err) => {
      reject(new Error(`Network error during download: ${err.message}`));
    });
  });
}
