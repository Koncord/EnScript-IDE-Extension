/**
 * Document Cache Manager
 * 
 * Centralized management of document caches for the language server.
 * Handles parsing with different configurations (regular vs IDE mode) and
 * provides cache statistics and lifecycle management.
 * 
 * Responsibilities:
 * - Manage document AST caches (regular and IDE mode)
 * - Handle document parsing with appropriate configurations
 * - Track parsing errors for diagnostics
 * - Provide cache statistics and health monitoring
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver';
import { FileNode } from '../ast/node-types';
import { parseWithDiagnostics, defaultConfig } from '../parser/parser';
import { createIdeConfig } from '../ast/config';
import { normalizeUri } from '../../util/uri';
import { Logger } from '../../util/logger';
import { postProcessAST } from '../ast/post-processing';
import { IDocumentCacheManager } from './document-cache-interfaces';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/tokens';
import { IPreprocessorConfig } from '../di/preprocessor-config';

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
    /** Number of documents in main cache */
    mainCacheSize: number;
    /** Number of documents in IDE cache */
    ideCacheSize: number;
    /** Number of documents with parsing errors */
    errorCacheSize: number;
    /** Total memory estimate (rough) */
    estimatedMemoryKB: number;
}

/**
 * Parse configuration options
 */
export interface ParseOptions {
    /** Preprocessor definitions to apply */
    preprocessorDefinitions?: string[];
    /** Whether to use IDE configuration (more lenient) */
    useIdeConfig?: boolean;
    /** Force re-parse even if cached */
    forceReparse?: boolean;
    /** Skip parsing function bodies (for external file stubs) */
    skipFunctionBodies?: boolean;
}

/**
 * Manages all document caches and parsing operations
 */
@injectable()
export class DocumentCacheManager implements IDocumentCacheManager {
    /** Main document cache (regular parsing) */
    private docCache = new Map<string, FileNode>();
    
    /** IDE document cache (lenient parsing for better IDE experience) */
    private ideDocCache = new Map<string, FileNode>();
    
    /** Parsing error cache for diagnostics */
    private parseErrorCache = new Map<string, Diagnostic[]>();
    
    /** Callbacks to notify when document caches change */
    private cacheChangeCallbacks: Array<(uri: string) => void> = [];
    
    /** Batch callbacks to notify when multiple documents change at once */
    private batchCacheChangeCallbacks: Array<(uris: Set<string>) => void> = [];
    
    /** Batching mode - suppress callbacks during bulk operations */
    private batchMode = false;
    private batchedUris = new Set<string>();

    constructor(@inject(TYPES.IPreprocessorConfig) private preprocessorConfig: IPreprocessorConfig) {
    }

    /**
     * Register a callback to be notified when document caches change
     * Used for invalidating dependent caches (e.g., type resolver caches)
     */
    public onCacheChange(callback: (uri: string) => void): void {
        this.cacheChangeCallbacks.push(callback);
    }

    /**
     * Register a callback to be notified when multiple documents change at once (batch mode)
     * More efficient than individual callbacks for bulk operations
     */
    public onBatchCacheChange(callback: (uris: Set<string>) => void): void {
        this.batchCacheChangeCallbacks.push(callback);
    }

    /**
     * Notify all registered callbacks that a document cache has changed
     */
    private notifyCacheChange(uri: string): void {
        if (this.batchMode) {
            // In batch mode, collect URIs instead of triggering callbacks
            this.batchedUris.add(uri);
            return;
        }
        
        for (const callback of this.cacheChangeCallbacks) {
            try {
                callback(uri);
            } catch (error) {
                Logger.error(`Error in cache change callback: ${error}`);
            }
        }
    }
    
    /**
     * Start batch mode - suppress callbacks until endBatch() is called
     */
    public startBatch(): void {
        this.batchMode = true;
        this.batchedUris.clear();
    }
    
    /**
     * End batch mode and trigger a single callback with all batched URIs
     */
    public endBatch(): void {
        this.batchMode = false;
        
        if (this.batchedUris.size > 0) {
            Logger.info(`📦 Batch complete: ${this.batchedUris.size} files changed, triggering callbacks...`);
            
            // Require batch callbacks for efficient processing
            if (this.batchCacheChangeCallbacks.length === 0) {
                throw new Error('Batch mode requires at least one batch cache change callback to be registered. Use onBatchCacheChange() to register a callback.');
            }
            
            for (const callback of this.batchCacheChangeCallbacks) {
                try {
                    callback(this.batchedUris);
                } catch (error) {
                    Logger.error(`Error in batch cache change callback: ${error}`);
                }
            }
            
            this.batchedUris.clear();
        }
    }

    // ============================================================================
    // MAIN PARSING INTERFACE
    // ============================================================================

    /**
     * Ensure a document is parsed and cached
     * Uses regular parsing configuration
     * 
     * @param doc The document to parse
     * @param options Optional parse configuration
     * @returns Parsed FileNode AST
     */
    public ensureDocumentParsed(doc: TextDocument, options: ParseOptions = {}): FileNode {
        const uri = normalizeUri(doc.uri);
        
        // Check if we should use existing cache
        if (!options.forceReparse) {
            const cached = this.docCache.get(uri);
            if (cached && cached.version === doc.version) {
                Logger.debug(`📄 Using cached document: ${uri}`);
                return cached;
            }
        }

        // Parse with appropriate configuration
        const config = {
            ...defaultConfig,
            preprocessorDefinitions: new Set(options.preprocessorDefinitions || this.preprocessorConfig.getDefinitions()),
            errorRecovery: true, // Enable error recovery to capture parsing errors
            skipFunctionBodies: options.skipFunctionBodies || false, // Skip bodies for external stubs
            lenientSemicolons: true // Use lenient parsing for SDK files to handle Bohemia's erroneous semicolon misses
        };

        const startTime = performance.now();
        const result = parseWithDiagnostics(doc, config);
        result.file.version = doc.version;
        
        // Post-process AST to add implicit language features
        postProcessAST(result.file, uri);
        
        const endTime = performance.now();

        // Cache the result
        this.docCache.set(uri, result.file);
        
        // Store parsing errors for diagnostics
        this.setParsingErrors(uri, result.diagnostics);
        
        // Notify callbacks that cache has changed
        this.notifyCacheChange(uri);

        Logger.debug(`📄 Parsed document: ${uri} (${(endTime - startTime).toFixed(2)}ms, ${result.diagnostics.length} parsing errors)`);
        if (result.diagnostics.length > 0) {
            Logger.debug(`   Parsing errors: ${JSON.stringify(result.diagnostics.map(d => ({ line: d.range.start.line + 1, message: d.message })))}`);
        }
        
        return result.file;
    }

    /**
     * Ensure a document is parsed with IDE configuration
     * IDE mode is more lenient and provides better error recovery
     * 
     * @param doc The document to parse
     * @param options Optional parse configuration
     * @returns Parsed FileNode AST
     */
    public ensureDocumentParsedForIde(doc: TextDocument, options: ParseOptions = {}): FileNode {
        const uri = normalizeUri(doc.uri);
        
        // Check if we should use existing cache
        if (!options.forceReparse) {
            const cached = this.ideDocCache.get(uri);
            if (cached && cached.version === doc.version) {
                Logger.debug(`📄 Using cached IDE document: ${uri}`);
                return cached;
            }
        }

        // Parse with IDE configuration (includes error recovery)
        const ideConfig = { 
            ...defaultConfig, 
            ...createIdeConfig(),
            errorRecovery: true // Ensure error recovery is enabled
        };
        
        const startTime = performance.now();
        const result = parseWithDiagnostics(doc, ideConfig);
        result.file.version = doc.version;
        
        // Post-process AST to add implicit language features
        postProcessAST(result.file, uri);
        
        const endTime = performance.now();
        
        // Cache in BOTH caches so it can be found by type resolver
        this.ideDocCache.set(uri, result.file);
        this.docCache.set(uri, result.file);
        
        // Store parsing errors for diagnostics
        this.setParsingErrors(uri, result.diagnostics);
        
        // Notify callbacks that cache has changed
        this.notifyCacheChange(uri);
        
        Logger.debug(`📄 Parsed IDE document: ${uri} (${(endTime - startTime).toFixed(2)}ms, ${result.diagnostics.length} parsing errors)`);
        return result.file;
    }

    // ============================================================================
    // CACHE ACCESS METHODS
    // ============================================================================

    /**
     * Get a cached document (from main cache)
     */
    public get(uri: string): FileNode | undefined {
        return this.docCache.get(normalizeUri(uri));
    }

    /**
     * Get a cached document from IDE cache
     */
    public getIdeCache(uri: string): FileNode | undefined {
        return this.ideDocCache.get(normalizeUri(uri));
    }

    /**
     * Check if a document is cached (in main cache)
     */
    public has(uri: string): boolean {
        return this.docCache.has(normalizeUri(uri));
    }

    /**
     * Check if a document is cached in IDE cache
     */
    public hasIdeCache(uri: string): boolean {
        return this.ideDocCache.has(normalizeUri(uri));
    }

    /**
     * Get all entries from main cache
     */
    public entries(): IterableIterator<[string, FileNode]> {
        return this.docCache.entries();
    }

    /**
     * Get all entries from IDE cache
     */
    public ideCacheEntries(): IterableIterator<[string, FileNode]> {
        return this.ideDocCache.entries();
    }

    /**
     * Get the main document cache map (for direct access by components)
     */
    public getDocCache(): Map<string, FileNode> {
        return this.docCache;
    }

    /**
     * Get the IDE document cache map (for direct access by components)
     */
    public getIdeDocCache(): Map<string, FileNode> {
        return this.ideDocCache;
    }

    // ============================================================================
    // ERROR CACHE MANAGEMENT
    // ============================================================================

    /**
     * Store parsing errors for a document
     */
    public setParsingErrors(uri: string, errors: Diagnostic[]): void {
        this.parseErrorCache.set(normalizeUri(uri), errors);
    }

    /**
     * Get parsing errors for a document
     */
    public getParsingErrors(uri: string): Diagnostic[] {
        return this.parseErrorCache.get(normalizeUri(uri)) || [];
    }

    /**
     * Get all parsing errors (all entries)
     */
    public getAllParsingErrors(): IterableIterator<[string, Diagnostic[]]> {
        return this.parseErrorCache.entries();
    }

    /**
     * Get the parsing error cache map (for direct access)
     */
    public getParsingErrorCache(): Map<string, Diagnostic[]> {
        return this.parseErrorCache;
    }

    /**
     * Clear parsing errors for a document
     */
    public clearParsingErrors(uri: string): void {
        this.parseErrorCache.delete(normalizeUri(uri));
    }

    // ============================================================================
    // CACHE LIFECYCLE MANAGEMENT
    // ============================================================================

    /**
     * Remove a document from all caches
     */
    public remove(uri: string): void {
        const normalizedUri = normalizeUri(uri);
        this.docCache.delete(normalizedUri);
        this.ideDocCache.delete(normalizedUri);
        this.parseErrorCache.delete(normalizedUri);
    }

    /**
     * Clear all caches
     */
    public clearAll(): void {
        Logger.info('🧹 Clearing all document caches');
        this.docCache.clear();
        this.ideDocCache.clear();
        this.parseErrorCache.clear();
    }

    /**
     * Clear only the main document cache
     */
    public clearDocCache(): void {
        Logger.info('🧹 Clearing main document cache');
        this.docCache.clear();
    }

    /**
     * Clear only the IDE document cache
     */
    public clearIdeCache(): void {
        Logger.info('🧹 Clearing IDE document cache');
        this.ideDocCache.clear();
    }

    /**
     * Clear only the error cache
     */
    public clearErrorCache(): void {
        Logger.info('🧹 Clearing parsing error cache');
        this.parseErrorCache.clear();
    }

    // ============================================================================
    // STATISTICS & MONITORING
    // ============================================================================

    /**
     * Get cache statistics for monitoring
     */
    public getStats(): CacheStats {
        // Rough estimate: each FileNode is approximately 50KB
        const avgFileSizeKB = 50;
        
        return {
            mainCacheSize: this.docCache.size,
            ideCacheSize: this.ideDocCache.size,
            errorCacheSize: this.parseErrorCache.size,
            estimatedMemoryKB: (this.docCache.size + this.ideDocCache.size) * avgFileSizeKB
        };
    }

    /**
     * Get detailed cache information for debugging
     */
    public getDetailedStats(): {
        mainCache: Array<{ uri: string; version: number }>;
        ideCache: Array<{ uri: string; version: number }>;
        errorCache: Array<{ uri: string; errorCount: number }>;
    } {
        return {
            mainCache: Array.from(this.docCache.entries()).map(([uri, file]) => ({
                uri,
                version: file.version
            })),
            ideCache: Array.from(this.ideDocCache.entries()).map(([uri, file]) => ({
                uri,
                version: file.version
            })),
            errorCache: Array.from(this.parseErrorCache.entries()).map(([uri, errors]) => ({
                uri,
                errorCount: errors.length
            }))
        };
    }

    /**
     * Log cache statistics
     */
    public logStats(): void {
        const stats = this.getStats();
        Logger.info(`📊 Cache Statistics:
  - Main cache: ${stats.mainCacheSize} documents
  - IDE cache: ${stats.ideCacheSize} documents
  - Error cache: ${stats.errorCacheSize} documents
  - Estimated memory: ${stats.estimatedMemoryKB}KB`);
    }
}
