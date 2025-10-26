import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

/**
 * Manages commands related to project dependencies
 */
export class ProjectCommands {
    /**
     * Register all project-related commands
     */
    public static registerCommands(context: vscode.ExtensionContext, getClient: () => LanguageClient | undefined): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('enscript.refreshProjectDependencies', async () => {
                await ProjectCommands.refreshProjectDependencies(getClient);
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('enscript.showDependencyGraph', async () => {
                await ProjectCommands.showDependencyGraph(getClient);
            })
        );
    }

    /**
     * Refresh project dependencies (reload config.cpp and re-scan mods)
     */
    private static async refreshProjectDependencies(getClient: () => LanguageClient | undefined): Promise<void> {
        try {
            // Check if client is ready
            const client = getClient();
            if (!client) {
                vscode.window.showErrorMessage('Language server client is not initialized');
                return;
            }

            vscode.window.showInformationMessage('Refreshing project dependencies...');

            // Send refresh project request to server
            const response = await client.sendRequest('enscript/refreshProject');

            if (response && typeof response === 'object' && 'success' in response) {
                const result = response as { success: boolean; message: string; modCount?: number; diagnosticCount?: number };
                if (result.success) {
                    const modCount = result.modCount || 0;
                    const diagCount = result.diagnosticCount || 0;
                    
                    let message = `Project refreshed: ${modCount} mod(s) loaded`;
                    if (diagCount > 0) {
                        message += ` with ${diagCount} dependency issue(s)`;
                    }
                    
                    vscode.window.showInformationMessage(message);
                } else {
                    vscode.window.showErrorMessage(`Failed to refresh project: ${result.message}`);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh project dependencies: ${error}`);
        }
    }

    /**
     * Show dependency graph in output channel
     */
    private static async showDependencyGraph(getClient: () => LanguageClient | undefined): Promise<void> {
        try {
            // Check if client is ready
            const client = getClient();
            if (!client) {
                vscode.window.showErrorMessage('Language server client is not initialized');
                return;
            }

            // Send get dependency graph request to server
            const response = await client.sendRequest('enscript/getDependencyGraph');

            if (response && typeof response === 'object' && 'success' in response) {
                const result = response as { 
                    success: boolean; 
                    message: string; 
                    graph: Array<{
                        modName: string;
                        modPath: string | null;
                        dependencies: string[];
                        dependents: string[];
                        isLoaded: boolean;
                    }> | null;
                };

                if (result.success && result.graph) {
                    // Create output channel
                    const outputChannel = vscode.window.createOutputChannel('Enscript Dependency Graph');
                    outputChannel.clear();
                    outputChannel.appendLine('='.repeat(80));
                    outputChannel.appendLine('Enscript Project Dependency Graph');
                    outputChannel.appendLine('='.repeat(80));
                    outputChannel.appendLine('');

                    // Sort mods: loaded first, then by name
                    const sortedGraph = result.graph.sort((a, b) => {
                        if (a.isLoaded !== b.isLoaded) {
                            return a.isLoaded ? -1 : 1;
                        }
                        return a.modName.localeCompare(b.modName);
                    });

                    for (const node of sortedGraph) {
                        const status = node.isLoaded ? '✓' : '✗';
                        const statusText = node.isLoaded ? 'LOADED' : 'NOT FOUND';
                        
                        outputChannel.appendLine(`${status} ${node.modName} [${statusText}]`);
                        
                        if (node.modPath) {
                            outputChannel.appendLine(`   Path: ${node.modPath}`);
                        }
                        
                        if (node.dependencies.length > 0) {
                            outputChannel.appendLine(`   Dependencies (${node.dependencies.length}):`);
                            for (const dep of node.dependencies) {
                                const depNode = result.graph.find(n => n.modName === dep);
                                const depStatus = depNode?.isLoaded ? '✓' : '✗';
                                outputChannel.appendLine(`     ${depStatus} ${dep}`);
                            }
                        }
                        
                        if (node.dependents.length > 0) {
                            outputChannel.appendLine(`   Dependents (${node.dependents.length}):`);
                            for (const dependent of node.dependents) {
                                outputChannel.appendLine(`     → ${dependent}`);
                            }
                        }
                        
                        outputChannel.appendLine('');
                    }

                    const loadedCount = sortedGraph.filter(n => n.isLoaded).length;
                    const missingCount = sortedGraph.length - loadedCount;

                    outputChannel.appendLine('='.repeat(80));
                    outputChannel.appendLine(`Summary: ${loadedCount} loaded, ${missingCount} missing`);
                    outputChannel.appendLine('='.repeat(80));

                    outputChannel.show();
                } else {
                    vscode.window.showErrorMessage(result.message || 'Failed to get dependency graph');
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show dependency graph: ${error}`);
        }
    }
}
