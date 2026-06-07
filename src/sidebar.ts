/**
 * Sidebar Tree View: project health overview, hotspots, and smell breakdown.
 * Mirrors CodeScene's project-level analysis in a tree view.
 *
 * Structure:
 *   AILINTER
 *   ├─ 🟢 Overall Health: 85/100
 *   ├─ 3/10 files with issues
 *   ├─ 🔥 Hotspots (expanded)
 *   │   ├─ 🔴 src/bad.go — 42/100 (12 issues)
 *   │   └─ 🟡 src/ok.go — 72/100 (3 issues)
 *   └─ 👃 Top Code Smells (collapsed)
 *       ├─ deep_nesting — 4 occurrences
 *       ├─ brain_method — 3 occurrences
 *       └─ god_class — 1 occurrence
 */
import * as vscode from 'vscode';
import { AilinterFinding, FileScore, ProjectHealth } from './types';

// ── Tree item types ──────────────────────────────────────────────────────────

class AilinterTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly type: 'overview' | 'hotspots_category' | 'smells_category' | 'file' | 'smell',
    public readonly metadata?: { filePath?: string; score?: number; count?: number; smell?: string }
  ) {
    super(label, collapsibleState);

    this.contextValue = type;

    switch (type) {
      case 'overview':
        this.iconPath = new vscode.ThemeIcon('shield');
        break;
      case 'hotspots_category':
        this.iconPath = new vscode.ThemeIcon('flame');
        break;
      case 'smells_category':
        this.iconPath = new vscode.ThemeIcon('beaker');
        break;
      case 'file':
        this.iconPath = new vscode.ThemeIcon('file');
        this.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(metadata?.filePath || '')],
        };
        this.tooltip = metadata?.score !== undefined
          ? `Score: ${metadata.score}/100 — ${metadata.count} issues`
          : undefined;
        break;
      case 'smell':
        this.iconPath = new vscode.ThemeIcon('symbol-constant');
        this.tooltip = metadata?.count !== undefined
          ? `${metadata.count} occurrences`
          : undefined;
        break;
    }
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class AilinterSidebarProvider implements vscode.TreeDataProvider<AilinterTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projectHealth?: ProjectHealth;
  private fileScores: FileScore[] = [];

  /**
   * Update the sidebar with fresh data from the latest scan.
   * Calls refresh so the tree re-renders.
   */
  update(health: ProjectHealth, scores: FileScore[]): void {
    this.projectHealth = health;
    this.fileScores = scores;
    this._onDidChangeTreeData.fire();
  }

  /** Clear all data */
  clear(): void {
    this.projectHealth = undefined;
    this.fileScores = [];
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AilinterTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AilinterTreeItem): AilinterTreeItem[] {
    if (!element) {
      return this.getRootItems();
    }

    switch (element.type) {
      case 'hotspots_category':
        return this.getHotspotItems();
      case 'smells_category':
        return this.getSmellItems();
      default:
        return [];
    }
  }

  // ── Root items ──────────────────────────────────────────────────────────

  private getRootItems(): AilinterTreeItem[] {
    const items: AilinterTreeItem[] = [];

    if (this.projectHealth) {
      const scoreIcon =
        this.projectHealth.overallScore >= 80
          ? '🟢'
          : this.projectHealth.overallScore >= 60
            ? '🟡'
            : '🔴';

      // Overall health
      items.push(
        new AilinterTreeItem(
          `${scoreIcon} Overall Health: ${this.projectHealth.overallScore}/100`,
          vscode.TreeItemCollapsibleState.None,
          'overview',
          { score: this.projectHealth.overallScore }
        )
      );

      // Summary line
      items.push(
        new AilinterTreeItem(
          `${this.projectHealth.filesWithIssues}/${this.projectHealth.fileCount} files with issues — ${this.projectHealth.totalFindings} total findings`,
          vscode.TreeItemCollapsibleState.None,
          'overview'
        )
      );

      // Hotspots category (expanded by default)
      items.push(
        new AilinterTreeItem(
          '🔥 Hotspots',
          this.projectHealth.filesWithIssues > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed,
          'hotspots_category'
        )
      );

      // Smells category (collapsed)
      items.push(
        new AilinterTreeItem(
          '👃 Top Code Smells',
          this.projectHealth.topSmells.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          'smells_category'
        )
      );
    } else {
      items.push(
        new AilinterTreeItem(
          'No scans yet — save a file to begin',
          vscode.TreeItemCollapsibleState.None,
          'overview'
        )
      );
    }

    return items;
  }

  // ── Hotspot files (score < 80, sorted worst-first) ──────────────────────

  private getHotspotItems(): AilinterTreeItem[] {
    const hotspots = this.fileScores
      .filter(f => f.score < 80)
      .sort((a, b) => a.score - b.score);

    if (hotspots.length === 0) {
      return [new AilinterTreeItem('✅ No hotspots detected', vscode.TreeItemCollapsibleState.None, 'overview')];
    }

    return hotspots.slice(0, 20).map(f => {
      const icon = f.score < 60 ? '🔴' : '🟡';
      const relativePath = vscode.workspace.asRelativePath(f.path);
      const issueCount = f.findings.length;
      return new AilinterTreeItem(
        `${icon} ${f.score}/100 — ${relativePath}`,
        vscode.TreeItemCollapsibleState.None,
        'file',
        { filePath: f.path, score: f.score, count: issueCount }
      );
    });
  }

  // ── Top code smells ─────────────────────────────────────────────────────

  private getSmellItems(): AilinterTreeItem[] {
    if (!this.projectHealth || this.projectHealth.topSmells.length === 0) {
      return [new AilinterTreeItem('No smells detected', vscode.TreeItemCollapsibleState.None, 'overview')];
    }

    return this.projectHealth.topSmells.slice(0, 15).map(s => {
      const icon = s.count >= 5 ? '🔴' : s.count >= 3 ? '🟡' : '🟢';
      return new AilinterTreeItem(
        `${icon} ${s.smell} — ${s.count} occurrence${s.count !== 1 ? 's' : ''}`,
        vscode.TreeItemCollapsibleState.None,
        'smell',
        { smell: s.smell, count: s.count }
      );
    });
  }
}
