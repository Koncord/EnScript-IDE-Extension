import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

/**
 * Manages diagnostic-related commands
 */
export class DiagnosticsCommands {
    /**
     * Register all diagnostic commands
     */
    public static registerCommands(context: vscode.ExtensionContext, getClient: () => LanguageClient | undefined): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('enscript.dumpDiagnostics', async () => {
                await DiagnosticsCommands.dumpDiagnostics(getClient);
            })
        );
    }

    /**
     * Dump all diagnostics to a JSON document
     */
    private static async dumpDiagnostics(getClient: () => LanguageClient | undefined): Promise<void> {
        const client = getClient();
        const response = await client?.sendRequest('enscript/dumpDiagnostics');

        if (!response) {
            vscode.window.showInformationMessage('No diagnostics returned.');
            return;
        }

        const json = JSON.stringify(response, null, 4); // Pretty-print with 4 spaces

        const doc = await vscode.workspace.openTextDocument({
            language: 'json',
            content: json
        });

        await vscode.window.showTextDocument(doc);
    }
}
