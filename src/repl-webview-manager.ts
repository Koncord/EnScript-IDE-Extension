import * as vscode from 'vscode';

/**
 * Manages the REPL webview panel for interactive code execution
 * Uses a side-by-side layout with a real editor (with LSP support) and a control panel
 */
export class ReplWebviewManager {
    private static currentPanel: vscode.WebviewPanel | undefined;
    private static replDocument: vscode.TextDocument | undefined;
    private static replEditor: vscode.TextEditor | undefined;
    private static defaultContent = '// EnScript REPL - Edit code here\n// Press Execute button or use command to run\n\nPrint("Hello World");';

    /**
     * Show or focus the REPL panel
     */
    public static async show(context: vscode.ExtensionContext): Promise<void> {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If panel already exists, reveal it
        if (ReplWebviewManager.currentPanel) {
            ReplWebviewManager.currentPanel.reveal(column);
            if (ReplWebviewManager.replEditor) {
                await vscode.window.showTextDocument(
                    ReplWebviewManager.replEditor.document,
                    { viewColumn: vscode.ViewColumn.One, preserveFocus: true }
                );
            }
            return;
        }

        // Create or show the REPL editor document with LSP support
        await ReplWebviewManager.createReplEditor();

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            'enscriptRepl',
            '⚡ EnScript REPL Controls',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        ReplWebviewManager.currentPanel = panel;
        panel.webview.html = ReplWebviewManager.getHtmlContent();

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'ready':
                        ReplWebviewManager.updateConnectionStatus();
                        break;
                    case 'execute':
                        // Get code from the editor instead of webview
                        const code = ReplWebviewManager.getReplCode();
                        if (code.trim()) {
                            await ReplWebviewManager.executeCode(code, message.module);
                        } else {
                            ReplWebviewManager.sendMessage({
                                command: 'result',
                                success: false,
                                message: 'No code to execute',
                                timestamp: new Date().toISOString()
                            });
                        }
                        break;
                    case 'clearEditor':
                        if (ReplWebviewManager.replEditor) {
                            const edit = new vscode.WorkspaceEdit();
                            const doc = ReplWebviewManager.replEditor.document;
                            edit.replace(
                                doc.uri,
                                new vscode.Range(0, 0, doc.lineCount, 0),
                                ReplWebviewManager.defaultContent
                            );
                            await vscode.workspace.applyEdit(edit);
                        }
                        break;
                    case 'focusEditor':
                        if (ReplWebviewManager.replEditor) {
                            await vscode.window.showTextDocument(
                                ReplWebviewManager.replEditor.document,
                                { viewColumn: vscode.ViewColumn.One, preserveFocus: false }
                            );
                        }
                        break;
                }
            },
            undefined,
            context.subscriptions
        );

        // Clean up when panel is closed
        panel.onDidDispose(
            () => {
                ReplWebviewManager.currentPanel = undefined;
                // Note: Closing the editor will prompt for save if document is dirty
                // This is VS Code's default behavior for untitled documents
            },
            null,
            context.subscriptions
        );

        // Close panel when REPL editor is closed
        const closeWatcher = vscode.workspace.onDidCloseTextDocument(doc => {
            if (ReplWebviewManager.replDocument && doc === ReplWebviewManager.replDocument) {
                if (ReplWebviewManager.currentPanel) {
                    ReplWebviewManager.currentPanel.dispose();
                }
                ReplWebviewManager.replDocument = undefined;
                ReplWebviewManager.replEditor = undefined;
            }
        });
        context.subscriptions.push(closeWatcher);

        // Update status bar when active debug session changes
        vscode.debug.onDidChangeActiveDebugSession((session) => {
            ReplWebviewManager.updateConnectionStatus();
        }, null, context.subscriptions);

        // Also listen for when debugging starts/stops
        vscode.debug.onDidStartDebugSession((session) => {
            ReplWebviewManager.updateConnectionStatus();
        }, null, context.subscriptions);

        vscode.debug.onDidTerminateDebugSession((session) => {
            ReplWebviewManager.updateConnectionStatus();
        }, null, context.subscriptions);
    }

    /**
     * Create or show the REPL editor document with LSP support
     */
    private static async createReplEditor(): Promise<void> {

        if (!ReplWebviewManager.replDocument) {
            // Create an untitled document with enscript language
            ReplWebviewManager.replDocument = await vscode.workspace.openTextDocument({
                content: ReplWebviewManager.defaultContent,
                language: 'enscript'
            });
        } else {
            // If document exists but is empty, restore default content
            const currentContent = ReplWebviewManager.replDocument.getText().trim();
            if (!currentContent) {
                const edit = new vscode.WorkspaceEdit();
                edit.insert(
                    ReplWebviewManager.replDocument.uri,
                    new vscode.Position(0, 0),
                    ReplWebviewManager.defaultContent
                );
                await vscode.workspace.applyEdit(edit);
            }
        }

        // Show the document in the left column with full LSP support
        ReplWebviewManager.replEditor = await vscode.window.showTextDocument(
            ReplWebviewManager.replDocument,
            {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
                preview: false
            }
        );
    }

    /**
     * Get code from the REPL editor
     */
    private static getReplCode(): string {
        if (!ReplWebviewManager.replEditor) {
            return '';
        }

        const selection = ReplWebviewManager.replEditor.selection;
        if (selection && !selection.isEmpty) {
            // If there's a selection, use that
            return ReplWebviewManager.replEditor.document.getText(selection);
        }

        // Otherwise, use entire document content
        return ReplWebviewManager.replEditor.document.getText();
    }

    /**
     * Execute code through the debug adapter
     */
    private static async executeCode(code: string, module: string): Promise<void> {
        const session = vscode.debug.activeDebugSession;

        if (!session || session.type !== 'enscript') {
            ReplWebviewManager.sendMessage({
                command: 'result',
                success: false,
                message: 'No active EnScript debug session. Start debugging first.',
                timestamp: new Date().toISOString()
            });
            return;
        }

        try {
            // Send custom request to debug adapter
            await session.customRequest('executeReplCode', { code: code.trim(), module });

            // Send success message
            ReplWebviewManager.sendMessage({
                command: 'result',
                success: true,
                message: `Executed on ${module}`,
                code: code,
                module: module,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            ReplWebviewManager.sendMessage({
                command: 'result',
                success: false,
                message: `Error: ${error}`,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Send message to webview
     */
    private static sendMessage(message: unknown): void {
        if (ReplWebviewManager.currentPanel) {
            ReplWebviewManager.currentPanel.webview.postMessage(message);
        } else {
            console.error('[REPL] Cannot send message, no panel');
        }
    }

    /**
     * Update connection status in webview
     */
    private static updateConnectionStatus(): void {
        const session = vscode.debug.activeDebugSession;
        const isConnected = !!(session && session.type === 'enscript');

        ReplWebviewManager.sendMessage({
            command: 'connectionStatus',
            connected: isConnected
        });
    }

    /**
     * Generate HTML content for the webview
     */
    private static getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>EnScript REPL</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* Header */
        .header {
            padding: 12px 16px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 12px;
            flex-shrink: 0;
        }

        .connection-status {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            padding: 4px 10px;
            border-radius: 4px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: var(--vscode-charts-red);
        }

        .status-dot.connected {
            background-color: var(--vscode-charts-green);
        }

        .module-selector {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .module-selector label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        select {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 4px 8px;
            border-radius: 2px;
            font-size: 13px;
            cursor: pointer;
        }

        select:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        /* Main content area */
        .content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* Action buttons */
        .actions {
            padding: 12px 16px;
            background-color: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 8px;
        }

        button {
            padding: 6px 14px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
            font-family: var(--vscode-font-family);
            display: flex;
            align-items: center;
            gap: 6px;
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        /* Output area */
        .output-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .output-header {
            padding: 8px 16px;
            background-color: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .output-content {
            flex: 1;
            overflow-y: auto;
            padding: 12px 16px;
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
            font-size: 13px;
            line-height: 1.6;
        }

        .output-entry {
            margin-bottom: 16px;
            padding: 10px;
            border-radius: 4px;
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            background-color: var(--vscode-textCodeBlock-background);
        }

        .output-entry.success {
            border-left-color: var(--vscode-charts-green);
        }

        .output-entry.error {
            border-left-color: var(--vscode-charts-red);
        }

        .output-meta {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
        }

        .output-module {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-weight: 600;
        }

        .output-code {
            margin-top: 6px;
            padding: 8px;
            background-color: var(--vscode-editor-background);
            border-radius: 3px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .output-message {
            margin-top: 6px;
            font-size: 12px;
        }

        .empty-output {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            text-align: center;
            padding: 40px;
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar {
            width: 10px;
        }

        ::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
        }

        ::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-activeBackground);
            border-radius: 5px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="connection-status">
            <span class="status-dot" id="statusDot"></span>
            <span id="statusText">Disconnected</span>
        </div>
        <div class="module-selector">
            <label for="module">Execute on:</label>
            <select id="module">
                <option value="Mission">Mission</option>
                <option value="World">World</option>
                <option value="Game">Game</option>
                <option value="GameLib">GameLib</option>
                <option value="Core">Core</option>
            </select>
        </div>
    </div>

    <div class="content">
        <div class="actions">
            <button id="executeBtn" title="Execute code (Ctrl+Enter)">
                ▶ Execute
            </button>
            <button id="clearInputBtn" class="secondary" title="Clear input">
                🗑 Clear Input
            </button>
        </div>

        <div class="output-section">
            <div class="output-header">
                <span>📊 Execution History</span>
                <span id="executionCount">0 executions</span>
            </div>
            <div class="output-content" id="outputContent">
                <div class="empty-output">No executions yet. Write code in the editor and click Execute.</div>
            </div>
        </div>
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            const moduleSelect = document.getElementById('module');
            const executeBtn = document.getElementById('executeBtn');
            const focusEditorBtn = document.getElementById('focusEditorBtn');
            const clearInputBtn = document.getElementById('clearInputBtn');
            const outputContent = document.getElementById('outputContent');
            const statusDot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');
            const executionCount = document.getElementById('executionCount');

            let executions = 0;
            let isConnected = false;

            // Execute code from editor
            if (executeBtn) {
                executeBtn.addEventListener('click', executeCode);
            }
            
            function executeCode() {
                if (!isConnected) {
                    addOutputEntry({
                        success: false,
                        message: 'Not connected to DayZ. Start debugging first.',
                        timestamp: new Date().toISOString()
                    });
                    return;
                }

                const module = moduleSelect.value;
                vscode.postMessage({
                    command: 'execute',
                    module: module
                });
            }

            // Focus editor
            if (focusEditorBtn) {
                focusEditorBtn.addEventListener('click', () => {
                    vscode.postMessage({ command: 'focusEditor' });
                });
            }

            // Clear editor
            if (clearInputBtn) {
                clearInputBtn.addEventListener('click', () => {
                    vscode.postMessage({ command: 'clearEditor' });
                });
            }

            // Handle messages from extension
            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.command) {
                    case 'result':
                        addOutputEntry(message);
                        break;
                    case 'connectionStatus':
                        updateConnectionStatus(message.connected);
                        break;
                }
            });

            function addOutputEntry(data) {
            // Remove empty state
            const emptyOutput = outputContent.querySelector('.empty-output');
            if (emptyOutput) {
                emptyOutput.remove();
            }

            const entry = document.createElement('div');
            entry.className = 'output-entry ' + (data.success ? 'success' : 'error');
            
            const time = new Date(data.timestamp).toLocaleTimeString();
            const moduleBadge = data.module ? \`<span class="output-module">\${data.module}</span>\` : '';
            
            entry.innerHTML = \`
                <div class="output-meta">
                    <span>\${time} \${moduleBadge}</span>
                    <span>\${data.success ? '✓ Success' : '✗ Error'}</span>
                </div>
                \${data.code ? \`<div class="output-code">\${escapeHtml(data.code)}</div>\` : ''}
                <div class="output-message">\${escapeHtml(data.message)}</div>
            \`;
            
            outputContent.insertBefore(entry, outputContent.firstChild);
                executions++;
                updateExecutionCount();
            }

            function updateConnectionStatus(connected) {
                isConnected = connected;
                if (statusDot && statusText && executeBtn) {
                    if (connected) {
                        statusDot.classList.add('connected');
                        statusText.textContent = 'Connected to DayZ';
                        executeBtn.disabled = false;
                    } else {
                        statusDot.classList.remove('connected');
                        statusText.textContent = 'Not connected';
                        executeBtn.disabled = true;
                    }
                }
            }

            function updateExecutionCount() {
                if (executionCount) {
                    executionCount.textContent = \`\${executions} execution\${executions !== 1 ? 's' : ''}\`;
                }
            }

            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            // Notify extension that webview is ready and request connection status
            vscode.postMessage({ command: 'ready' });
        })();
    </script>
</body>
</html>`;
    }
}
