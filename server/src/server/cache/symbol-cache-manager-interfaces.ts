/**
 * Symbol Cache Manager Interfaces
 * 
 * Abstraction for the two-tier symbol caching system.
 */

import {
    ClassDeclNode,
    FunctionDeclNode,
    VarDeclNode,
    TypedefDeclNode,
    EnumDeclNode
} from '../ast/node-types';

/**
 * Cache statistics for monitoring
 */
export interface SymbolCacheStats {
    /** Number of unique class names cached in workspace */
    workspaceClasses: number;
    /** Number of unique class names cached in external */
    externalClasses: number;
    /** Number of unique function names cached in workspace */
    workspaceFunctions: number;
    /** Number of unique function names cached in external */
    externalFunctions: number;
    /** Number of unique variable names cached in workspace */
    workspaceVariables: number;
    /** Number of unique variable names cached in external */
    externalVariables: number;
    /** Number of unique typedef names cached in workspace */
    workspaceTypedefs: number;
    /** Number of unique typedef names cached in external */
    externalTypedefs: number;
    /** Number of unique enum names cached in workspace */
    workspaceEnums: number;
    /** Number of unique enum names cached in external */
    externalEnums: number;
}

/**
 * Interface for symbol cache manager operations
 * Manages two-tier caching (workspace + external) for symbols
 */
export interface ISymbolCacheManager {
    /**
     * Invalidate all caches (both workspace and external)
     */
    invalidateAllCaches(): void;

    /**
     * Invalidate only workspace caches, keeping external/library caches intact
     */
    invalidateWorkspaceCaches(): void;

    /**
     * Invalidate only external/library caches
     */
    invalidateExternalCaches(): void;

    /**
     * Invalidate caches for a specific document URI
     * More granular than full cache invalidation
     * @param uri The document URI to invalidate
     * @param isWorkspaceFile Whether the document is a workspace file (true), external file (false), or unknown (null)
     */
    invalidateCachesForDocument(uri: string, isWorkspaceFile: boolean | null): void;

    /**
     * Get cached class definitions or mark as needing search
     */
    getClassCache(className: string): {
        workspace: ClassDeclNode[] | null;
        external: ClassDeclNode[] | null;
    };

    /**
     * Add class definition to appropriate cache
     */
    addClassToCache(className: string, classNode: ClassDeclNode, isWorkspace: boolean): void;

    /**
     * Set complete class cache (used when populating from search)
     */
    setClassCache(className: string, workspace: ClassDeclNode[], external: ClassDeclNode[]): void;

    /**
     * Get cached function definitions or mark as needing search
     */
    getFunctionCache(functionName: string): {
        workspace: FunctionDeclNode[] | null;
        external: FunctionDeclNode[] | null;
    };

    /**
     * Set complete function cache (used when populating from search)
     */
    setFunctionCache(functionName: string, workspace: FunctionDeclNode[], external: FunctionDeclNode[]): void;

    /**
     * Get cached variable definitions or mark as needing search
     */
    getVariableCache(variableName: string): {
        workspace: VarDeclNode[] | null;
        external: VarDeclNode[] | null;
    };

    /**
     * Set complete variable cache (used when populating from search)
     */
    setVariableCache(variableName: string, workspace: VarDeclNode[], external: VarDeclNode[]): void;

    /**
     * Get cached typedef definitions or mark as needing search
     */
    getTypedefCache(typedefName: string): {
        workspace: TypedefDeclNode[] | null;
        external: TypedefDeclNode[] | null;
    };

    /**
     * Set complete typedef cache (used when populating from search)
     */
    setTypedefCache(typedefName: string, workspace: TypedefDeclNode[], external: TypedefDeclNode[]): void;

    /**
     * Get cached enum definitions or mark as needing search
     */
    getEnumCache(enumName: string): {
        workspace: EnumDeclNode[] | null;
        external: EnumDeclNode[] | null;
    };

    /**
     * Set complete enum cache (used when populating from search)
     */
    setEnumCache(enumName: string, workspace: EnumDeclNode[], external: EnumDeclNode[]): void;

    /**
     * Get cache statistics for monitoring
     */
    getStats(): SymbolCacheStats;

    /**
     * Log cache statistics for debugging
     */
    logStats(): void;
}
