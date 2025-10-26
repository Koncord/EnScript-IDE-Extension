/**
 * Workspace Manager Dependency Interfaces
 * 
 * These interfaces decouple WorkspaceManager from concrete analyzer implementations,
 * allowing for better testability and flexibility through dependency injection.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { FileNode } from '../ast/node-types';
import { IClassDiscovery } from '../analyzer/class-discovery-interfaces';

/**
 * Interface for document parsing operations
 * Allows WorkspaceManager to trigger document parsing
 */
export interface IDocumentParser {
    /**
     * Parse a document and return its AST
     */
    (doc: TextDocument): FileNode;
}

/**
 * Interface for checking if a document is cached
 */
export interface IDocumentCacheChecker {
    /**
     * Check if a document is in the cache
     */
    (uri: string): boolean;
}

/**
 * Interface for workspace management operations
 * Abstracts the WorkspaceManager for dependency injection
 */
export interface IWorkspaceManager {
    /**
     * Set workspace configuration
     */
    setWorkspaceConfig(
        workspaceRoot: string,
        includePaths: string[],
        preprocessorDefinitions?: string[]
    ): void;

    /**
     * Get the workspace root directory
     */
    getWorkspaceRoot(): string;

    /**
     * Get the include paths
     */
    getIncludePaths(): string[];

    /**
     * Check if a URI belongs to the workspace (vs external include paths)
     * Returns null if unable to determine (no config)
     */
    isWorkspaceFile(uri: string): boolean | null;

    /**
     * Mark a document as opened in the editor (unstubbed)
     */
    markDocumentAsOpened(uri: string): void;

    /**
     * Mark a document as closed (can be stubbed again)
     */
    markDocumentAsClosed(uri: string): void;

    /**
     * Check if a document is currently opened in the editor
     */
    isDocumentOpened(uri: string): boolean;

    /**
     * Get all opened document URIs
     */
    getOpenedDocuments(): Set<string>;

    /**
     * Load a class from include paths
     */
    loadClassFromIncludePaths(className: string): Promise<Array<{
        className: string;
        uri: string;
        declaration: unknown;
    }>>;

    /**
     * Get the class discovery instance
     */
    getClassDiscovery(): IClassDiscovery;

    /**
     * Check if a project file exists
     */
    hasProjectFile(): boolean;

    /**
     * Get project config file URI (config.cpp)
     */
    getProjectConfigUri(): string | null;

    /**
     * Get all script paths (URIs) in the project
     */
    getProjectScriptPaths(): string[];
}
