# AILINTER — AI Code Safety Visor for VS Code

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-v0.2.0-007ACC?logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=ailinter.ailinter)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-Registry-9146FF)](https://open-vsx.org/)
[![AILINTER](https://img.shields.io/badge/AILINTER-30MB%20binary-6e41e2)](https://ailinter.dev)

**Real-time code quality scoring, secret detection, and vulnerability scanning — right in your editor.**

AILINTER is the VS Code companion for the [AILINTER](https://ailinter.dev) open-source safety visor. It turns your editor into a code health dashboard: every file gets a quality score, every secret gets caught before commit, and every code smell comes with step-by-step refactoring guidance.

---

## Features

### 🛡️ Code Health Monitor

Each file you save gets a **0–100 quality score** displayed in the status bar:

| Score | Label | What It Means |
|-------|-------|---------------|
| 80–100 | 🟢 Go Ahead | Safe for AI modification |
| 60–79 | 🟡 Proceed with Care | Small isolated changes, re-check after each |
| 40–59 | 🟠 Needs Work | Significant issues — refactor incrementally |
| 0–39 | 🔴 Stop & Refactor | Must refactor before AI touches this file |

### 🔍 Inline Issue Detection

Problems appear directly in your code with severity-coded decorations:

- **Red wavy underline** — Critical vulnerability or secret
- **Orange wavy underline** — Error or high-severity quality issue
- **Yellow squiggle** — Warning or moderate quality concern
- **Gutter icons** — Visual severity indicators in the line number gutter

### 💡 Rich Hover Information

Hover over any underlined code to see:
- What the issue is and why it matters
- Which category: quality, secret, vulnerability, or metalinter
- The specific smell type (e.g., `deep_nesting`, `brain_method`)

### ⚡ Quick Fix Actions (Lightbulb)

Press `Cmd+.` (Mac) or `Ctrl+.` (Windows/Linux) on any issue line to access:

- **Get Refactoring Strategy** — Opens detailed fix guidance for code smells
- **Replace Secret** — Converts hardcoded secrets to environment variables
- **Suppress Warning** — Adds an `ailinter:disable` comment

### 📊 Function-Level Score Annotations (CodeLens)

See each function's quality score right above its definition. CodeLens annotations appear automatically after scanning.

### 📋 Problems Panel Integration

Every issue appears in VS Code's Problems panel (`View → Problems`) with severity, file, line, and description — filterable and clickable.

### 📈 Sidebar Overview

Open the AILINTER sidebar in the Explorer panel (`View → Explorer → AILINTER`) to see:

- Overall project health score
- File count and issue statistics
- Trending hotspots (files with most issues)
- Top code smells across your project

---

## Quick Start

### Prerequisites

You need the AILINTER binary installed:

```bash
# macOS (Homebrew)
brew install ailinter/ailinter/ailinter

# Linux / Windows
# Download from: https://github.com/ailinter/ailinter/releases

# Verify installation
ailinter version
```

### Using the Extension

1. **Install** the extension from the VS Code Marketplace
2. **Open** any Go, Python, JavaScript, TypeScript, or Java file
3. **Save** (`Cmd+S`) — AILINTER scans automatically and shows your quality score in the status bar
4. **Click** the status bar score to see file details
5. **Hover** over underlined issues for explanations
6. **Click** the lightbulb to fix issues with one click

---

## Commands

All commands are available via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `AILINTER: Scan current file` | Manually trigger a scan on the active file |
| `AILINTER: Show file quality details` | Display score and issue count for current file |
| `AILINTER: Get refactoring strategy` | Open detailed fix guidance for a code smell |
| `AILINTER: Replace secret with environment variable` | Convert a hardcoded secret to `process.env` |
| `AILINTER: Suppress warning on this line` | Add `ailinter:disable` comment to skip a finding |
| `AILINTER: Show vulnerability details` | View full details of a security vulnerability |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ailinter.path` | `"ailinter"` | Path to the AILINTER binary (`/usr/local/bin/ailinter`, etc.) |
| `ailinter.enable` | `true` | Enable scanning on file save |
| `ailinter.scanOnOpen` | `false` | Automatically scan files when opened |
| `ailinter.qualityThreshold` | `80` | Minimum score (0–100). Files below this show warnings. |
| `ailinter.showGutterIcons` | `true` | Show severity icons in the gutter |
| `ailinter.showCodeLens` | `true` | Show function-level score annotations |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd+.` / `Ctrl+.` | Open Quick Fix (lightbulb) on current issue line |
| `Cmd+S` / `Ctrl+S` | Save file → triggers automatic scan |
| `Cmd+Shift+P` → type `AILINTER` | List all AILINTER commands |

---

## Requirements

- **VS Code** 1.86.0 or later
- **AILINTER binary** installed on your system (`ailinter` in PATH, or configure `ailinter.path`)
- Supported languages: Go, Python, JavaScript, TypeScript, Java, C#, PHP (more coming)

---

## Tips

- **First scan?** Open any file and save it. The status bar updates immediately.
- **Watch the delta**: AILINTER tracks before/after scores on each save — green means you improved the code.
- **Secrets stay safe**: Secrets found by AILINTER are never sent to AI tools — only redacted previews appear.
- **Custom binary path**: If `ailinter` isn't in your PATH, set `ailinter.path` in settings.
- **Notifications**: AILINTER warns you if a file's score regresses (drops) after a save.

---

## Known Issues

- **Windows**: The extension has been tested on macOS and Linux. Windows support is experimental. Report issues on [GitHub](https://github.com/ailinter/ailinter/issues).
- **Large files**: Files over 1000 lines may take a few seconds to scan. Performance optimizations are in progress.
- **First scan delay**: The initial scan downloads detection rules. Subsequent scans are instant.

---

## Extension Settings Reference

To configure AILINTER in VS Code:

```json
{
  "ailinter.path": "/opt/homebrew/bin/ailinter",
  "ailinter.enable": true,
  "ailinter.scanOnOpen": true,
  "ailinter.qualityThreshold": 75,
  "ailinter.showGutterIcons": true,
  "ailinter.showCodeLens": true
}
```

---

## Feedback & Contributions

Found a bug? Have a feature request? We'd love to hear from you:

- [Open an Issue](https://github.com/ailinter/ailinter/issues)
- [Contribute](https://github.com/ailinter/ailinter/blob/main/CONTRIBUTING.md)
- [Discussions](https://github.com/ailinter/ailinter/discussions)

---

## License

MIT © [AILINTER](https://ailinter.dev)

---

## What's New in v0.2.0

- **Project health sidebar** — overview of your entire workspace's code health
- **Before/after delta tracking** — see if your score improved or regressed
- **Hover provider** — rich explanations on every issue
- **Quick Fix: Replace secret** — one-click secret-to-env-var conversion
- **CodeLens annotations** — function-level scores inline
- **Configurable gutter icons** — toggle decorations in settings
- **Refactoring strategy links** — get detailed fix guides for any smell
