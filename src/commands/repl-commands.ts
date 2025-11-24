import * as vscode from 'vscode';
import { ReplWebviewManager } from '../repl-webview-manager';

/**
 * Manages REPL-related commands
 */
export class ReplCommands {
    /**
     * Register all REPL commands
     */
    public static registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('enscript.openRepl', () => {
                ReplWebviewManager.show(context);
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('enscript.executeInRepl', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showWarningMessage('No active editor');
                    return;
                }

                const selection = editor.selection;
                const text = selection.isEmpty
                    ? editor.document.getText() // Execute entire file
                    : editor.document.getText(selection); // Execute selection

                if (!text.trim()) {
                    vscode.window.showWarningMessage('No code to execute');
                    return;
                }

                // Open REPL and execute
                ReplWebviewManager.show(context);
                
                // Send code to REPL (via custom request to active debug session)
                const session = vscode.debug.activeDebugSession;
                if (!session || session.type !== 'enscript') {
                    vscode.window.showWarningMessage('No active EnScript debug session. Start debugging first.');
                    return;
                }

                // Default to Mission module
                await session.customRequest('executeReplCode', { 
                    code: text, 
                    module: 'Mission' 
                });
                
                vscode.window.showInformationMessage('Code sent to REPL');
            })
        );
    }
}
