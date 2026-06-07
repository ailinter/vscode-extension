/**
 * Per-Path Rule Customization — right-click a folder to create/edit
 * `.ailinter.toml` configuration files.
 *
 * Provides:
 *  - `ailinter.createRulesTemplate`: Create .ailinter.toml in a folder
 *  - `ailinter.editRules`: Walk up the tree to find and edit .ailinter.toml
 *
 * Inspired by CodeScene's per-path rules customization UI pattern.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Register all rules-related commands.
 * Call from activate().
 */
export function registerRulesCommands(context: vscode.ExtensionContext): void {
  // Command: create rules template at a given folder path
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.createRulesTemplate', async (uri: vscode.Uri) => {
      const folderPath = uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folderPath) {
        vscode.window.showErrorMessage('AILINTER: No folder selected.');
        return;
      }

      const stats = fs.statSync(folderPath);
      if (!stats.isDirectory()) {
        vscode.window.showErrorMessage('AILINTER: Selected path is not a folder.');
        return;
      }

      const tomlPath = path.join(folderPath, '.ailinter.toml');
      if (fs.existsSync(tomlPath)) {
        // Open existing file
        const doc = await vscode.workspace.openTextDocument(tomlPath);
        vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`AILINTER: Opened existing rules file at ${path.basename(folderPath)}/.ailinter.toml`);
        return;
      }

      // Generate template with path-specific defaults
      const template = `# AILINTER Configuration for ${path.basename(folderPath)}
# See https://ailinter.dev/docs/configuration for all options.
# This file applies to all files under this directory.

[quality]
# Minimum quality score (0-100). Files below this trigger warnings.
threshold = 80

# Per-path ignore rules: disable specific code smells for matching files.
# Glob patterns are relative to this directory.
[ignore]
# Uncomment to disable specific smells:
# deep_nesting = ["*.go"]
# global_data = ["internal/analyzer/*.go"]
# brain_method = ["**/*_test.go"]

# Per-language thresholds (override global defaults)
[language.go]
max_nesting_depth = 4
max_cyclomatic_complexity = 9
max_function_loc = 80

[language.python]
max_nesting_depth = 4
max_cyclomatic_complexity = 9
max_function_loc = 70

[language.javascript]
max_nesting_depth = 3
max_cyclomatic_complexity = 9
max_function_loc = 60
`;

      try {
        fs.writeFileSync(tomlPath, template, 'utf-8');
        const doc = await vscode.workspace.openTextDocument(tomlPath);
        vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(
          `AILINTER: Created .ailinter.toml with template rules for ${path.basename(folderPath)}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`AILINTER: Failed to create rules file: ${msg}`);
      }
    })
  );

  // Command: edit rules for the current file (walks up directory tree)
  context.subscriptions.push(
    vscode.commands.registerCommand('ailinter.editRules', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('AILINTER: Open a file to edit its nearest rules file.');
        return;
      }

      const startDir = path.dirname(editor.document.fileName);
      let dir = startDir;

      // Walk up directory tree to find .ailinter.toml
      while (dir !== path.parse(dir).root) {
        const tomlPath = path.join(dir, '.ailinter.toml');
        if (fs.existsSync(tomlPath)) {
          const doc = await vscode.workspace.openTextDocument(tomlPath);
          vscode.window.showTextDocument(doc);
          vscode.window.showInformationMessage(`AILINTER: Editing rules for ${path.relative(dir, startDir) || '.'}`);
          return;
        }
        dir = path.dirname(dir);
      }

      // None found — walk up from workspace root too
      const wsFolders = vscode.workspace.workspaceFolders;
      if (wsFolders && wsFolders.length > 0) {
        let wsDir = wsFolders[0].uri.fsPath;
        while (wsDir !== path.parse(wsDir).root) {
          const tomlPath = path.join(wsDir, '.ailinter.toml');
          if (fs.existsSync(tomlPath)) {
            const doc = await vscode.workspace.openTextDocument(tomlPath);
            vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`AILINTER: Editing workspace rules at ${tomlPath}`);
            return;
          }
          wsDir = path.dirname(wsDir);
        }
      }

      // None found — offer to create at workspace root
      const action = await vscode.window.showInformationMessage(
        'AILINTER: No .ailinter.toml found. Create one at workspace root?',
        'Create',
        'Cancel'
      );
      if (action === 'Create') {
        const rootUri = wsFolders?.[0]?.uri;
        if (rootUri) {
          await vscode.commands.executeCommand('ailinter.createRulesTemplate', rootUri);
        }
      }
    })
  );
}
