import * as vscode from 'vscode';
import { IncludePathsTreeProvider, IncludePathItem } from './include-paths-tree-provider';
import { LanguageClient } from 'vscode-languageclient/node';

/**
 * Manages the include paths tree view and related commands
 */
export class IncludePathsManager {
    private treeProvider: IncludePathsTreeProvider;
    private treeView: vscode.TreeView<IncludePathItem>;

    constructor(private context: vscode.ExtensionContext) {
        this.treeProvider = new IncludePathsTreeProvider();
        this.treeView = vscode.window.createTreeView('enscriptIncludePaths', {
            treeDataProvider: this.treeProvider,
            showCollapseAll: true
        });

        context.subscriptions.push(this.treeView);

        // Listen for active editor changes to reveal files in tree
        this.setupActiveEditorListener();

        // Reveal currently active editor if any
        this.revealCurrentEditor();
    }

    /**
     * Set the language client getter for mod name resolution
     */
    public setClientGetter(getter: () => LanguageClient | undefined): void {
        this.treeProvider.setClientGetter(getter);
    }

    /**
     * Refresh the tree view
     */
    public refresh(): void {
        this.treeProvider.refresh();
    }

    /**
     * Setup listener for active editor changes to reveal files in tree
     */
    private setupActiveEditorListener(): void {
        this.context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(async (editor) => {
                if (editor && editor.document) {
                    await this.revealFileInTree(editor.document.uri);
                }
            })
        );
    }

    /**
     * Reveal the currently active editor in the tree view
     */
    private async revealCurrentEditor(): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document) {
            console.log('[Include Paths] Revealing currently active editor on startup');
            await this.revealFileInTree(activeEditor.document.uri);
        }
    }

    /**
     * Reveal a file in the include paths tree view
     */
    public async revealFileInTree(fileUri: vscode.Uri): Promise<void> {
        try {
            if (fileUri.scheme !== 'file') {
                return;
            }

            console.log('[Include Paths] Attempting to reveal file:', fileUri.fsPath);

            // Find and load the tree item (this will ensure parent paths are expanded)
            const fileItem = await this.treeProvider.findAndLoadTreeItem(fileUri);

            if (fileItem) {
                console.log('[Include Paths] Found item, revealing...');
                await this.treeView.reveal(fileItem, {
                    select: true,
                    focus: false,
                    expand: true
                });
                console.log('[Include Paths] File revealed successfully');
            } else {
                console.log('[Include Paths] File is not under any configured include path');
            }
        } catch (error) {
            console.log('[Include Paths] Error revealing file:', error);
        }
    }

    /**
     * Register all include paths related commands
     */
    public registerCommands(): void {
        // Register add include path command
        this.context.subscriptions.push(
            vscode.commands.registerCommand('enscript.addIncludePath', async () => {
                const result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: 'Add Include Path',
                    title: 'Select Enscript Include Path'
                });

                if (result && result.length > 0) {
                    const selectedPath = result[0].fsPath;
                    const config = vscode.workspace.getConfiguration('enscript');
                    const currentPaths = config.get<string[]>('includePaths', []);

                    const pathExists = currentPaths.some(p =>
                        p.toLowerCase() === selectedPath.toLowerCase()
                    );

                    if (pathExists) {
                        vscode.window.showWarningMessage(`Path already exists: ${selectedPath}`);
                        return;
                    }

                    // Add the new path
                    const newPaths = [...currentPaths, selectedPath];
                    await config.update('includePaths', newPaths, vscode.ConfigurationTarget.Workspace);

                    vscode.window.showInformationMessage(`Added include path: ${selectedPath}`);
                    this.treeProvider.refresh();
                }
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('enscript.refreshIncludePaths', () => {
                this.treeProvider.refresh();
                vscode.window.showInformationMessage('Include paths refreshed');
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('enscript.openIncludePath', async (item: IncludePathItem) => {
                if (item && item.fullPath) {
                    const uri = vscode.Uri.file(item.fullPath);
                    await vscode.commands.executeCommand('revealInExplorer', uri);
                }
            })
        );

        this.context.subscriptions.push(
            vscode.commands.registerCommand('enscript.copyIncludePath', async (item: IncludePathItem) => {
                if (item && item.fullPath) {
                    await vscode.env.clipboard.writeText(item.fullPath);
                    vscode.window.showInformationMessage(`Copied: ${item.fullPath}`);
                }
            })
        );
    }

    public static async initializeAsync(context: vscode.ExtensionContext): Promise<IncludePathsManager> {
        return new Promise((resolve, reject) => {
            setImmediate(() => {
                try {
                    const manager = new IncludePathsManager(context);
                    manager.registerCommands();
                    resolve(manager);
                } catch (error) {
                    console.error('[Enscript] Failed to register Include Paths tree view:', error);
                    reject(error);
                }
            });
        });
    }
}
