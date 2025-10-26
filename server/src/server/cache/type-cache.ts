/**
 * Type Cache
 * 
 * Caches resolved types to improve performance.
 * Provides methods for invalidation and cache management.
 */

import { injectable } from 'inversify';
import { normalizeUri } from '../../util/uri';
import { Logger } from '../../util/logger';

export interface ITypeCache {
    /**
     * Get a cached type for the given cache key
     */
    get(key: string): string | null | undefined;

    /**
     * Set a cached type for the given cache key
     */
    set(key: string, type: string | null): void;

    /**
     * Check if a key exists in the cache
     */
    has(key: string): boolean;

    /**
     * Clear all cached types
     */
    clear(): void;

    /**
     * Invalidate cache entries for a specific document URI
     */
    invalidateCachesForDocument(uri: string): void;

    /**
     * Get current cache size
     */
    getSize(): number;

    /**
     * Get cache statistics
     */
    getStats(): TypeCacheStats;
}

export interface TypeCacheStats {
    size: number;
    version: number;
    maxSize: number;
}

/**
 * Type cache manager
 */
@injectable()
export class TypeCache implements ITypeCache {
    private cache = new Map<string, string | null>();
    private readonly maxCacheSize = 10000; // Limit cache size to prevent memory issues
    private cacheVersion = 0; // Track cache invalidation

    /**
     * Get a cached type for the given cache key
     */
    public get(key: string): string | null | undefined {
        return this.cache.get(key);
    }

    /**
     * Set a cached type for the given cache key
     */
    public set(key: string, type: string | null): void {
        this.cache.set(key, type);
        this.manageCacheSize();
    }

    /**
     * Check if a key exists in the cache
     */
    public has(key: string): boolean {
        return this.cache.has(key);
    }

    /**
     * Clear all cached types
     */
    public clear(): void {
        this.cache.clear();
        this.cacheVersion++;
        Logger.debug(`🔄 Type cache cleared (version: ${this.cacheVersion})`);
    }

    /**
     * Invalidate cache entries for a specific document URI
     */
    public invalidateCachesForDocument(uri: string): void {
        const normalizedUri = normalizeUri(uri);

        // Clear type cache entries related to this document
        for (const key of this.cache.keys()) {
            if (key.startsWith(normalizedUri)) {
                this.cache.delete(key);
            }
        }
        
        Logger.debug(`🔄 Type cache invalidated for document: ${normalizedUri}`);
    }

    /**
     * Get current cache size
     */
    public getSize(): number {
        return this.cache.size;
    }

    /**
     * Get cache statistics
     */
    public getStats(): TypeCacheStats {
        return {
            size: this.cache.size,
            version: this.cacheVersion,
            maxSize: this.maxCacheSize
        };
    }

    /**
     * Manage cache size to prevent memory issues
     */
    private manageCacheSize(): void {
        if (this.cache.size > this.maxCacheSize) {
            const keysToDelete = Array.from(this.cache.keys()).slice(0, Math.floor(this.maxCacheSize * 0.2));
            keysToDelete.forEach(key => this.cache.delete(key));
            Logger.debug(`🗑️ Type cache pruned: removed ${keysToDelete.length} entries`);
        }
    }
}
