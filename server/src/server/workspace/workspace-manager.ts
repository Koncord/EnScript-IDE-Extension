/**
 * Workspace Manager
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { IClassDiscovery } from '../analyzer/class-discovery-interfaces';
import { Logger } from '../../util/logger';
import { isClass, isExternalFile, normalizeUri, pathToUri } from '../../util';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/tokens';
import {
    IWorkspaceManager
} from './workspace-interfaces';

import { IDocumentCacheManager } from '../cache/document-cache-interfaces';
import { ITypeResolver } from '../types/type-resolver-interfaces';
import { IPreprocessorConfig } from '../di';

/**
 * Project information structure
 */
export interface ProjectInfo {
    workspaceRoot: string;
    includePaths: string[];
    preprocessorDefinitions: string[];
    cachedDocuments: number;
    ideDocuments: number;
}

/**
 * Project dependency structure
 */
export interface ProjectDependency {
    uri: string;
    type: string;
}

/**
 * Manages workspace configuration and project-level operations
 */
@injectable()
export class WorkspaceManager implements IWorkspaceManager {
    private workspaceRoot = '';
    private includePaths: string[] = [];
    // Track opened documents (unstubbed files)
    private openedDocuments: Set<string> = new Set();
    private _typeResolver: ITypeResolver | null = null;

    constructor(
        @inject(TYPES.IDocumentCacheManager) private cacheManager: IDocumentCacheManager,
        @inject(TYPES.ITypeResolverFactory) private typeResolverFactory: () => ITypeResolver,
        @inject(TYPES.IClassDiscovery) private classDiscovery: IClassDiscovery,
        @inject(TYPES.IPreprocessorConfig) private preprocessorConfig: IPreprocessorConfig
    ) {
        // ITypeResolver injected via factory to break circular dependency with TypeResolver
    }

    /**
     * Get type resolver instance (lazy initialization to break circular dependency)
     * TypeResolver depends on IWorkspaceManager, so we use a factory to defer resolution
     */
    private get typeResolver(): ITypeResolver {
        if (!this._typeResolver) {
            this._typeResolver = this.typeResolverFactory();
        }
        return this._typeResolver;
    }

    // ============================================================================
    // CONFIGURATION MANAGEMENT
    // ============================================================================

    /**
     * Set workspace configuration
     * Updates workspace root, include paths, and preprocessor definitions
     * 
     * @param workspaceRoot Root directory of the workspace
     * @param includePaths Additional paths to search for included files
     * @param preprocessorDefinitions Preprocessor definitions for parsing
     */
    public setWorkspaceConfig(
        workspaceRoot: string, 
        includePaths: string[], 
        preprocessorDefinitions: string[] = []
    ): void {
        Logger.debug(`📁 Setting workspace config - root: "${workspaceRoot}", includePaths: [${includePaths.join(', ')}], preprocessorDefinitions: [${preprocessorDefinitions.join(', ')}]`);

        // Update preprocessor config
        this.preprocessorConfig.setDefinitions(preprocessorDefinitions);
        this.workspaceRoot = workspaceRoot;
        this.includePaths = includePaths;

        Logger.debug(`✅ Workspace config set - stored root: "${this.workspaceRoot}", stored includePaths: [${this.includePaths.join(', ')}], stored preprocessorDefinitions: [${this.preprocessorConfig.getDefinitions().join(', ')}]`);
    }

    /**
     * Get the workspace root directory
     */
    public getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    /**
     * Get the include paths
     */
    public getIncludePaths(): string[] {
        return [...this.includePaths];
    }

    /**
     * Check if a URI belongs to the workspace (vs external include paths)
     * Returns null if unable to determine (no config)
     */
    public isWorkspaceFile(uri: string): boolean | null {
        const normalizedUri = normalizeUri(uri);
        
        // If no workspace root configured, we can't determine
        if (!this.workspaceRoot) {
            return null; // Unknown - can't distinguish
        }
        
        // Convert workspace root path to URI for proper comparison
        const workspaceRootUri = pathToUri(this.workspaceRoot);
        
        // Check if file is under workspace root
        if (normalizedUri.startsWith(workspaceRootUri)) {
            return true; // Definitely workspace
        }
        
        // Check if file is under any include path (external)
        for (const includePath of this.includePaths) {
            const includePathUri = pathToUri(includePath);
            if (normalizedUri.startsWith(includePathUri)) {
                return false; // Definitely external
            }
        }
        
        // File is neither under workspace root nor include paths
        // This could be a file outside both (e.g., opened directly)
        // Default to external to be conservative - don't pollute workspace cache
        return false;
    }

    // ============================================================================
    // PROJECT INFORMATION
    // ============================================================================

    /**
     * Get all script paths (URIs) in the project
     * Returns all documents currently in the cache
     */
    public getProjectScriptPaths(): string[] {
        return Array.from(this.cacheManager.getDocCache().keys());
    }

    /**
     * Get project manager information
     * Returns a summary of project configuration and statistics
     */
    public getProjectManager(): ProjectInfo {
        return {
            workspaceRoot: this.workspaceRoot,
            includePaths: this.includePaths,
            preprocessorDefinitions: this.preprocessorConfig.getDefinitions(),
            cachedDocuments: this.cacheManager.getDocCache().size,
            ideDocuments: this.cacheManager.getIdeDocCache().size
        };
    }

    /**
     * Check if a project file exists
     * Returns true if workspace root is configured
     */
    public hasProjectFile(): boolean {
        return this.workspaceRoot !== '';
    }

    /**
     * Get project config file URI (config.cpp)
     */
    public getProjectConfigUri(): string | null {
        if (!this.workspaceRoot) {
            return null;
        }
        return pathToUri(path.join(this.workspaceRoot, 'config.cpp'));
    }

    // ============================================================================
    // OPENED DOCUMENTS TRACKING (for unstubbing)
    // ============================================================================

    
    /**
     * Mark a document as opened in the editor (unstubbed)
     */
    public markDocumentAsOpened(uri: string): void {
        const normalizedUri = normalizeUri(uri);
        const wasAlreadyOpened = this.openedDocuments.has(normalizedUri);
        this.openedDocuments.add(normalizedUri);
        Logger.debug(`📂 Document marked as opened: ${normalizedUri}`);
        if (!wasAlreadyOpened && isExternalFile(normalizedUri, this.getWorkspaceRoot(), this.getIncludePaths())) {
            this.typeResolver.reindexDocumentSymbols(normalizedUri);
        }
    }

    /**
     * Mark a document as closed (can be stubbed again)
     */
    public markDocumentAsClosed(uri: string): void {
        const normalizedUri = normalizeUri(uri);
        this.openedDocuments.delete(normalizedUri);
        Logger.debug(`📂 Document marked as closed: ${normalizedUri}`);
        
        // If this is an external file (from include paths), re-parse it as a stub
        // so it's available for type resolution again
        if (isExternalFile(normalizedUri, this.getWorkspaceRoot(), this.getIncludePaths())) {
            Logger.debug(`🔄 Re-stubbing closed external file: ${normalizedUri}`);
            // Re-parse the file with stub configuration (without function bodies)
            this.reStubExternalFile(normalizedUri);
            // Invalidate old caches and re-index symbols from the newly stubbed document
            this.typeResolver.invalidateCachesForDocument(normalizedUri);
            this.typeResolver.reindexDocumentSymbols(normalizedUri);
        }
    }

    /**
     * Check if a document is currently opened in the editor
     */
    public isDocumentOpened(uri: string): boolean {
        const normalizedUri = normalizeUri(uri);
        return this.openedDocuments.has(normalizedUri);
    }

    /**
     * Get all opened document URIs
     */
    public getOpenedDocuments(): Set<string> {
        return new Set(this.openedDocuments);
    }



    // ============================================================================
    // CLASS LOADING
    // ============================================================================

    /**
     * Load a class from include paths
     * Searches all cached documents for the specified class
     * 
     * This method actually loads files from disk if they're not already cached.
     * 
     * @param className Name of the class to load
     * @returns Array of class definitions found
     */
    public async loadClassFromIncludePaths(className: string): Promise<Array<{
        className: string;
        uri: string;
        declaration: unknown;
    }>> {
        try {
            // Use ClassDiscovery to actually load the file from include paths
            // This will parse and cache the file if it's not already in the cache
            const filesWereLoaded = await this.classDiscovery.loadClassFromIncludePaths(className, this.includePaths);
            
            // CRITICAL: Only invalidate external caches if new files were actually loaded
            // This avoids unnecessary re-indexing on subsequent calls for the same class
            // We only invalidate EXTERNAL caches since include path files are external,
            // keeping workspace caches intact for better performance
            if (filesWereLoaded) {
                this.typeResolver.invalidateExternalCaches();
            }
            
            // Now search through cached documents for the class
            const results: Array<{
                className: string;
                uri: string;
                declaration: unknown;
            }> = [];

            // Search through all cached documents for the class
            for (const [uri, ast] of this.cacheManager.getDocCache().entries()) {
                for (const decl of ast.body) {
                    if (isClass(decl) && decl.name === className) {
                        results.push({
                            className,
                            uri,
                            declaration: decl
                        });
                    }
                }
            }

            return results;
        } catch (error) {
            Logger.error(`Error loading class ${className}:`, error);
            return [];
        }
    }

    /**
     * Get the class discovery instance
     * Provides access to the class discovery component
     */
    public getClassDiscovery(): IClassDiscovery {
        return this.classDiscovery;
    }

    /**
     * Re-parse an external file as a stub (without function bodies)
     * Called when an external file is closed in the editor
     * 
     * @param uri The URI of the file to re-stub
     */
    public reStubExternalFile(uri: string): void {
        try {
            // Read the file from disk
            const filePath = uri.startsWith('file:///') ? fileURLToPath(uri) : uri;
            if (!fs.existsSync(filePath)) {
                Logger.warn(`Cannot re-stub file - does not exist: ${filePath}`);
                return;
            }
            
            const content = fs.readFileSync(filePath, 'utf-8');
            const doc = TextDocument.create(uri, 'enscript', 1, content);
            
            // Parse with stub configuration (skip function bodies for performance)
            this.cacheManager.ensureDocumentParsed(doc, {
                forceReparse: true,
                preprocessorDefinitions: this.preprocessorConfig.getDefinitions(),
                skipFunctionBodies: true
            });
            
            Logger.debug(`✅ Re-stubbed external file: ${uri}`);
        } catch (error) {
            Logger.error(`Error re-stubbing external file ${uri}:`, error);
        }
    }

    // ============================================================================
    // STATISTICS
    // ============================================================================

    /**
     * Get workspace statistics
     */
    public getStatistics(): {
        workspaceRoot: string;
        includePaths: number;
        preprocessorDefinitions: number;
        cachedDocuments: number;
        totalClasses: number;
    } {
        let totalClasses = 0;
        
        // Count all classes in cached documents
        for (const ast of this.cacheManager.getDocCache().values()) {
            totalClasses += ast.body.filter(isClass).length;
        }

        return {
            workspaceRoot: this.workspaceRoot,
            includePaths: this.includePaths.length,
            preprocessorDefinitions: this.preprocessorConfig.getDefinitions().length,
            cachedDocuments: this.cacheManager.getDocCache().size,
            totalClasses
        };
    }

    /**
     * Log workspace statistics
     */
    public logStatistics(): void {
        const stats = this.getStatistics();
        Logger.info(`📊 Workspace Statistics:
  - Workspace Root: ${stats.workspaceRoot || '(not set)'}
  - Include Paths: ${stats.includePaths}
  - Preprocessor Definitions: ${stats.preprocessorDefinitions}
  - Cached Documents: ${stats.cachedDocuments}
  - Total Classes: ${stats.totalClasses}`);
    }
}
