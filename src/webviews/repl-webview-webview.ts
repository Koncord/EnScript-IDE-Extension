import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getNonce } from '../util';

/**
 * Manages the REPL webview panel for interactive code execution
 * Uses a side-by-side layout with a real editor (with LSP support) and a control panel
 */
export class ReplWebviewManager {
    private static currentPanel: vscode.WebviewPanel | undefined;
    private static replDocument: vscode.TextDocument | undefined;
    private static replEditor: vscode.TextEditor | undefined;
    private static defaultContent = '// EnScript REPL - Edit code here\n// Press Execute button or use command to run\n\nPrint("Hello World");';

    private static context: vscode.ExtensionContext;

    /**
     * Show or focus the REPL panel
     */
    public static async show(context: vscode.ExtensionContext): Promise<void> {
        ReplWebviewManager.context = context;
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
                retainContextWhenHidden: false, // Avoid using this unless absolutely necessary
                localResourceRoots: []
            }
        );

        ReplWebviewManager.currentPanel = panel;
        panel.webview.html = ReplWebviewManager.getHtmlContent(panel.webview);

        // Handle messages from webview
        const messageDisposable = panel.webview.onDidReceiveMessage(
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
            }
        );
        context.subscriptions.push(messageDisposable);

        // Clean up when panel is closed
        panel.onDidDispose(
            () => {
                ReplWebviewManager.currentPanel = undefined;
                messageDisposable.dispose();
                // Note: Closing the editor will prompt for save if document is dirty
                // This is VS Code's default behavior for untitled documents
            }
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
        context.subscriptions.push(
            vscode.debug.onDidChangeActiveDebugSession((_session) => {
                ReplWebviewManager.updateConnectionStatus();
            })
        );

        // Also listen for when debugging starts/stops
        context.subscriptions.push(
            vscode.debug.onDidStartDebugSession((_session) => {
                ReplWebviewManager.updateConnectionStatus();
            })
        );

        context.subscriptions.push(
            vscode.debug.onDidTerminateDebugSession((_session) => {
                ReplWebviewManager.updateConnectionStatus();
            })
        );
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
    private static getHtmlContent(webview: vscode.Webview): string {
        const nonce = getNonce();

        // Get URIs for resources
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            ReplWebviewManager.context.extensionUri, 'media', 'repl', 'script.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            ReplWebviewManager.context.extensionUri, 'media', 'repl', 'style.css'));

        const templatePath = path.join(ReplWebviewManager.context.extensionPath, 'media', 'repl', 'index.html');
        const template = fs.readFileSync(templatePath, 'utf8');
        
        return template
            .replace(/{{cspSource}}/g, webview.cspSource)
            .replace(/{{cspNonce}}/g, `'nonce-${nonce}'`)
            .replace(/{{nonce}}/g, nonce)
            .replace(/{{scriptUri}}/g, scriptUri.toString())
            .replace(/{{styleUri}}/g, styleUri.toString());
    }
}

