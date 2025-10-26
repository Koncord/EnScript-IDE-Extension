import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

/**
 * Manages commands related to server indexing and control
 */
export class IndexCommands {
    /**
     * Register all index-related commands
     */
    public static registerCommands(context: vscode.ExtensionContext, getClient: () => LanguageClient | undefined): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('enscript.restartServer', async () => {
                await IndexCommands.restartServer(getClient);
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('enscript.refreshIndex', async () => {
                await IndexCommands.refreshIndex(getClient);
            })
        );
    }

    /**
     * Restart the language server
     */
    private static async restartServer(getClient: () => LanguageClient | undefined): Promise<void> {
        const client = getClient();
        if (client) {
            await client.restart();
        } else {
            vscode.window.showErrorMessage('Language server client is not initialized');
        }
    }

    /**
     * Force refresh the file index
     */
    private static async refreshIndex(getClient: () => LanguageClient | undefined): Promise<void> {
        try {
            vscode.window.showInformationMessage('EnScript file re-indexing started. Language features remain active during re-indexing.');

            // Check if client is ready
            const client = getClient();
            if (!client) {
                vscode.window.showErrorMessage('Language server client is not initialized');
                return;
            }

            // Send force re-index request to server
            const response = await client.sendRequest('enscript/forceReindex');

            if (response && typeof response === 'object' && 'success' in response) {
                const result = response as { success: boolean; message: string };
                if (result.success) {
                    vscode.window.showInformationMessage('EnScript re-indexing completed successfully.');
                } else {
                    vscode.window.showErrorMessage(`Re-indexing failed: ${result.message}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh index: ${error}`);
        }
    }
}
