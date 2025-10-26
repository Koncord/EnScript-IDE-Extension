/**
 * Symbol Cache Manager
 * 
 * Two-tier caching system for symbol lookups (classes, functions, variables, typedefs, enums).
 * Separates workspace symbols (frequently changing) from external/library symbols (stable).
 * 
 * Architecture:
 * - Workspace caches: Symbols from workspace files, invalidated granularly per file
 * - External caches: Symbols from library/include paths, rarely invalidated
 * - Granular invalidation: Only removes symbols from changed files, not entire caches
 */

import { injectable } from 'inversify';
import {
    ClassDeclNode,
    FunctionDeclNode,
    VarDeclNode,
    TypedefDeclNode,
    EnumDeclNode
} from '../ast/node-types';
import { normalizeUri } from '../../util/uri';
import { Logger } from '../../util/logger';
import type { ISymbolCacheManager, SymbolCacheStats } from './symbol-cache-manager-interfaces';

/**
 * Manages two-tier symbol caching for improved performance
 */
@injectable()
export class SymbolCacheManager implements ISymbolCacheManager {
    // Workspace symbol caches (invalidated on workspace file changes)
    private workspaceClassCache = new Map<string, ClassDeclNode[]>();
    private workspaceFunctionsCache = new Map<string, FunctionDeclNode[]>();
    private workspaceVariablesCache = new Map<string, VarDeclNode[]>();
    private workspaceTypedefsCache = new Map<string, TypedefDeclNode[]>();
    private workspaceEnumsCache = new Map<string, EnumDeclNode[]>();
    
    // External/library symbol caches (stable, rarely invalidated)
    private externalClassCache = new Map<string, ClassDeclNode[]>();
    private externalFunctionsCache = new Map<string, FunctionDeclNode[]>();
    private externalVariablesCache = new Map<string, VarDeclNode[]>();
    private externalTypedefsCache = new Map<string, TypedefDeclNode[]>();
    private externalEnumsCache = new Map<string, EnumDeclNode[]>();

    // ============================================================================
    // CACHE INVALIDATION
    // ============================================================================

    /**
     * Invalidate all caches (both workspace and external)
     */
    public invalidateAllCaches(): void {
        this.invalidateWorkspaceCaches();
        this.invalidateExternalCaches();
        Logger.debug(`🔄 All symbol caches invalidated`);
    }

    /**
     * Invalidate only workspace caches, keeping external/library caches intact
     */
    public invalidateWorkspaceCaches(): void {
        this.workspaceClassCache.clear();
        this.workspaceFunctionsCache.clear();
        this.workspaceVariablesCache.clear();
        this.workspaceTypedefsCache.clear();
        this.workspaceEnumsCache.clear();
        Logger.debug(`🔄 Workspace caches invalidated`);
    }

    /**
     * Invalidate only external/library caches
     */
    public invalidateExternalCaches(): void {
        this.externalClassCache.clear();
        this.externalFunctionsCache.clear();
        this.externalVariablesCache.clear();
        this.externalTypedefsCache.clear();
        this.externalEnumsCache.clear();
        Logger.debug(`🔄 External caches invalidated`);
    }

    /**
     * Invalidate caches for a specific document URI
     * More granular than full cache invalidation - only removes entries from that file
     * @param uri The document URI to invalidate
     * @param isWorkspaceFile Whether the document is a workspace file (true), external file (false), or unknown (null)
     */
    public invalidateCachesForDocument(uri: string, isWorkspaceFile: boolean | null): void {
        const normalizedUri = normalizeUri(uri);
        
        if (isWorkspaceFile === null) {
            // Can't determine - invalidate both to be safe
            this.invalidateWorkspaceCaches();
            this.invalidateExternalCaches();
        } else if (isWorkspaceFile) {
            // Workspace file changed - only invalidate entries from this specific file
            this.invalidateSymbolCachesForFile(normalizedUri, true);
        } else {
            // External file changed (rare) - only invalidate entries from this specific file
            this.invalidateSymbolCachesForFile(normalizedUri, false);
        }
    }

    /**
     * Invalidate symbol cache entries that came from a specific file
     * This is more granular than clearing entire caches
     */
    private invalidateSymbolCachesForFile(uri: string, isWorkspace: boolean): void {
        const normalizedUri = normalizeUri(uri);
        
        if (isWorkspace) {
            // Remove entries from workspace caches where node.uri matches
            this.filterCacheByUri(this.workspaceClassCache, normalizedUri);
            this.filterCacheByUri(this.workspaceFunctionsCache, normalizedUri);
            this.filterCacheByUri(this.workspaceVariablesCache, normalizedUri);
            this.filterCacheByUri(this.workspaceTypedefsCache, normalizedUri);
            this.filterCacheByUri(this.workspaceEnumsCache, normalizedUri);
        } else {
            // Remove entries from external caches where node.uri matches
            this.filterCacheByUri(this.externalClassCache, normalizedUri);
            this.filterCacheByUri(this.externalFunctionsCache, normalizedUri);
            this.filterCacheByUri(this.externalVariablesCache, normalizedUri);
            this.filterCacheByUri(this.externalTypedefsCache, normalizedUri);
            this.filterCacheByUri(this.externalEnumsCache, normalizedUri);
        }
    }

    /**
     * Helper to filter cache entries by URI
     */
    private filterCacheByUri<T extends { uri: string }>(
        cache: Map<string, T[]>,
        uriToRemove: string
    ): void {
        cache.forEach((nodes, key) => {
            const filtered = nodes.filter(node => normalizeUri(node.uri) !== uriToRemove);
            if (filtered.length === 0) {
                // Delete the entry to allow re-searching when the file is re-parsed
                // This is important for stub<->full transitions of external files
                cache.delete(key);
            } else if (filtered.length !== nodes.length) {
                cache.set(key, filtered);
            }
        });
    }

    // ============================================================================
    // CLASS CACHE
    // ============================================================================

    /**
     * Get cached class definitions or mark as needing search
     */
    public getClassCache(className: string): {
        workspace: ClassDeclNode[] | null;
        external: ClassDeclNode[] | null;
    } {
        return {
            workspace: this.workspaceClassCache.get(className) || null,
            external: this.externalClassCache.get(className) || null
        };
    }

    /**
     * Add class definition to appropriate cache
     */
    public addClassToCache(className: string, classNode: ClassDeclNode, isWorkspace: boolean): void {
        if (isWorkspace) {
            const existing = this.workspaceClassCache.get(className) || [];
            existing.push(classNode);
            this.workspaceClassCache.set(className, existing);
        } else {
            const existing = this.externalClassCache.get(className) || [];
            existing.push(classNode);
            this.externalClassCache.set(className, existing);
        }
    }

    /**
     * Set complete class cache (used when populating from search)
     */
    public setClassCache(className: string, workspace: ClassDeclNode[], external: ClassDeclNode[]): void {
        this.workspaceClassCache.set(className, workspace);
        this.externalClassCache.set(className, external);
    }

    // ============================================================================
    // FUNCTION CACHE
    // ============================================================================

    /**
     * Get cached function definitions or mark as needing search
     */
    public getFunctionCache(functionName: string): {
        workspace: FunctionDeclNode[] | null;
        external: FunctionDeclNode[] | null;
    } {
        return {
            workspace: this.workspaceFunctionsCache.get(functionName) || null,
            external: this.externalFunctionsCache.get(functionName) || null
        };
    }

    /**
     * Set complete function cache (used when populating from search)
     */
    public setFunctionCache(functionName: string, workspace: FunctionDeclNode[], external: FunctionDeclNode[]): void {
        this.workspaceFunctionsCache.set(functionName, workspace);
        this.externalFunctionsCache.set(functionName, external);
    }

    // ============================================================================
    // VARIABLE CACHE
    // ============================================================================

    /**
     * Get cached variable definitions or mark as needing search
     */
    public getVariableCache(variableName: string): {
        workspace: VarDeclNode[] | null;
        external: VarDeclNode[] | null;
    } {
        return {
            workspace: this.workspaceVariablesCache.get(variableName) || null,
            external: this.externalVariablesCache.get(variableName) || null
        };
    }

    /**
     * Set complete variable cache (used when populating from search)
     */
    public setVariableCache(variableName: string, workspace: VarDeclNode[], external: VarDeclNode[]): void {
        this.workspaceVariablesCache.set(variableName, workspace);
        this.externalVariablesCache.set(variableName, external);
    }

    // ============================================================================
    // TYPEDEF CACHE
    // ============================================================================

    /**
     * Get cached typedef definitions or mark as needing search
     */
    public getTypedefCache(typedefName: string): {
        workspace: TypedefDeclNode[] | null;
        external: TypedefDeclNode[] | null;
    } {
        return {
            workspace: this.workspaceTypedefsCache.get(typedefName) || null,
            external: this.externalTypedefsCache.get(typedefName) || null
        };
    }

    /**
     * Set complete typedef cache (used when populating from search)
     */
    public setTypedefCache(typedefName: string, workspace: TypedefDeclNode[], external: TypedefDeclNode[]): void {
        this.workspaceTypedefsCache.set(typedefName, workspace);
        this.externalTypedefsCache.set(typedefName, external);
    }

    // ============================================================================
    // ENUM CACHE
    // ============================================================================

    /**
     * Get cached enum definitions or mark as needing search
     */
    public getEnumCache(enumName: string): {
        workspace: EnumDeclNode[] | null;
        external: EnumDeclNode[] | null;
    } {
        return {
            workspace: this.workspaceEnumsCache.get(enumName) || null,
            external: this.externalEnumsCache.get(enumName) || null
        };
    }

    /**
     * Set complete enum cache (used when populating from search)
     */
    public setEnumCache(enumName: string, workspace: EnumDeclNode[], external: EnumDeclNode[]): void {
        this.workspaceEnumsCache.set(enumName, workspace);
        this.externalEnumsCache.set(enumName, external);
    }

    // ============================================================================
    // STATISTICS
    // ============================================================================

    /**
     * Get cache statistics for monitoring
     */
    public getStats(): SymbolCacheStats {
        return {
            workspaceClasses: this.workspaceClassCache.size,
            externalClasses: this.externalClassCache.size,
            workspaceFunctions: this.workspaceFunctionsCache.size,
            externalFunctions: this.externalFunctionsCache.size,
            workspaceVariables: this.workspaceVariablesCache.size,
            externalVariables: this.externalVariablesCache.size,
            workspaceTypedefs: this.workspaceTypedefsCache.size,
            externalTypedefs: this.externalTypedefsCache.size,
            workspaceEnums: this.workspaceEnumsCache.size,
            externalEnums: this.externalEnumsCache.size
        };
    }

    /**
     * Log cache statistics for debugging
     */
    public logStats(): void {
        const stats = this.getStats();
        Logger.info(`📊 Symbol Cache Statistics:`);
        Logger.info(`   Workspace: ${stats.workspaceClasses} classes, ${stats.workspaceFunctions} functions, ${stats.workspaceVariables} variables, ${stats.workspaceTypedefs} typedefs, ${stats.workspaceEnums} enums`);
        Logger.info(`   External:  ${stats.externalClasses} classes, ${stats.externalFunctions} functions, ${stats.externalVariables} variables, ${stats.externalTypedefs} typedefs, ${stats.externalEnums} enums`);
    }
}
