import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { WebviewManager } from '../webview-manager';

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

        context.subscriptions.push(
            vscode.commands.registerCommand('enscript.dumpClasses', async () => {
                await DiagnosticsCommands.dumpClasses(getClient);
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

    /**
     * Dump all indexed classes with multiple display options
     */
    private static async dumpClasses(getClient: () => LanguageClient | undefined): Promise<void> {
        try {
            const client = getClient();
            const response = await client?.sendRequest('enscript/dumpClasses');

            if (!response || typeof response !== 'object') {
                vscode.window.showInformationMessage('No classes found in indexed files.');
                return;
            }

            const classes = response as Record<string, unknown[]>;

            // Count total classes
            let totalClasses = 0;
            for (const classList of Object.values(classes)) {
                totalClasses += classList.length;
            }

            if (totalClasses === 0) {
                vscode.window.showInformationMessage('No classes found in indexed files.');
                return;
            }

            // Show options for how to display the results
            const choice = await vscode.window.showQuickPick([
                {
                    label: '$(json) Show as JSON',
                    detail: 'Display raw JSON data in a new editor tab',
                    value: 'json'
                },
                {
                    label: '$(output) Show in Output Channel',
                    detail: 'Display formatted summary in Output channel',
                    value: 'output'
                },
                {
                    label: '$(browser) Show in Webview',
                    detail: 'Display rich formatted view in a webview panel',
                    value: 'webview'
                }
            ], {
                placeHolder: `Found ${totalClasses} classes in ${Object.keys(classes).length} files. How would you like to view them?`
            });

            if (!choice) return;

            switch (choice.value) {
                case 'json':
                    await DiagnosticsCommands.showClassesAsJson(classes);
                    break;
                case 'output':
                    DiagnosticsCommands.showClassesInOutput(classes, totalClasses);
                    break;
                case 'webview':
                    DiagnosticsCommands.showClassesInWebview(classes, totalClasses);
                    break;
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to dump classes: ${error}`);
        }
    }

    /**
     * Display classes as JSON document
     */
    private static async showClassesAsJson(classes: Record<string, unknown[]>): Promise<void> {
        const json = JSON.stringify(classes, null, 2);
        const doc = await vscode.workspace.openTextDocument({
            language: 'json',
            content: json
        });
        await vscode.window.showTextDocument(doc);
    }

    /**
     * Display classes in output channel
     */
    private static showClassesInOutput(classes: Record<string, unknown[]>, totalClasses: number): void {
        const outputChannel = vscode.window.createOutputChannel('Enscript Class Dump');
        outputChannel.clear();
        outputChannel.appendLine('📋 Enscript Class Dump');
        outputChannel.appendLine('===================');
        outputChannel.appendLine('');

        for (const [fileUri, classList] of Object.entries(classes)) {
            outputChannel.appendLine(`📁 File: ${fileUri}`);
            outputChannel.appendLine(`   Classes: ${classList.length}`);

            for (let i = 0; i < classList.length; i++) {
                const cls = classList[i] as {
                    name: string;
                    base?: { identifier: string };
                    members?: unknown[]
                };
                outputChannel.appendLine(`   ${i + 1}. ${cls.name} (${cls.members?.length || 0} members)`);

                if (cls.base) {
                    outputChannel.appendLine(`      extends ${cls.base.identifier}`);
                }

                if (cls.members && cls.members.length > 0) {
                    for (const member of cls.members) {
                        const memberObj = member as { name: string; type: string | { identifier: string } };
                        const memberType = typeof memberObj.type === 'string' ? memberObj.type :
                            memberObj.type?.identifier || 'unknown';
                        outputChannel.appendLine(`      - ${memberObj.name} (${memberType})`);
                    }
                }
            }
            outputChannel.appendLine('');
        }

        outputChannel.appendLine(`✅ Total classes indexed: ${totalClasses}`);
        outputChannel.show();
    }

    /**
     * Display classes in a webview panel
     */
    private static showClassesInWebview(classes: Record<string, unknown[]>, totalClasses: number): void {
        const panel = vscode.window.createWebviewPanel(
            'classDump',
            'Enscript Class Dump',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = WebviewManager.generateClassDumpHTML(classes, totalClasses);
    }
}
