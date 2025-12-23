import * as vscode from 'vscode';
import { LanguageClientManager } from './language-client-manager';
import { WebviewManager } from './webview-manager';
import { DiagnosticsCommands } from './commands/diagnostics-commands';
import { IndexCommands } from './commands/index-commands';
import { ProjectCommands } from './commands/project-commands';
import { ReplCommands } from './commands/repl-commands';
import { IncludePathsManager } from './include-paths-manager';
import { configureDayZTools, showFirstTimeSetup } from './dayz-tools-finder';

import { registerPreprocessorFeatures } from './preprocessor';
import { registerFormatter } from './formatter';
import { EnScriptDebugAdapterDescriptorFactory, EnScriptDebugConfigurationProvider } from './debug/debug-adapter-factory';

let clientManager: LanguageClientManager | undefined;
let includePathsManager: IncludePathsManager | undefined;

export async function activate(context: vscode.ExtensionContext) {

    // Initialize Preprocessor Features (Folding & Rainbow #ifdefs)
    registerPreprocessorFeatures(context);
    // Initialize Formatter
    registerFormatter(context);

    includePathsManager = await IncludePathsManager.initializeAsync(context);

    clientManager = new LanguageClientManager(context);
    await clientManager.start();

    WebviewManager.registerCommands(context);
    IndexCommands.registerCommands(context, () => clientManager?.getClient());
    DiagnosticsCommands.registerCommands(context, () => clientManager?.getClient());
    ProjectCommands.registerCommands(context, () => clientManager?.getClient());
    ReplCommands.registerCommands(context);

    includePathsManager.setClientGetter(() => clientManager?.getClient());

    // Register debug adapter
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(
            'enscript',
            new EnScriptDebugAdapterDescriptorFactory(context)
        )
    );
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('enscript', new EnScriptDebugConfigurationProvider())
    );

    // Listen for include paths updates from LSP server
    const client = clientManager.getClient();
    if (client) {
        client.onNotification('enscript/includePathsUpdated', () => {
            console.log('[Enscript] Include paths updated notification received');
            includePathsManager?.refresh();
        });
    }

    // Register DayZ Tools configuration command
    context.subscriptions.push(
        vscode.commands.registerCommand('enscript.configureDayZTools', async () => {
            await configureDayZTools();
        })
    );

    // Show first-time setup notification (only if workspace is open)
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        // Delay to avoid interfering with extension startup
        setTimeout(() => {
            showFirstTimeSetup();
        }, 2000);
    }
}

export async function deactivate(): Promise<void> {
    if (clientManager) {
        await clientManager.stop();
    }
}
