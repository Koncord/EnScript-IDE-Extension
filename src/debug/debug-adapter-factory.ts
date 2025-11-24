import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Factory for creating EnScript debug adapters
 */
export class EnScriptDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    constructor(private readonly context: vscode.ExtensionContext) {}

    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
        _executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        // Use separate process debug adapter (cleaner architecture)
        const debugAdapterPath = path.join(
            this.context.extensionPath,
            'out',
            'debug-adapter.js'
        );

        return new vscode.DebugAdapterExecutable('node', [debugAdapterPath]);
    }
}

/**
 * Provides initial debug configurations
 */
export class EnScriptDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        _token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        // If launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'enscript') {
                config.type = 'enscript';
                config.name = 'Attach to DayZ';
                config.request = 'attach';
                config.ports = [1000, 1001];
            }
        }

        if (!config.ports) {
            config.ports = [1000, 1001];
        }

        // Pass workspace root to debug adapter
        if (_folder) {
            config.workspaceRoot = _folder.uri.fsPath;
        }

        return config;
    }
}
