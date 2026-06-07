/**
 * Webview refactoring suggestion HTML — displays actionable refactoring
 * guidance with Apply/Copy/Reject buttons.
 *
 * Uses @vscode/webview-ui-toolkit components for VS Code-native UI
 * (Feature 5: @vscode/elements).
 *
 * Inspired by CodeScene's refactoring-components.ts and the refactoring
 * presentation pattern in CodeSceneTabPanel.
 */

import * as vscode from 'vscode';
import { getStyles } from './content';

/**
 * Get the webview URI for the toolkit module.
 */
function getToolkitUri(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const toolkitUri = vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js');
  return webview.asWebviewUri(toolkitUri).toString();
}

/**
 * Build the full HTML for the refactoring suggestion page.
 *
 * @param smellType The code smell type
 * @param filePath Absolute path to the file
 * @param line Line number of the issue
 * @param webview The webview instance
 * @param extensionUri The extension URI
 * @returns Complete HTML document string
 */
export function buildRefactoringHtml(
  smellType: string,
  filePath: string,
  line: number,
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const smellName = formatSmellName(smellType);
  const relativePath = getRelativePath(filePath);
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
    ${getRefactoringStyles()}
  </style>
</head>
<body>
  <header class="header">
    <h1>🔧 Refactoring: ${smellName}</h1>
    <p class="file-location">
      <span class="codicon codicon-file"></span>
      ${escapeHtml(relativePath)}:${line}
    </p>
  </header>

  <vscode-panels>
    <vscode-panel-tab id="tab-strategy">📋 Suggested Approach</vscode-panel-tab>
    <vscode-panel-tab id="tab-examples">🔄 Before / After</vscode-panel-tab>

    <vscode-panel-view id="view-strategy">
      <section class="section">
        <div class="strategy-steps">
          ${getRefactoringSteps(smellType)}
        </div>
      </section>
    </vscode-panel-view>

    <vscode-panel-view id="view-examples">
      <section class="section">
        <div class="code-block">
          <div class="code-header">❌ Before</div>
          <pre><code>${escapeHtml(getBeforeExample(smellType))}</code></pre>
        </div>
        <div class="code-block">
          <div class="code-header code-header-good">✅ After</div>
          <pre><code>${escapeHtml(getAfterExample(smellType))}</code></pre>
        </div>
      </section>
    </vscode-panel-view>
  </vscode-panels>

  <div id="stale-warning" style="display:none;padding:8px;background:var(--vscode-inputValidation-warningBackground);margin-top:12px;border-radius:4px"></div>

  <section class="section actions" style="margin-top:16px;display:flex;flex-direction:column;gap:8px;">
    <vscode-button appearance="primary" onclick="getStrategy()">
      🔧 Get Full Strategy
    </vscode-button>
    <div style="display:flex;gap:8px;">
      <vscode-button appearance="secondary" onclick="copyCode()">
        📋 Copy Example
      </vscode-button>
      <vscode-button appearance="secondary" onclick="closePanel()">
        ✕ Close
      </vscode-button>
    </div>
  </section>

  <footer class="footer">
    <p>Refactoring suggestions are guidelines — apply with judgement for your specific context.</p>
  </footer>

  <script>
    const vscode = acquireVsCodeApi();
    function getStrategy() {
      vscode.postMessage({
        type: 'getStrategy',
        smell: '${smellType}',
        filePath: '${escapeHtml(filePath)}',
        line: ${line}
      });
    }
    function copyCode() {
      vscode.postMessage({
        type: 'copyCode',
        code: \`${escapeHtml(getAfterExample(smellType)).replace(/`/g, '\\`')}\`
      });
    }
    function closePanel() {
      vscode.postMessage({ type: 'close' });
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
 * Get the refactoring steps HTML for a given smell type.
 */
function getRefactoringSteps(smellType: string): string {
  const steps: Record<string, string[]> = {
    deep_nesting: [
      'Use Early Returns / Guard Clauses — exit early when preconditions aren\'t met, rather than wrapping everything in if-blocks.',
      'Extract Nested Condition Bodies — pull deeply nested code into separate well-named functions.',
      'Use continue/break in Loops — flatten loop bodies by skipping iterations early with continue rather than nesting.',
      'Combine Conditions — merge related conditions with && / || where the combined expression is still readable.',
      'Consider extracting the entire nested block into its own function if it represents a distinct operation.',
    ],
    brain_method: [
      'Identify distinct responsibilities — highlight groups of related code that could form separate functions.',
      'Extract Method for each responsibility, naming the new function after what it does.',
      'Replace temporary variables with function calls to make data flow explicit.',
      'Break down complex conditionals into boolean-returning helper functions.',
      'Verify: each extracted function should do ONE thing and be testable independently.',
    ],
    complex_conditional: [
      'Extract each sub-condition into a well-named boolean variable or helper function.',
      'Combine related conditions using descriptive names (e.g., isEligibleForDiscount).',
      'Consider using a switch/table-driven approach for complex multi-way conditions.',
      'Move business-rule conditions into the domain model (e.g., user.canAccess()).',
    ],
    god_class: [
      'Identify distinct responsibilities — list every distinct operation the class performs.',
      'Apply Extract Class for each cohesive group of methods and fields.',
      'Use the Facade pattern if the class delegates to extracted classes while maintaining the API.',
      'Extract interfaces for the new classes to enable testing and substitution.',
    ],
    long_parameter_list: [
      'Introduce Parameter Object — group related parameters into a single object/struct.',
      'Identify parameters that can be derived from others and remove them.',
      'Consider splitting the function if parameters represent different responsibilities.',
      'Use builder pattern for optional parameters.',
    ],
    duplicated_code: [
      'Identify the common pattern — what varies between the duplicates?',
      'Extract the common code into a shared function with parameters for what varies.',
      'If the duplication is structural (similar classes), consider Template Method pattern.',
      'For near-identical code with minor differences, add a parameter for the varying part.',
    ],
  };

  const defaultSteps = [
    'Review the specific code smell and identify the root cause.',
    'Break down the affected code into smaller, focused units.',
    'Apply the appropriate refactoring technique (Extract Method, Rename, etc.).',
    'Verify the refactored code still produces the same output.',
    'Run tests to ensure no regressions were introduced.',
  ];

  const stepsForSmell = steps[smellType] || defaultSteps;
  return stepsForSmell.map((step, i) =>
    `<div class="step">
      <span class="step-number">${i + 1}</span>
      <span class="step-text">${step}</span>
    </div>`
  ).join('\n');
}

/**
 * Get the "before" example for display in the refactoring panel.
 */
function getBeforeExample(smellType: string): string {
  const before = _getBeforeExample(smellType);
  return before;
}

/**
 * Get the "after" example for display in the refactoring panel.
 */
function getAfterExample(smellType: string): string {
  const after = _getAfterExample(smellType);
  return after;
}

/**
 * Get refactoring-specific styles.
 */
function getRefactoringStyles(): string {
  return `
    .file-location {
      font-size: 13px;
      color: var(--vscode-descriptionForeground, #888);
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
    }
    .strategy-steps {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .step {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 8px 12px;
      background: var(--vscode-textCodeBlock-background, #2d2d2d);
      border-radius: 6px;
      border-left: 3px solid var(--vscode-textLink-foreground, #4da6ff);
    }
    .step-number {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .step-text {
      line-height: 1.5;
      font-size: 13px;
    }
    .btn-danger {
      background: #f85149;
      color: #fff;
    }
    .btn-danger:hover { background: #da3633; }
  `;
}

/**
 * Get the "before" code examples (shared with content.ts).
 */
function _getBeforeExample(smellType: string): string {
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
      '  // ...\n' +
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
      '// Code smell detected — run refactoring strategy for guidance',
  };
  return examples[smellType] || examples.default!;
}

/**
 * Get the "after" code examples (shared with content.ts).
 */
function _getAfterExample(smellType: string): string {
  const examples: Record<string, string> = {
    deep_nesting:
      'function process(data) {\n' +
      '  if (!data?.items) return;\n' +
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
      '}',
    complex_conditional:
      'const canAccess = isActiveUser(user) || isTrialUser(user);\n' +
      'const notBanned = !user.isBanned;\n' +
      'const hasValidSubscription = subscription.isValid || hasActivePromotion(promotion);\n' +
      'if (canAccess && notBanned && hasValidSubscription) {\n' +
      '  grantAccess();\n' +
      '}',
    god_class:
      'class OrderValidator { validate() { /* ... */ } }\n' +
      'class PricingCalculator { calculate() { /* ... */ } }\n' +
      'class ShippingService { arrange() { /* ... */ } }\n' +
      'class NotificationService { send() { /* ... */ } }',
    long_parameter_list:
      'interface CreateUserParams {\n' +
      '  name: string; email: string; role: string;\n' +
      '  department: string; managerId: number;\n' +
      '  startDate: Date; salary: number;\n' +
      '  isContractor: boolean;\n' +
      '}\n' +
      'function createUser(params: CreateUserParams) { /* ... */ }',
    default:
      '// After refactoring — cleaner, more maintainable',
  };
  return examples[smellType] || examples.default!;
}

/**
 * Escape HTML entities.
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
 * Format snake_case to human-readable.
 */
function formatSmellName(smellType: string): string {
  return smellType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get relative path for display.
 */
function getRelativePath(filePath: string): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const root = workspaceFolders[0].uri.fsPath;
    if (filePath.startsWith(root)) {
      return filePath.substring(root.length + 1);
    }
  }
  return filePath;
}


