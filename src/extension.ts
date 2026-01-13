import * as vscode from 'vscode';
import { LanguageClientManager } from './language-client-manager';
import { DocumentationWebview } from './webviews/documentation-webview';
import { DiagnosticsCommands } from './commands/diagnostics-commands';
import { IndexCommands } from './commands/index-commands';
import { ProjectCommands } from './commands/project-commands';
import { ReplCommands } from './commands/repl-commands';
import { IncludePathsManager } from './include-paths-manager';
import { ImagePreviewWebview } from './webviews/image-preview-webview';
import { ImageSetPreviewProvider } from './webviews/imageset-preview-webview';
import { ModelPreviewWebview } from './webviews/model-preview-webview';
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

    DocumentationWebview.registerCommands(context);
    IndexCommands.registerCommands(context, () => clientManager?.getClient());
    DiagnosticsCommands.registerCommands(context, () => clientManager?.getClient());
    ProjectCommands.registerCommands(context, () => clientManager?.getClient());
    ReplCommands.registerCommands(context);

    // Register image preview for PAA/EDDS files
    context.subscriptions.push(ImagePreviewWebview.register(context));

    // Register imageset preview for .imageset files
    context.subscriptions.push(ImageSetPreviewProvider.register(context));

    // Register model preview for P3D files
    context.subscriptions.push(ModelPreviewWebview.register(context));

    // Register commands to open imageset files
    context.subscriptions.push(
        vscode.commands.registerCommand('enscript.openImageSetPreview', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (targetUri) {
                await vscode.commands.executeCommand('vscode.openWith', targetUri, 'enscript.imagesetPreview', vscode.ViewColumn.Beside);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('enscript.openImageSetPreviewInPlace', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (targetUri) {
                await vscode.commands.executeCommand('vscode.openWith', targetUri, 'enscript.imagesetPreview');
            }
        })
    );

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
            showDiscordInvite(context);
        }, 2000);
    }
}

async function showDiscordInvite(context: vscode.ExtensionContext) {
    const DISCORD_INVITE_SHOWN_KEY = 'enscript.discordInviteShown';
    const hasShownInvite = context.globalState.get<boolean>(DISCORD_INVITE_SHOWN_KEY, false);
    if (!hasShownInvite) {
        const action = await vscode.window.showInformationMessage(
            'Join our Discord community to get help, and stay updated with EnScript IDE!',
            'Join Discord',
            'Later',
            'No Thanks'
        );

        if (action === 'Join Discord') {
            vscode.env.openExternal(vscode.Uri.parse('https://discord.gg/9w7q5hGZXr'));
            await context.globalState.update(DISCORD_INVITE_SHOWN_KEY, true);
        } else if (action === 'No Thanks') {
            await context.globalState.update(DISCORD_INVITE_SHOWN_KEY, true);
        }
    }
}

export async function deactivate(): Promise<void> {
    if (clientManager) {
        await clientManager.stop();
    }
}


