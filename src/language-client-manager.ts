import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

/**
 * Manages the Language Server Protocol client and related functionality
 */
export class LanguageClientManager {
    private client: LanguageClient | undefined;
    private statusBarItem: vscode.StatusBarItem;
    private statusBarHideTimeout: NodeJS.Timeout | undefined;

    constructor(private context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        context.subscriptions.push(this.statusBarItem);
    }

    /**
     * Clear any pending status bar hide timeout
     */
    private clearStatusBarTimeout(): void {
        if (this.statusBarHideTimeout) {
            clearTimeout(this.statusBarHideTimeout);
            this.statusBarHideTimeout = undefined;
        }
    }

    /**
     * Schedule the status bar to hide after a delay
     */
    private scheduleStatusBarHide(delayMs: number): void {
        this.clearStatusBarTimeout();
        this.statusBarHideTimeout = setTimeout(() => {
            this.statusBarItem.hide();
            this.statusBarHideTimeout = undefined;
        }, delayMs);
    }

    /**
     * Initialize and start the language client
     */
    public async start(): Promise<void> {
        console.log('[Enscript] Setting up language server');
        // esbuild outputs both extension.js and index.js (server) to the out directory
        const serverModule = path.join(__dirname, 'index.js');
        console.log('[Enscript] Server module path:', serverModule);

        const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

        const serverOptions: ServerOptions = {
            run: { module: serverModule, transport: TransportKind.ipc },
            debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
        };

        console.log('[Enscript] Reading configuration');
        const config = vscode.workspace.getConfiguration('enscript');

        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ language: 'enscript' }],
            synchronize: {
                configurationSection: 'enscript',
                fileEvents: [
                    vscode.workspace.createFileSystemWatcher('**/*.c'),
                    vscode.workspace.createFileSystemWatcher('**/config.cpp')
                ],
            },
            initializationOptions: {
                includePaths: config.get<string[]>('includePaths') || [],
                modRoots: config.get<string[]>('modRoots') || (process.platform === 'win32' ? ['P:\\'] : []),
                logLevel: config.get<string>('logging.level', 'info'),
                diagnostics: {
                    enabled: config.get<boolean>('diagnostics.enabled', true),
                    maxDiagnosticsPerFile: config.get<number>('diagnostics.maxDiagnosticsPerFile', 1000),
                    enableTiming: config.get<boolean>('diagnostics.enableTiming', false),
                    enabledCategories: config.get<string[]>('diagnostics.enabledCategories', ['syntax', 'semantic', 'type', 'style']),
                    globalSeverityOverride: config.get<string>('diagnostics.globalSeverityOverride'),
                    excludePatterns: config.get<string[]>('diagnostics.excludePatterns', []),
                    lenientStubValidation: config.get<boolean>('diagnostics.lenientStubValidation', true),
                    enableExternalTabDiagnostics: config.get<boolean>('diagnostics.enableExternalTabDiagnostics', true),
                    enableExternalPinnedTabDiagnostics: config.get<boolean>('diagnostics.enableExternalPinnedTabDiagnostics', true),
                    rules: config.get<object>('diagnostics.rules', {
                        'unused-typedef': { enabled: true, severity: 'warning' },
                        'undeclared-function': { enabled: true, severity: 'error' },
                        'undeclared-method': { enabled: true, severity: 'error' }
                    })
                }
            },
        };

        console.log('[Enscript] Creating language client');
        this.client = new LanguageClient(
            'EnscriptLS',
            'Enscript Language Server',
            serverOptions,
            clientOptions
        );

        // Start the client
        console.log('[Enscript] Starting language client...');
        await this.client.start();
        console.log('[Enscript] Language client started successfully');
        this.context.subscriptions.push(this.client);

        // Setup notifications after client is started
        this.setupNotifications();
        // Track tab changes to notify server about pinned/active files
        this.setupTabTracking();
    }

    /**
     * Setup notification handlers for the language client
     */
    private setupNotifications(): void {
        if (!this.client) {
            return;
        }

        // Handle indexing notifications from the language server
        this.client.onNotification('enscript/indexing', (params: {
            stage: 'scanning' | 'processing' | 'complete';
            message: string;
            progress?: number;
            total?: number;
            isInitialIndexing?: boolean;
        }) => {
            // Clear any pending hide timeout since we have new status
            this.clearStatusBarTimeout();

            switch (params.stage) {
                case 'scanning':
                    this.statusBarItem.text = `$(search~spin) ${params.message}`;
                    this.statusBarItem.tooltip = 'EnScript Language Server is scanning for source files';
                    this.statusBarItem.show();
                    break;
                case 'processing':
                    if (params.progress !== undefined && params.total !== undefined) {
                        const percentage = Math.round((params.progress / params.total) * 100);
                        this.statusBarItem.text = `$(sync~spin) Indexing EnScript files: ${params.progress}/${params.total} (${percentage}%)`;
                        this.statusBarItem.tooltip = `EnScript Language Server is indexing files for IntelliSense features\nProgress: ${params.progress}/${params.total}`;
                    } else {
                        this.statusBarItem.text = `$(sync~spin) ${params.message}`;
                        this.statusBarItem.tooltip = 'EnScript Language Server is processing files';
                    }
                    this.statusBarItem.show();
                    break;
                case 'complete':
                    const isInitial = params.isInitialIndexing !== false; // default to true if undefined
                    this.statusBarItem.text = `$(check) EnScript ${isInitial ? 'ready' : 're-indexing complete'}`;
                    this.statusBarItem.tooltip = `${params.message}`;
                    this.statusBarItem.show();
                    // Schedule hide after different times depending on whether this is initial or re-indexing
                    this.scheduleStatusBarHide(isInitial ? 5000 : 3000);
                    break;
            }
        });

        // Handle server ready notification
        this.client.onNotification('enscript/ready', (params: { message: string }) => {
            vscode.window.showInformationMessage(params.message);
        });

        // Handle diagnostic progress notifications
        this.client.onNotification('enscript/diagnostics', (params: {
            stage: 'running' | 'complete';
            fileName: string;
            uri: string;
            diagnosticCount?: number;
        }) => {
            // Clear any pending hide timeout since we have new status
            this.clearStatusBarTimeout();

            switch (params.stage) {
                case 'running':
                    this.statusBarItem.text = `$(sync~spin) Analyzing ${params.fileName}`;
                    this.statusBarItem.tooltip = `Running diagnostics for ${params.fileName}`;
                    this.statusBarItem.show();
                    break;
                case 'complete':
                    // Show completion briefly, then hide
                    const count = params.diagnosticCount || 0;
                    const icon = count > 0 ? '$(warning)' : '$(check)';
                    this.statusBarItem.text = `${icon} ${params.fileName}: ${count} issue${count !== 1 ? 's' : ''}`;
                    this.statusBarItem.tooltip = `Diagnostics complete for ${params.fileName}`;
                    this.statusBarItem.show();
                    // Schedule hide after a short time
                    this.scheduleStatusBarHide(1500);
                    break;
            }
        });

        // Handle project loading notifications
        this.client.onNotification('enscript/projectLoading', (params: {
            stage: 'loading' | 'complete' | 'error';
            message: string;
            modCount?: number;
            diagnosticCount?: number;
        }) => {
            // Clear any pending hide timeout since we have new status
            this.clearStatusBarTimeout();

            switch (params.stage) {
                case 'loading':
                    this.statusBarItem.text = `$(sync~spin) ${params.message}`;
                    this.statusBarItem.tooltip = 'EnScript Language Server is loading project dependencies';
                    this.statusBarItem.show();
                    break;
                case 'complete':
                    const _modCount = params.modCount || 0;
                    const diagCount = params.diagnosticCount || 0;
                    const icon = diagCount > 0 ? '$(warning)' : '$(check)';
                    this.statusBarItem.text = `${icon} ${params.message}`;
                    this.statusBarItem.tooltip = diagCount > 0 
                        ? `Project loaded with ${diagCount} dependency issue(s)` 
                        : 'Project loaded successfully';
                    this.statusBarItem.show();
                    // Schedule hide after a short time
                    this.scheduleStatusBarHide(3000);
                    break;
                case 'error':
                    this.statusBarItem.text = `$(error) ${params.message}`;
                    this.statusBarItem.tooltip = 'Project loading failed';
                    this.statusBarItem.show();
                    // Keep error visible longer
                    this.scheduleStatusBarHide(5000);
                    break;
            }
        });
    }

    /**
     * Setup tab tracking to notify server when external files are pinned
     */
    private setupTabTracking(): void {
        if (!this.client) {
            return;
        }

        // Get config
        const config = vscode.workspace.getConfiguration('enscript');
        const enableExternalTabDiagnostics = config.get<boolean>('diagnostics.enableExternalTabDiagnostics', true);
        const enableExternalPinnedTabDiagnostics = config.get<boolean>('diagnostics.enableExternalPinnedTabDiagnostics', true);
        const includePaths = config.get<string[]>('includePaths') || [];

        if (!enableExternalTabDiagnostics && !enableExternalPinnedTabDiagnostics) {
            return; // Both features disabled - never run diagnostics for external files
        }

        // Helper to check if a URI is an external file
        const isExternalFile = (uri: string): boolean => {
            const decodedUri = decodeURIComponent(uri).replace(/\\/g, '/').toLowerCase();
            return includePaths.some((includePath: string) => {
                const normalizedPath = includePath.replace(/\\/g, '/').toLowerCase();
                return decodedUri.includes(normalizedPath);
            });
        };

        // Track tabs that are visible in the tab bar (preview or pinned)
        const visibleTabs = new Map<string, boolean>(); // uri -> isPinned

        // Update the set of visible tabs
        const updateVisibleTabs = () => {
            const currentTabs = new Map<string, boolean>(); // uri -> isPinned

            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    const input = tab.input as { uri?: vscode.Uri };
                    const tabUri = input?.uri?.toString();
                    if (tabUri) {
                        currentTabs.set(tabUri, tab.isPinned);
                    }
                }
            }

            // Check for newly visible tabs or pinning changes
            for (const [uri, isPinned] of currentTabs) {
                if (isExternalFile(uri)) {
                    const wasTracked = visibleTabs.has(uri);
                    const wasPinned = visibleTabs.get(uri);

                    if (!wasTracked) {
                        // New tab - notify server with pinned state
                        this.client?.sendNotification('enscript/tabOpened', { uri, isPinned });
                    } else if (wasPinned !== isPinned) {
                        // Pinned state changed - notify server
                        this.client?.sendNotification('enscript/tabPinnedChanged', { uri, isPinned });
                    }
                }
            }

            // Check for closed tabs
            for (const [uri, _wasPinned] of visibleTabs) {
                if (!currentTabs.has(uri) && isExternalFile(uri)) {
                    // External file tab was closed - notify server
                    this.client?.sendNotification('enscript/tabClosed', { uri });
                }
            }

            visibleTabs.clear();
            for (const [uri, isPinned] of currentTabs) {
                visibleTabs.set(uri, isPinned);
            }
        };

        // Listen for tab changes
        this.context.subscriptions.push(
            vscode.window.tabGroups.onDidChangeTabs(() => {
                updateVisibleTabs();
            })
        );

        // Initialize with current tabs
        updateVisibleTabs();
    }

    /**
     * Get the language client instance
     */
    public getClient(): LanguageClient | undefined {
        return this.client;
    }

    /**
     * Stop the language client
     */
    public async stop(): Promise<void> {
        if (this.client) {
            await this.client.stop();
        }
    }
}
