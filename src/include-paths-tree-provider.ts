import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { LanguageClient } from 'vscode-languageclient/node';

/**
 * Tree item representing an include path directory or file
 */
export class IncludePathItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly fullPath: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isDirectory: boolean = true,
        public readonly isRootPath: boolean = false,
        public readonly modName?: string
    ) {
        super(label, collapsibleState);

        if (isDirectory) {
            this.contextValue = isRootPath ? 'includePathRoot' : 'includePathDirectory';
            this.iconPath = isRootPath
                ? new vscode.ThemeIcon('folder-library')
                : new vscode.ThemeIcon('folder');
            
            let tooltipText = isRootPath ? `Include Path: ${fullPath}` : fullPath;
            if (modName) {
                tooltipText += `\nMod: ${modName}`;
            }
            if (isRootPath) {
                tooltipText += '\nClick to reveal in Explorer';
            }
            this.tooltip = tooltipText;

            if (isRootPath) {
                // Show mod name in description if available
                this.description = modName ? `${fullPath} (${modName})` : fullPath;
            }

            // Make the item clickable to reveal in Explorer
            this.command = {
                command: 'revealInExplorer',
                title: 'Reveal in Explorer',
                arguments: [vscode.Uri.file(fullPath)]
            };
        } else {
            // File item
            this.contextValue = 'includePathFile';
            this.iconPath = vscode.ThemeIcon.File;
            this.tooltip = fullPath;
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(fullPath)]
            };
        }

        this.resourceUri = vscode.Uri.file(fullPath);
    }
}

/**
 * Tree data provider for Enscript include paths
 */
export class IncludePathsTreeProvider implements vscode.TreeDataProvider<IncludePathItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<IncludePathItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private includePaths: string[] = [];
    private itemCache = new Map<string, IncludePathItem>();
    private modNamesCache = new Map<string, string | null>();
    private getClient: (() => LanguageClient | undefined) | null = null;

    constructor() {
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('enscript.includePaths')) {
                this.refresh();
            }
        });

        // Load initial include paths
        this.updateIncludePaths();
    }

    /**
     * Set the language client getter for mod name resolution
     */
    setClientGetter(getter: () => LanguageClient | undefined): void {
        this.getClient = getter;
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this.updateIncludePaths().then(() => {
            this.itemCache.clear();
            this.modNamesCache.clear();
            this._onDidChangeTreeData.fire();
        });
    }

    /**
     * Update cached include paths
     */
    private async updateIncludePaths(): Promise<void> {
        const config = vscode.workspace.getConfiguration('enscript');

        const userIncludePaths = config.inspect<string[]>('includePaths')?.globalValue || [];
        const workspaceIncludePaths = config.inspect<string[]>('includePaths')?.workspaceValue || [];
        const configuredPaths = [...new Set([...userIncludePaths, ...workspaceIncludePaths])];
        // Try to get all include paths from LSP server (includes mod paths)
        if (this.getClient) {
            try {
                const client = this.getClient();
                if (client) {
                    const response = await client.sendRequest('enscript/getAllIncludePaths', {});
                    
                    if (response && typeof response === 'object' && 'includePaths' in response) {
                        const result = response as { includePaths: string[] };
                        this.includePaths = result.includePaths;
                        return;
                    }
                }
            } catch (error) {
                console.log('[Include Paths Tree] Failed to get paths from LSP:', error);
                // Fall back to configured paths only
            }
        }

        // Fallback: use only configured paths
        this.includePaths = configuredPaths;
    }

    /**
     * Get mod name for a path
     */
    private async getModNameForPath(includePath: string): Promise<string | null> {
        // Check cache first
        if (this.modNamesCache.has(includePath)) {
            return this.modNamesCache.get(includePath)!;
        }

        // Try to get from language server
        if (this.getClient) {
            try {
                const client = this.getClient();
                if (client) {
                    const response = await client.sendRequest('enscript/getModNamesForPaths', {
                        paths: [includePath]
                    });
                    
                    if (response && typeof response === 'object' && 'paths' in response) {
                        const result = response as { paths: Array<{ path: string; modName: string | null }> };
                        if (result.paths.length > 0) {
                            const modName = result.paths[0].modName;
                            this.modNamesCache.set(includePath, modName);
                            return modName;
                        }
                    }
                }
            } catch {
                // Silently fail - mod names are optional
            }
        }

        this.modNamesCache.set(includePath, null);
        return null;
    }

    /**
     * Get cached item by path (case-insensitive on Windows)
     */
    private getCachedItemByPath(filePath: string): IncludePathItem | undefined {
        const normalizedPath = path.normalize(filePath);

        if (this.itemCache.has(normalizedPath)) {
            return this.itemCache.get(normalizedPath);
        }

        const lowerPath = normalizedPath.toLowerCase();
        for (const [cachedPath, item] of this.itemCache.entries()) {
            if (cachedPath.toLowerCase() === lowerPath) {
                return item;
            }
        }

        return undefined;
    }

    private async getCachedItem(
        label: string,
        fullPath: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        isDirectory: boolean,
        isRootPath: boolean
    ): Promise<IncludePathItem> {
        const normalizedPath = path.normalize(fullPath);

        const existing = this.getCachedItemByPath(normalizedPath);
        if (existing) {
            return existing;
        }

        // Get mod name for root paths
        const modName = isRootPath ? await this.getModNameForPath(normalizedPath) : undefined;

        const item = new IncludePathItem(label, normalizedPath, collapsibleState, isDirectory, isRootPath, modName || undefined);
        this.itemCache.set(normalizedPath, item);
        return item;
    }

    getTreeItem(element: IncludePathItem): vscode.TreeItem {
        return element;
    }

    getParent(element: IncludePathItem): IncludePathItem | undefined {
        const elementPath = path.normalize(element.fullPath);
        const parentPath = path.dirname(elementPath);

        if (parentPath === elementPath) {
            return undefined;
        }

        for (const includePath of this.includePaths) {
            const normalizedIncludePath = path.normalize(includePath);
            if (parentPath.toLowerCase() === normalizedIncludePath.toLowerCase()) {
                // Parent is a root, return it from cache
                return this.getCachedItemByPath(normalizedIncludePath);
            }
        }

        return this.getCachedItemByPath(parentPath);
    }

    async getChildren(element?: IncludePathItem): Promise<IncludePathItem[]> {
        if (!element) {
            return this.getIncludePaths();
        }

        // Return subdirectories and files for expanded directories
        if (element.isDirectory) {
            return this.getDirectoryContents(element.fullPath);
        }

        return [];
    }

    private async getDirectoryContents(dirPath: string): Promise<IncludePathItem[]> {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const items: IncludePathItem[] = [];

            const directories: fs.Dirent[] = [];
            const files: fs.Dirent[] = [];

            const allowedExtensions = ['.c', '.cpp', '.hpp'];

            for (const entry of entries) {
                // Skip hidden files and common build directories
                if (entry.name.startsWith('.') ||
                    entry.name === 'out' ||
                    entry.name === 'build') {
                    continue;
                }

                if (entry.isDirectory()) {
                    directories.push(entry);
                } else if (entry.isFile()) {
                    // Only include files with allowed extensions
                    const ext = path.extname(entry.name).toLowerCase();
                    if (allowedExtensions.includes(ext)) {
                        files.push(entry);
                    }
                }
            }

            directories.sort((a, b) => a.name.localeCompare(b.name));
            for (const dir of directories) {
                const fullPath = path.join(dirPath, dir.name);
                items.push(await this.getCachedItem(
                    dir.name,
                    fullPath,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    true,
                    false
                ));
            }

            files.sort((a, b) => a.name.localeCompare(b.name));
            for (const file of files) {
                const fullPath = path.join(dirPath, file.name);
                items.push(await this.getCachedItem(
                    file.name,
                    fullPath,
                    vscode.TreeItemCollapsibleState.None,
                    false,
                    false
                ));
            }

            return items;
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
            return [];
        }
    }

    /**
     * Get include paths (from LSP + configuration)
     */
    private async getIncludePaths(): Promise<IncludePathItem[]> {
        try {
            // Use cached include paths (already includes LSP paths + configured paths)
            console.log('[Include Paths Tree] Building tree with', this.includePaths.length, 'paths');
            
            const includePaths = this.includePaths
                .filter(p => {
                    // Filter out invalid paths
                    if (!p || typeof p !== 'string') {
                        return false;
                    }
                    try {
                        return fs.existsSync(p);
                    } catch {
                        return false;
                    }
                });

            const items = [];
            for (const includePath of includePaths) {
                const normalizedPath = path.normalize(includePath);
                const label = path.basename(normalizedPath) || normalizedPath;

                items.push(await this.getCachedItem(
                    label,
                    normalizedPath,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    true,
                    true // Mark as root path
                ));
            }
            
            console.log('[Include Paths Tree] Built tree with', items.length, 'root items');
            return items;
        } catch (error) {
            console.error('Error getting include paths:', error);
            return [];
        }
    }

    /**
     * Find and ensure tree item exists for a file URI by loading parent paths
     * Returns the tree item if the file is under an include path
     */
    async findAndLoadTreeItem(fileUri: vscode.Uri): Promise<IncludePathItem | null> {
        const filePath = fileUri.fsPath;
        const normalizedFilePath = path.normalize(filePath);

        // Check if already cached
        const cachedItem = this.getCachedItemByPath(normalizedFilePath);
        if (cachedItem) {
            return cachedItem;
        }

        // Check if file is under any include path (case-insensitive comparison)
        for (const includePath of this.includePaths) {
            const normalizedIncludePath = path.normalize(includePath);

            if (!normalizedFilePath.toLowerCase().startsWith(normalizedIncludePath.toLowerCase())) {
                continue;
            }

            // Build path from root to file and ensure all items are cached
            // Use the actual file system casing for building the path
            const relativePath = path.relative(normalizedIncludePath, normalizedFilePath);
            const pathParts = relativePath.split(path.sep);

            // Ensure root is cached
            await this.getIncludePaths(); // This will cache root paths

            // Load each parent directory to ensure items are cached
            let currentPath = normalizedIncludePath;
            for (let i = 0; i < pathParts.length; i++) {
                const part = pathParts[i];
                const parentPath = currentPath;
                currentPath = path.join(currentPath, part);

                // If not cached, load the parent directory contents
                const cachedCurrent = this.getCachedItemByPath(currentPath);
                if (!cachedCurrent) {
                    // Get parent item
                    let parentItem = this.getCachedItemByPath(parentPath);
                    if (!parentItem) {
                        // Root path - get it from include paths
                        const roots = await this.getChildren();
                        parentItem = roots.find(r =>
                            path.normalize(r.fullPath).toLowerCase() === parentPath.toLowerCase()
                        );
                    }

                    if (parentItem && parentItem.isDirectory) {
                        await this.getChildren(parentItem);
                    }
                }
            }

            return this.getCachedItemByPath(normalizedFilePath) || null;
        }

        return null;
    }
}
