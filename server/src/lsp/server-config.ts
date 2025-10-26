import { InitializeParams } from 'vscode-languageserver/node';
import * as url from 'node:url';
import { globalDiagnosticConfig, DiagnosticConfiguration } from '../server/diagnostics';
import { Logger, LogLevel } from '../util/logger';
import { debugConfig, defaultConfig } from '../server/ast/config';
import { injectable } from 'inversify';
import { VSCodeConfiguration } from '../util';

export interface ServerConfiguration {
    workspaceRoot: string;
    includePaths: string[];
    preprocessorDefinitions: string[];
    modRoots: string[];
    diagnostics?: unknown;
    logLevel?: string;
    enableExternalTabDiagnostics?: boolean;
    enableExternalPinnedTabDiagnostics?: boolean;
}

@injectable()
export class ServerConfigurationManager {
    private config: ServerConfiguration = {
        workspaceRoot: '',
        includePaths: [],
        preprocessorDefinitions: [],
        modRoots: process.platform === 'win32' ? ['P:\\'] : [],
        diagnostics: undefined,
        logLevel: 'info',
        enableExternalTabDiagnostics: true,
        enableExternalPinnedTabDiagnostics: true
    };

    /**
     * Initialize workspace configuration from LSP initialization parameters
     */
    initializeWorkspace(params: InitializeParams): ServerConfiguration {
        Logger.info(`📁 Workspace folders: ${params.workspaceFolders?.length || 0}`);
        Logger.info(`📂 Root URI: ${params.rootUri || '(none)'}`);

        const folders = params.workspaceFolders ?? [];
        Logger.debug('🔍 Processing workspace folders:', folders.map(f => f.uri));

        if (folders.length > 0) {
            this.config.workspaceRoot = url.fileURLToPath(folders[0].uri);
            Logger.info(`✅ Workspace root from folders: "${this.config.workspaceRoot}"`);
        } else if (params.rootUri) {
            this.config.workspaceRoot = url.fileURLToPath(params.rootUri);
            Logger.info(`✅ Workspace root from rootUri: "${this.config.workspaceRoot}"`);
        } else {
            Logger.warn(`❌ No workspace root found!`);
        }

        // Extract diagnostic configuration from initialization options
        if (params.initializationOptions?.diagnostics) {
            this.config.diagnostics = params.initializationOptions.diagnostics;
            Logger.info(`🔧 Diagnostic configuration loaded from initialization options`);

            // Apply diagnostic configuration immediately
            globalDiagnosticConfig.loadFromJSON(this.config.diagnostics as Partial<DiagnosticConfiguration>);
        }

        // Extract log level configuration from initialization options
        if (params.initializationOptions?.logLevel) {
            this.config.logLevel = params.initializationOptions.logLevel;
            Logger.info(`🔧 Log level configuration loaded: ${this.config.logLevel}`);
        }

        // Extract modRoots configuration from initialization options
        if (params.initializationOptions?.modRoots) {
            this.config.modRoots = params.initializationOptions.modRoots;
            Logger.info(`🔧 Mod roots configuration loaded: ${JSON.stringify(this.config.modRoots)}`);
        }

        // Configure logger with the specified log level (or fallback to debug mode for backward compatibility)
        const isDebugMode = params.initializationOptions?.debug === true;
        this.configureLogger(this.config.logLevel || (isDebugMode ? 'debug' : 'info'));

        return this.config;
    }

    /**
     * Update configuration from VS Code settings
     * @param config Configuration from VS Code
     * @returns True if include paths changed, false otherwise
     */
    async updateConfiguration(config: VSCodeConfiguration): Promise<boolean> {
        try {
            // Track if include paths changed
            const oldIncludePaths = [...this.config.includePaths];
            
            this.config.includePaths = config.includePaths || [];
            this.config.preprocessorDefinitions = config.preprocessorDefinitions || [];
            this.config.modRoots = config.modRoots || (process.platform === 'win32' ? ['P:\\'] : []);

            // Handle diagnostic configuration from VS Code settings
            if (config.diagnostics) {
                this.config.diagnostics = config.diagnostics;
                Logger.info(`🔧 Updating diagnostic configuration from VS Code settings`);
                globalDiagnosticConfig.loadFromJSON(config.diagnostics);
                
                // Handle external tab diagnostics settings
                const diagnosticsConfig = config.diagnostics as Record<string, unknown>;
                if (typeof diagnosticsConfig.enableExternalTabDiagnostics === 'boolean') {
                    this.config.enableExternalTabDiagnostics = diagnosticsConfig.enableExternalTabDiagnostics;
                    Logger.info(`🔧 Updated enableExternalTabDiagnostics config: ${this.config.enableExternalTabDiagnostics}`);
                }
                if (typeof diagnosticsConfig.enableExternalPinnedTabDiagnostics === 'boolean') {
                    this.config.enableExternalPinnedTabDiagnostics = diagnosticsConfig.enableExternalPinnedTabDiagnostics;
                    Logger.info(`🔧 Updated enableExternalPinnedTabDiagnostics config: ${this.config.enableExternalPinnedTabDiagnostics}`);
                }
            }

            // Handle log level configuration changes (nested under logging.level)
            if (config.logging?.level !== undefined) {
                this.config.logLevel = config.logging.level;
                Logger.info(`🔧 Log level configuration changed: "${config.logging.level}"`);
                this.configureLogger(config.logging.level);
            }

            // Update analyzer with include paths and preprocessor definitions
            Logger.debug(`🔄 Updating analyzer with include paths: [${this.config.includePaths.join(', ')}]`);
            Logger.debug(`🔄 Updating analyzer with preprocessor definitions: [${this.config.preprocessorDefinitions.join(', ')}]`);
            Logger.debug(`🔄 Updating analyzer with mod roots: [${this.config.modRoots.join(', ')}]`);
            Logger.debug(`🔄 Current workspaceRoot: "${this.config.workspaceRoot}"`);

            this.inferWorkspaceRootIfNeeded();

            const includePathsChanged = JSON.stringify(oldIncludePaths) !== JSON.stringify(this.config.includePaths);
            return includePathsChanged;

        } catch (error) {
            Logger.error(`❌ Failed to update configuration: ${error}`);
            throw error;
        }
    }

    /**
     * Get current configuration
     */
    getConfiguration(): ServerConfiguration {
        return { ...this.config };
    }

    /**
     * Configure Logger based on log level setting
     */
    private configureLogger(logLevel: string): void {
        let level: LogLevel;
        let config = defaultConfig;

        switch (logLevel.toLowerCase()) {
            case 'error':
                level = LogLevel.ERROR;
                break;
            case 'warn':
                level = LogLevel.WARN;
                break;
            case 'debug':
                level = LogLevel.DEBUG;
                config = debugConfig; // Use debug config for debug level
                break;
            case 'info':
            default:
                level = LogLevel.INFO;
                break;
        }

        // Clear manual level override to allow configuration change to take effect
        Logger.clearManualLevel();

        Logger.configure(config, {
            level: level,
            prefix: 'EnScript-LSP'
        });
    }

    /**
     * Infer workspace root from include paths if not set
     */
    private inferWorkspaceRootIfNeeded(): void {
        if (!this.config.workspaceRoot && this.config.includePaths.length > 0) {
            const firstIncludePath = this.config.includePaths[0];
            Logger.warn(`⚠️ No workspace root set, attempting to infer from first include path: "${firstIncludePath}"`);

            // Try to find a reasonable parent directory (remove Scripts folder if present)
            let inferredRoot = firstIncludePath;
            Logger.debug(`🔍 Checking if "${inferredRoot.toLowerCase()}" ends with \\scripts or /scripts`);

            if (inferredRoot.toLowerCase().endsWith('\\scripts') || inferredRoot.toLowerCase().endsWith('/scripts')) {
                inferredRoot = inferredRoot.substring(0, inferredRoot.length - 8); // Remove '\scripts'
                Logger.debug(`🔄 Removed '/scripts' suffix, inferred root: "${inferredRoot}"`);
            } else {
                Logger.debug(`⚠️ Include path does not end with '/scripts', cannot infer workspace root`);
            }

            // Validate that the inferred root is not just a drive letter
            Logger.debug(`🔍 Validating inferred root: length=${inferredRoot.length}, endsWithColon=${inferredRoot.endsWith(':')}`);
            if (inferredRoot && inferredRoot.length > 3 && !inferredRoot.endsWith(':')) {
                this.config.workspaceRoot = inferredRoot;
                Logger.info(`✅ Inferred workspace root: "${this.config.workspaceRoot}"`);
            } else {
                Logger.warn(`⚠️ Cannot infer valid workspace root from "${firstIncludePath}" - leaving empty to skip diagnostics`);
                // Keep workspaceRoot empty to ensure diagnostics are skipped
                this.config.workspaceRoot = '';
            }
        } else {
            Logger.debug(`🔍 No inference needed - workspaceRoot already set or no includePaths available`);
        }
    }
}
