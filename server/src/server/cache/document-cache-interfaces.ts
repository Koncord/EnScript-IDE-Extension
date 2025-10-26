import { FileNode } from '../ast/node-types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver';

/**
 * Interface for document caching operations
 * Abstracts the DocumentCacheManager for dependency injection
 */
export interface IDocumentCacheManager {
    /**
     * Get the main document cache
     */
    getDocCache(): Map<string, FileNode>;

    /**
     * Get the IDE document cache
     */
    getIdeDocCache(): Map<string, FileNode>;

    /**
     * Ensure a document is parsed and cached
     */
    ensureDocumentParsed(doc: TextDocument, options?: {
        forceReparse?: boolean;
        preprocessorDefinitions?: string[];
        skipFunctionBodies?: boolean;
    }): FileNode;

    /**
     * Ensure document parsed for IDE mode
     */
    ensureDocumentParsedForIde(doc: TextDocument, options?: {
        preprocessorDefinitions?: string[];
    }): FileNode;

    /**
     * Check if a document is cached
     */
    has(uri: string): boolean;

    /**
     * Get a cached document
     */
    get(uri: string): FileNode | undefined;

    /**
     * Remove a document from cache
     */
    remove(uri: string): void;

    /**
     * Get all cached entries
     */
    entries(): IterableIterator<[string, FileNode]>;

    /**
     * Clear all document caches
     */
    clearAll(): void;

    /**
     * Get cache statistics
     */
    getStats(): {
        mainCacheSize: number;
        ideCacheSize: number;
        errorCacheSize: number;
        estimatedMemoryKB: number;
    };

    /**
     * Get parsing errors for a document
     */
    getParsingErrors(uri: string): Diagnostic[];

    /**
     * Get all parsing errors
     */
    getAllParsingErrors(): IterableIterator<[string, Diagnostic[]]>;

    /**
     * Register a callback to be notified when document caches change
     */
    onCacheChange(callback: (uri: string) => void): void;
}