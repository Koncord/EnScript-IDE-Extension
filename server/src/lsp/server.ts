import {
    createConnection,
    TextDocuments,
    TextDocumentSyncKind,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    ConfigurationItem,
    Connection,
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ServerConfigurationManager } from './server-config';
import { Logger } from '../util/logger';
import { TYPES } from '../server/di';
import { VSCodeConfiguration } from '../util';
import { inject, injectable } from 'inversify';
import { NotificationService } from './services/NotificationService';
import { IIndexerService } from './services/IIndexerService';
import { SERVICE_TYPES } from './services/service-types';
import { IWorkspaceManager } from '../server/workspace/workspace-interfaces';
import { IProjectManager, DependencyDiagnostic } from '../server/project/project-interfaces';
import { Container } from 'inversify';
import { HANDLER_TYPES, IHandlerRegistration } from './handlers/handler-interfaces';
import { INotificationService } from './services/INotificationService';


@injectable()
export class EnscriptLanguageServer {
    private connection: Connection;
    private documents: TextDocuments<TextDocument>;

    constructor(
        @inject(Container) private container: Container,
        @inject(ServerConfigurationManager) private configManager: ServerConfigurationManager,
        @inject(SERVICE_TYPES.INotificationService) private notificationService: INotificationService,
        @inject(SERVICE_TYPES.IIndexerService) private indexerService: IIndexerService,
        @inject(TYPES.IWorkspaceManager) private workspaceManager: IWorkspaceManager,
        @inject(TYPES.IProjectManager) private projectManager: IProjectManager
    ) {
        // Create LSP connection (stdio or Node IPC autodetect)
        this.connection = createConnection(ProposedFeatures.all);

        // Track open documents — in-memory mirror of the client
        this.documents = new TextDocuments(TextDocument);

        // Configure logger to use LSP connection
        Logger.setConnection(this.connection);
        (this.notificationService as NotificationService).setConnection(this.connection);

        this.setupConnectionHandlers();
        this.setupDocumentHandlers();
    }

    /**
     * Set up the LSP connection event handlers
     */
    private setupConnectionHandlers(): void {
        this.connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
            try {
                this.configManager.initializeWorkspace(params);

                // Configure analyzer with workspace path (include paths and preprocessor definitions will be set later)
                Logger.info(`🚀 Initializing analyzer with workspace root: "${this.configManager.getConfiguration().workspaceRoot}"`);
                this.workspaceManager.setWorkspaceConfig(this.configManager.getConfiguration().workspaceRoot, [], []);

                return {
                    capabilities: {
                        textDocumentSync: TextDocumentSyncKind.Incremental,
                        completionProvider: {
                            resolveProvider: false,
                            triggerCharacters: ['.', '>', ':']
                        },
                        definitionProvider: true,
                        hoverProvider: true,
                        referencesProvider: true,
                        renameProvider: true,
                        workspaceSymbolProvider: true,
                        codeActionProvider: true
                    }
                };
            } catch (error) {
                Logger.error(`❌ Failed to initialize server: ${error}`);
                throw error;
            }
        });

        this.connection.onInitialized(async () => {
            try {
                // Register handlers immediately but they will wait for indexing to complete
                const handlers = this.container.getAll<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration);
                for (const handler of handlers) {
                    handler.register(this.connection, this.documents);
                }

                // Mark all currently opened documents as opened (for files that were already open when VSCode started)
                const openedDocs = this.documents.all();
                Logger.info(`📂 Marking ${openedDocs.length} pre-opened document(s) as opened for unstubbing`);
                for (const doc of openedDocs) {
                    this.workspaceManager.markDocumentAsOpened(doc.uri);
                }

                // Start configuration and indexing process
                await this.configManager.updateConfiguration(await this.getVsCodeConfiguration());
                
                // Initialize ProjectManager with modRoots from configuration
                const modRoots = this.configManager.getConfiguration().modRoots;
                await this.projectManager.updateConfiguration(modRoots);
                
                // Load project if config.cpp exists
                if (this.workspaceManager.hasProjectFile()) {
                    try {
                        this.notificationService.sendProjectLoadingNotification({
                            stage: 'loading',
                            message: 'Loading project dependencies...'
                        });
                        
                        await this.projectManager.loadProject();
                        Logger.info(`📦 Project loaded successfully with ${this.projectManager.getMods().size} mod(s)`);
                        
                        // Validate dependencies and log diagnostics
                        const diagnostics = this.projectManager.validateDependencies();
                        if (diagnostics.length > 0) {
                            Logger.warn(`⚠️ Found ${diagnostics.length} dependency issue(s):`);
                            for (const diag of diagnostics) {
                                Logger.warn(`  - [${diag.type}] ${diag.message}`);
                            }
                        }
                        
                        // Publish diagnostics to Problems panel
                        this.publishDependencyDiagnostics(diagnostics);
                        
                        this.notificationService.sendProjectLoadingNotification({
                            stage: 'complete',
                            message: `Project loaded with ${this.projectManager.getMods().size} mod(s)`,
                            modCount: this.projectManager.getMods().size,
                            diagnosticCount: diagnostics.length
                        });
                    } catch (error) {
                        Logger.warn(`⚠️ Failed to load project: ${error}`);
                        this.notificationService.sendProjectLoadingNotification({
                            stage: 'error',
                            message: `Failed to load project: ${error}`
                        });
                        // Clear any previous diagnostics on error
                        const configUri = this.workspaceManager.getProjectConfigUri();
                        if (configUri) {
                            this.connection.sendDiagnostics({ uri: configUri, diagnostics: [] });
                        }
                    }
                } else {
                    // No project file, clear any diagnostics
                    const configUri = this.workspaceManager.getProjectConfigUri();
                    if (configUri) {
                        this.connection.sendDiagnostics({ uri: configUri, diagnostics: [] });
                    }
                }
                
                // Merge mod include paths with configured include paths
                const modIncludePaths = this.projectManager.getModIncludePaths();
                const allIncludePaths = [...this.configManager.getConfiguration().includePaths, ...modIncludePaths];
                Logger.info(`📁 Total include paths: ${allIncludePaths.length} (${this.configManager.getConfiguration().includePaths.length} configured + ${modIncludePaths.length} from mods)`);
                
                this.workspaceManager.setWorkspaceConfig(
                    this.configManager.getConfiguration().workspaceRoot,
                    allIncludePaths,
                    this.configManager.getConfiguration().preprocessorDefinitions
                );
                
                // Notify client that include paths have been updated
                Logger.debug(`Sending includePathsUpdated notification with ${allIncludePaths.length} paths`);
                this.notificationService.sendIncludePathsUpdatedNotification();
                
                await this.indexerService.indexFiles(this.configManager.getConfiguration().workspaceRoot, allIncludePaths);

                // Notify client that the server is fully ready
                this.notificationService.sendLSPReadyNotification();
            } catch (error) {
                Logger.error(`❌ Failed to finalize server configuration: ${error}`);
            }
        });

        // Handle configuration changes
        this.connection.onDidChangeConfiguration(async () => {
            Logger.warn(`🔄 Configuration changed, updating server settings...`);
            const includePathsChanged = await this.configManager.updateConfiguration(await this.getVsCodeConfiguration());

            // Update ProjectManager with new modRoots
            const modRoots = this.configManager.getConfiguration().modRoots;
            await this.projectManager.updateConfiguration(modRoots);

            // Merge mod include paths with configured include paths
            const modIncludePaths = this.projectManager.getModIncludePaths();
            const allIncludePaths = [...this.configManager.getConfiguration().includePaths, ...modIncludePaths];
            
            // Update analyzer configuration
            this.workspaceManager.setWorkspaceConfig(
                this.configManager.getConfiguration().workspaceRoot,
                allIncludePaths,
                this.configManager.getConfiguration().preprocessorDefinitions
            );

            // Notify client that include paths have been updated
            this.notificationService.sendIncludePathsUpdatedNotification();

            if (includePathsChanged) {
                await this.indexerService.indexFiles(this.configManager.getConfiguration().workspaceRoot, allIncludePaths);
                Logger.info('🔄 Re-indexing completed, handlers remain active');
            }
        });

        // Handle force re-index request
        this.connection.onRequest('enscript/forceReindex', async () => {
            try {
                Logger.info('📥 Received force re-index request');
                await this.indexerService.forceReindex();
                // Diagnostics will automatically re-run on next file change
                return { success: true, message: 'Re-indexing completed successfully' };
            } catch (error) {
                Logger.error(`❌ Force re-index failed: ${error}`);
                return { success: false, message: `Re-indexing failed: ${error}` };
            }
        });

        // Handle refresh project request
        this.connection.onRequest('enscript/refreshProject', async () => {
            try {
                Logger.info('📥 Received refresh project request');
                
                this.notificationService.sendProjectLoadingNotification({
                    stage: 'loading',
                    message: 'Refreshing project dependencies...'
                });
                
                await this.projectManager.refresh();
                
                const diagnostics = this.projectManager.validateDependencies();
                const modCount = this.projectManager.getMods().size;
                
                Logger.info(`📦 Project refreshed: ${modCount} mod(s), ${diagnostics.length} issue(s)`);
                
                // Publish diagnostics to Problems panel
                this.publishDependencyDiagnostics(diagnostics);
                
                this.notificationService.sendProjectLoadingNotification({
                    stage: 'complete',
                    message: `Project refreshed with ${modCount} mod(s)`,
                    modCount,
                    diagnosticCount: diagnostics.length
                });
                
                // Update workspace with new mod include paths
                const modIncludePaths = this.projectManager.getModIncludePaths();
                const allIncludePaths = [...this.configManager.getConfiguration().includePaths, ...modIncludePaths];
                
                this.workspaceManager.setWorkspaceConfig(
                    this.configManager.getConfiguration().workspaceRoot,
                    allIncludePaths,
                    this.configManager.getConfiguration().preprocessorDefinitions
                );
                
                // Re-index with updated paths
                await this.indexerService.indexFiles(this.configManager.getConfiguration().workspaceRoot, allIncludePaths);
                
                return { 
                    success: true, 
                    message: 'Project refreshed successfully',
                    modCount,
                    diagnosticCount: diagnostics.length
                };
            } catch (error) {
                Logger.error(`❌ Project refresh failed: ${error}`);
                this.notificationService.sendProjectLoadingNotification({
                    stage: 'error',
                    message: `Failed to refresh project: ${error}`
                });
                return { success: false, message: `Project refresh failed: ${error}` };
            }
        });

        // Handle get dependency graph request
        this.connection.onRequest('enscript/getDependencyGraph', () => {
            try {
                if (!this.projectManager.isLoaded()) {
                    return { 
                        success: false, 
                        message: 'Project not loaded',
                        graph: null
                    };
                }

                const graph = this.projectManager.getDependencyGraph();
                const mods = this.projectManager.getMods();
                
                // Convert graph to serializable format
                const graphData: Array<{
                    modName: string;
                    modPath: string | null;
                    dependencies: string[];
                    dependents: string[];
                    isLoaded: boolean;
                }> = [];

                for (const [modName, node] of graph) {
                    const modInfo = mods.get(modName);
                    graphData.push({
                        modName,
                        modPath: modInfo?.path || null,
                        dependencies: Array.from(node.dependencies),
                        dependents: Array.from(node.dependents),
                        isLoaded: mods.has(modName)
                    });
                }

                return {
                    success: true,
                    message: `Dependency graph with ${graphData.length} mod(s)`,
                    graph: graphData
                };
            } catch (error) {
                Logger.error(`❌ Failed to get dependency graph: ${error}`);
                return { 
                    success: false, 
                    message: `Failed to get dependency graph: ${error}`,
                    graph: null
                };
            }
        });

        // Handle get mod names for include paths request
        this.connection.onRequest('enscript/getModNamesForPaths', (params: { paths: string[] }) => {
            try {
                if (!this.projectManager.isLoaded()) {
                    return { paths: [] };
                }

                const result = params.paths.map(includePath => ({
                    path: includePath,
                    modName: this.projectManager.getModNameByPath(includePath)
                }));

                return { paths: result };
            } catch (error) {
                Logger.error(`❌ Failed to get mod names for paths: ${error}`);
                return { paths: [] };
            }
        });

        // Handle get all include paths request
        this.connection.onRequest('enscript/getAllIncludePaths', () => {
            try {
                const modIncludePaths = this.projectManager.getModIncludePaths();
                const allIncludePaths = [...this.configManager.getConfiguration().includePaths, ...modIncludePaths];
                return { includePaths: allIncludePaths };
            } catch (error) {
                Logger.error(`❌ Failed to get all include paths: ${error}`);
                return { includePaths: [] };
            }
        });

        // Handle file change notifications (for config.cpp watching)
        this.connection.onDidChangeWatchedFiles(async (params) => {
            for (const change of params.changes) {
                // Check if config.cpp was modified or deleted
                if (change.uri.endsWith('config.cpp')) {
                    Logger.info(`📝 config.cpp changed (type: ${change.type}), refreshing project...`);
                    
                    try {
                        this.notificationService.sendProjectLoadingNotification({
                            stage: 'loading',
                            message: 'Reloading project dependencies...'
                        });
                        
                        await this.projectManager.refresh();
                        
                        const diagnostics = this.projectManager.validateDependencies();
                        
                        // Publish diagnostics to Problems panel
                        this.publishDependencyDiagnostics(diagnostics);
                        
                        this.notificationService.sendProjectLoadingNotification({
                            stage: 'complete',
                            message: `Project reloaded with ${this.projectManager.getMods().size} mod(s)`,
                            modCount: this.projectManager.getMods().size,
                            diagnosticCount: diagnostics.length
                        });
                        
                        // Update workspace with new mod include paths
                        const modIncludePaths = this.projectManager.getModIncludePaths();
                        const allIncludePaths = [...this.configManager.getConfiguration().includePaths, ...modIncludePaths];
                        
                        this.workspaceManager.setWorkspaceConfig(
                            this.configManager.getConfiguration().workspaceRoot,
                            allIncludePaths,
                            this.configManager.getConfiguration().preprocessorDefinitions
                        );
                        
                        // Re-index with updated paths
                        await this.indexerService.indexFiles(this.configManager.getConfiguration().workspaceRoot, allIncludePaths);
                        Logger.info('🔄 Project refresh completed');
                    } catch (error) {
                        Logger.error(`❌ Failed to refresh project: ${error}`);
                        this.notificationService.sendProjectLoadingNotification({
                            stage: 'error',
                            message: `Failed to refresh project: ${error}`
                        });
                    }
                }
            }
        });

    }

    /**
     * Set up document event handlers
     */
    private setupDocumentHandlers(): void {
        this.documents.listen(this.connection);

        // Add error handling for unexpected document events
        this.documents.onDidOpen((event) => {
            Logger.info(`📄 Document opened: ${event.document.uri}`);
            this.workspaceManager.markDocumentAsOpened(event.document.uri);
        });

        this.documents.onDidClose((event) => {
            Logger.info(`📄 Document closed: ${event.document.uri}`);
            this.workspaceManager.markDocumentAsClosed(event.document.uri);
        });
    }

    private async getVsCodeConfiguration(): Promise<VSCodeConfiguration> {
        const configItems: ConfigurationItem[] = [
            { section: 'enscript', scopeUri: undefined }
        ];
        const result = await this.connection.workspace.getConfiguration(configItems);
        return result[0] as VSCodeConfiguration;
    }

    /**
     * Publish dependency diagnostics to Problems panel
     */
    private publishDependencyDiagnostics(diagnostics: DependencyDiagnostic[]): void {
        const configUri = this.workspaceManager.getProjectConfigUri();
        if (!configUri) {
            return;
        }

        const lspDiagnostics: Diagnostic[] = diagnostics.map(diag => {
            const severity = diag.type === 'missing' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;
            
            return {
                severity,
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 }
                },
                message: diag.message,
                source: 'enscript-project',
                code: diag.type === 'missing' ? 'missing-dependency' : 'circular-dependency',
                relatedInformation: diag.relatedMods?.map(modName => ({
                    location: {
                        uri: configUri,
                        range: {
                            start: { line: 0, character: 0 },
                            end: { line: 0, character: 0 }
                        }
                    },
                    message: `Related mod: ${modName}`
                }))
            };
        });

        this.connection.sendDiagnostics({ uri: configUri, diagnostics: lspDiagnostics });
        
        if (diagnostics.length > 0) {
            Logger.info(`📊 Published ${diagnostics.length} dependency diagnostic(s) to config.cpp`);
        }
    }

    /**
     * Start listening for LSP messages
     */
    public start(): void {
        // Start listening - handlers will be registered during onInitialized
        this.connection.listen();

        Logger.info('🎯 Enscript LSP Server started and listening...');
    }
}
