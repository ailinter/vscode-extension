/**
 * Webview HTML content generators — builds rich documentation HTML
 * for code smell descriptions, severity, and before/after examples.
 *
 * Uses @vscode/webview-ui-toolkit components for VS Code-native UI
 * (Feature 5: @vscode/elements).
 *
 * Inspired by CodeScene's documentation-components.ts pattern.
 */

import * as vscode from 'vscode';
import { KNOWN_SMELLS } from '../types';

/**
 * Get the webview URI for the toolkit module.
 */
function getToolkitUri(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const toolkitUri = vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js');
  return webview.asWebviewUri(toolkitUri).toString();
}

/**
 * Build the full HTML for the smell documentation page.
 *
 * @param smellType The code smell type (e.g., "deep_nesting")
 * @param webview The webview instance (for URI conversion)
 * @param extensionUri The extension URI (for resource paths)
 * @returns Complete HTML document string
 */
export function buildDocHtml(
  smellType: string,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const smellName = formatSmellName(smellType);
  const severity = getSmellSeverity(smellType);
  const description = getSmellDescription(smellType);
  const harmful = getWhyHarmful(smellType);
  const beforeExample = getBeforeExample(smellType);
  const afterExample = getAfterExample(smellType);
  const docsUrl = `https://ailinter.dev/docs/quality#${smellType}`;
  const toolkitSrc = getToolkitUri(webview, extensionUri);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' https:; font-src 'self' https:;">
  <script type="module" src="${toolkitSrc}"></script>
  <style>
    ${getStyles()}
  </style>
</head>
<body>
  <header class="header">
    <h1>
      <span class="severity-badge severity-${severity}">${getSeverityLabel(smellType)}</span>
      ${smellName}
    </h1>
    <p class="category-label">Code Smell</p>
  </header>

  <vscode-panels>
    <vscode-panel-tab id="tab-description">📋 Description</vscode-panel-tab>
    <vscode-panel-tab id="tab-examples">📝 Before / After</vscode-panel-tab>
    <vscode-panel-tab id="tab-actions">🔧 Actions</vscode-panel-tab>

    <vscode-panel-view id="view-description">
      <section class="section">
        <h2>What Is It?</h2>
        <p>${description}</p>
      </section>
      <section class="section">
        <h2>⚠️ Why It's Harmful</h2>
        <p>${harmful}</p>
      </section>
    </vscode-panel-view>

    <vscode-panel-view id="view-examples">
      <section class="section">
        <div class="code-block">
          <div class="code-header">❌ Before</div>
          <pre><code>${escapeHtml(beforeExample)}</code></pre>
        </div>
        <div class="code-block">
          <div class="code-header code-header-good">✅ After</div>
          <pre><code>${escapeHtml(afterExample)}</code></pre>
        </div>
      </section>
    </vscode-panel-view>

    <vscode-panel-view id="view-actions">
      <section class="section" style="display:flex;flex-direction:column;gap:12px;">
        <vscode-button appearance="primary" onclick="getStrategy()">
          🔧 Get Refactoring Strategy
        </vscode-button>
        <vscode-button appearance="secondary" onclick="openDocs()">
          📖 Full Documentation
        </vscode-button>
      </section>
    </vscode-panel-view>
  </vscode-panels>

  <div id="stale-warning" style="display:none;padding:8px;background:var(--vscode-inputValidation-warningBackground);margin-top:12px;border-radius:4px"></div>

  <footer class="footer">
    <p>Learn more at <a href="#" onclick="openUrl('${docsUrl}')">ailinter.dev/docs/quality</a></p>
  </footer>

  <script>
    const vscode = acquireVsCodeApi();
    function getStrategy() {
      vscode.postMessage({ type: 'getStrategy', smell: '${smellType}' });
    }
    function openDocs() {
      vscode.postMessage({ type: 'openUrl', url: '${docsUrl}' });
    }
    function openUrl(url) {
      vscode.postMessage({ type: 'openUrl', url: url });
    }

    // Listen for staleness warnings from the extension (Feature 4)
    window.addEventListener('message', (e) => {
      if (e.data.type === 'stale') {
        const warning = document.getElementById('stale-warning');
        if (warning) {
          warning.textContent = e.data.message;
          warning.style.display = 'block';
        }
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Build inline styles for the webview.
 * Uses VS Code theme CSS variables for dark/light mode compatibility.
 */
export function getStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      padding: 24px;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: var(--vscode-font-size, 14px);
      color: var(--vscode-foreground, #cccccc);
      background: var(--vscode-editor-background, #1e1e1e);
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      margin-bottom: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      color: var(--vscode-textLink-foreground, #4da6ff);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .category-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--vscode-descriptionForeground, #888);
    }
    .section {
      margin-bottom: 24px;
    }
    h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--vscode-sideBarTitle-foreground, #ccc);
    }
    p {
      margin-bottom: 12px;
      color: var(--vscode-foreground, #ccc);
    }
    .severity-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .severity-critical { background: #f85149; color: #fff; }
    .severity-error { background: #d29922; color: #000; }
    .severity-warning { background: #58a6ff; color: #000; }
    .severity-info { background: #238636; color: #fff; }
    .code-block {
      margin-bottom: 16px;
      border: 1px solid var(--vscode-panel-border, #333);
      border-radius: 6px;
      overflow: hidden;
    }
    .code-header {
      padding: 6px 12px;
      background: var(--vscode-textCodeBlock-background, #2d2d2d);
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground, #888);
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    .code-header-good {
      background: #1b3a1b;
      color: #7ee787;
    }
    pre {
      padding: 16px;
      background: var(--vscode-textCodeBlock-background, #2d2d2d);
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace);
      font-size: 13px;
      line-height: 1.5;
    }
    code { font-family: inherit; }
    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      padding-top: 8px;
      border-top: 1px solid var(--vscode-panel-border, #333);
    }
    .btn {
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      padding: 8px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground, #026ec1); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #313131);
      color: var(--vscode-button-secondaryForeground, #ccc);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #3c3c3c); }
    .footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid var(--vscode-panel-border, #333);
      font-size: 12px;
    }
    .footer a {
      color: var(--vscode-textLink-foreground, #4da6ff);
      cursor: pointer;
    }
    a { color: var(--vscode-textLink-foreground, #4da6ff); }
  `;
}

/**
 * Get the severity level for a smell type.
 */
function getSmellSeverity(smellType: string): string {
  const critical: string[] = ['brain_method', 'god_class', 'shotgun_surgery'];
  const error: string[] = ['deep_nesting', 'complex_conditional', 'duplicated_code', 'high_cyclomatic_complexity'];
  if (critical.includes(smellType)) return 'critical';
  if (error.includes(smellType)) return 'error';
  return 'warning';
}

/**
 * Get the severity display label.
 */
function getSeverityLabel(smellType: string): string {
  const sev = getSmellSeverity(smellType);
  switch (sev) {
    case 'critical': return '🔴 Critical';
    case 'error': return '🟡 Warning';
    default: return '🔵 Info';
  }
}

/**
 * Get the description for a code smell.
 */
function getSmellDescription(smellType: string): string {
  const descriptions: Record<string, string> = {
    deep_nesting:
      'Deep nesting occurs when control structures (if, for, switch) are nested more than 3-4 levels deep. ' +
      'This makes the code hard to read, understand, and maintain. Each level of nesting adds cognitive load ' +
      'for the reader who must track multiple conditions simultaneously.',
    brain_method:
      'A brain method is a function that centralizes too much logic, making it difficult to understand ' +
      'and modify. It typically has high cyclomatic complexity, many local variables, and mixes multiple ' +
      'levels of abstraction.',
    bumpy_road:
      'A bumpy road occurs when code quality varies significantly across a file. Some parts are well-structured ' +
      'while others are messy, making the file unpredictable to work with.',
    complex_conditional:
      'Complex conditionals combine multiple boolean expressions with && and || operators, making it ' +
      'difficult to determine under what conditions each code path executes.',
    god_class:
      'A god class centralizes too much responsibility, typically controlling many other classes. ' +
      'It violates the Single Responsibility Principle and is hard to test, maintain, and extend.',
    long_parameter_list:
      'Functions with more than 3-4 parameters are hard to call correctly. Callers must remember ' +
      'the order and meaning of each parameter, leading to bugs.',
    primitive_obsession:
      'Primitive obsession occurs when primitive types (strings, numbers) are used instead of small ' +
      'domain-specific types. This leads to scattered validation and duplicate logic.',
    duplicated_code:
      'Duplicated code increases maintenance burden: any bug in the duplicated logic must be fixed ' +
      'in every copy. It also indicates missed opportunities for abstraction.',
    long_method:
      'A long method tries to do too much, mixing multiple responsibilities. It is hard to ' +
      'understand, test, and reuse.',
    long_file:
      'Files that exceed 500-1000 lines are hard to navigate and suggest the module needs ' +
      'splitting into smaller, focused units.',
    complex_method:
      'A complex method has high cyclomatic complexity with many branching paths, making it ' +
      'difficult to reason about all possible execution paths.',
    high_cyclomatic_complexity:
      'High cyclomatic complexity indicates many independent paths through the code, making it ' +
      'hard to test all branches and easy to introduce regressions.',
    data_class:
      'A data class is a class that only holds data without behavior. This often indicates ' +
      'anemic domain models where related behavior lives elsewhere.',
    refused_bequest:
      'Refused bequest occurs when a subclass inherits from a parent but doesn\'t use most ' +
      'of its inherited members, suggesting the inheritance hierarchy is wrong.',
    shotgun_surgery:
      'Shotgun surgery means a single change requires modifying many files. This indicates ' +
      'poor separation of concerns and makes changes risky.',
    parallel_inheritance:
      'Parallel inheritance hierarchies occur when adding a class in one hierarchy requires ' +
      'adding a corresponding class in another, creating unnecessary coupling.',
    global_data:
      'Global data (mutable singletons, global variables) makes code behavior unpredictable ' +
      'and hard to test, as any part of the system can modify it.',
    magic_number:
      'Magic numbers are numeric literals with no named constant explaining their meaning. ' +
      'They make code hard to understand and maintain.',
    misplaced_function:
      'A misplaced function lives in a class or module where it doesn\'t belong, using more ' +
      'data from other classes than its own.',
    low_cohesion:
      'Low cohesion means a module\'s elements have little in common. This makes the module ' +
      'hard to understand, maintain, and reuse.',
  };
  return descriptions[smellType] || `A code quality issue of type "${smellType}". Use the refactoring strategy command for guidance.`;
}

/**
 * Get the "why it's harmful" explanation.
 */
function getWhyHarmful(smellType: string): string {
  const harmful: Record<string, string> = {
    deep_nesting:
      'Deep nesting is strongly correlated with higher defect rates. Each additional nesting level ' +
      'increases the chance of overlooking edge cases. Studies show deeply nested code has up to ' +
      '3x more bugs per line than flat code.',
    brain_method:
      'Brain methods are a primary source of technical debt. They\'re difficult to unit test ' +
      '(high complexity means many test cases), risky to modify, and often hide duplicated logic.',
    bumpy_road:
      'Inconsistent code quality makes files unpredictable. Developers spend more time understanding ' +
      'the code than changing it, and mixed-quality files often hide subtle bugs in the messy sections.',
    complex_conditional:
      'Complex boolean expressions are a leading cause of logic bugs. Developers often miss edge ' +
      'cases in the condition itself, leading to incorrect program behavior.',
    god_class:
      'God classes are a maintenance nightmare. They\'re hard to test (too many responsibilities), ' +
      'hard to extend (every change risks breaking unrelated features), and create tight coupling ' +
      'throughout the system.',
    long_parameter_list:
      'Long parameter lists are error-prone — callers frequently mix up parameter order, especially ' +
      'with multiple parameters of the same type. They also indicate the function may have too many responsibilities.',
    primitive_obsession:
      'Using primitives instead of domain types scatters validation logic everywhere, duplicates ' +
      'business rules, and makes the code less self-documenting.',
    duplicated_code:
      'Duplicated code doubles the maintenance cost. Bugs found in one copy must be fixed in every ' +
      'other copy — but they\'re often missed, leading to inconsistent behavior.',
    default:
      'This code smell increases maintenance cost and defect risk. Addressing it now will save ' +
      'significant time compared to fixing bugs later.',
  };
  return harmful[smellType] || harmful.default!;
}

/**
 * Get a "before" code example showing the bad pattern.
 */
function getBeforeExample(smellType: string): string {
  const examples: Record<string, string> = {
    deep_nesting:
      'function process(data) {\n' +
      '  if (data) {\n' +
      '    if (data.items) {\n' +
      '      for (const item of data.items) {\n' +
      '        if (item.active) {\n' +
      '          if (item.value > 0) {\n' +
      '            console.log(item.value);\n' +
      '          }\n' +
      '        }\n' +
      '      }\n' +
      '    }\n' +
      '  }\n' +
      '}',
    brain_method:
      'function processOrder(order) {\n' +
      '  // 200+ lines mixing validation, pricing,\n' +
      '  // inventory, shipping, notifications...\n' +
      '  if (!order) throw new Error("missing");\n' +
      '  // ... 50 lines of validation ...\n' +
      '  const total = order.items\n' +
      '    .reduce((sum, i) => sum + i.price, 0);\n' +
      '  // ... 50 lines of discount logic ...\n' +
      '  const shipping = total > 100 ? 0 : 15;\n' +
      '  // ... 50 more lines ...\n' +
      '}',
    complex_conditional:
      'if ((user.isActive || user.isTrial) &&\n' +
      '    !user.isBanned &&\n' +
      '    (subscription.isValid ||\n' +
      '     (promotion.active &&\n' +
      '      promotion.daysLeft > 0))) {\n' +
      '  grantAccess();\n' +
      '}',
    god_class:
      'class OrderManager {\n' +
      '  validate() { /* 50 lines */ }\n' +
      '  calculatePrice() { /* 40 lines */ }\n' +
      '  applyDiscount() { /* 30 lines */ }\n' +
      '  checkInventory() { /* 40 lines */ }\n' +
      '  ship() { /* 50 lines */ }\n' +
      '  sendEmail() { /* 30 lines */ }\n' +
      '  generateInvoice() { /* 40 lines */ }\n' +
      '  // ... 10 more methods\n' +
      '}',
    long_parameter_list:
      'function createUser(\n' +
      '  name: string,\n' +
      '  email: string,\n' +
      '  role: string,\n' +
      '  department: string,\n' +
      '  managerId: number,\n' +
      '  startDate: Date,\n' +
      '  salary: number,\n' +
      '  isContractor: boolean\n' +
      ') { /* ... */ }',
    default:
      '// Code with this smell detected\n' +
      '// Run the refactoring strategy for\\(\n' +
      '// step-by-step guidance on how to fix it.',
  };
  return examples[smellType] || examples.default!;
}

/**
 * Get an "after" code example showing the fixed pattern.
 */
function getAfterExample(smellType: string): string {
  const examples: Record<string, string> = {
    deep_nesting:
      'function process(data) {\n' +
      '  if (!data?.items) return;\n' +
      '\n' +
      '  for (const item of data.items) {\n' +
      '    if (!item.active || item.value <= 0) continue;\n' +
      '    console.log(item.value);\n' +
      '  }\n' +
      '}',
    brain_method:
      'function processOrder(order) {\n' +
      '  validateOrder(order);\n' +
      '  const pricing = calculatePricing(order);\n' +
      '  const inventory = checkInventory(order);\n' +
      '  const shipment = arrangeShipping(pricing, inventory);\n' +
      '  notifyCustomer(order, shipment);\n' +
      '}\n' +
      '\n' +
      'function validateOrder(order) { /* ... */ }\n' +
      'function calculatePricing(order) { /* ... */ }\n' +
      'function checkInventory(order) { /* ... */ }\n' +
      'function arrangeShipping(p, i) { /* ... */ }\n' +
      'function notifyCustomer(o, s) { /* ... */ }',
    complex_conditional:
      'const canAccess = isActiveUser(user) ||\n' +
      '                  isTrialUser(user);\n' +
      'const notBanned = !user.isBanned;\n' +
      'const hasValidSubscription =\n' +
      '  subscription.isValid ||\n' +
      '  hasActivePromotion(promotion);\n' +
      '\n' +
      'if (canAccess && notBanned && hasValidSubscription) {\n' +
      '  grantAccess();\n' +
      '}',
    god_class:
      'class OrderValidator { validate() { /* ... */ } }\n' +
      'class PricingCalculator { calculate() { /* ... */ } }\n' +
      'class InventoryManager { check() { /* ... */ } }\n' +
      'class ShippingService { arrange() { /* ... */ } }\n' +
      'class NotificationService { send() { /* ... */ } }\n' +
      'class InvoiceGenerator { generate() { /* ... */ } }',
    long_parameter_list:
      'interface CreateUserParams {\n' +
      '  name: string;\n' +
      '  email: string;\n' +
      '  role: string;\n' +
      '  department: string;\n' +
      '  managerId: number;\n' +
      '  startDate: Date;\n' +
      '  salary: number;\n' +
      '  isContractor: boolean;\n' +
      '}\n' +
      '\n' +
      'function createUser(params: CreateUserParams) { /* ... */ }',
    default:
      '// After refactoring:\n' +
      '// Code is cleaner, more maintainable,\n' +
      '// and easier to test.',
  };
  return examples[smellType] || examples.default!;
}

/**
 * Escape HTML entities for safe embedding in code blocks.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format a snake_case smell type into a human-readable name.
 */
function formatSmellName(smellType: string): string {
  return smellType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
