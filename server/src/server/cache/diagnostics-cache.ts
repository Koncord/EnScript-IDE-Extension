import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver/node';
import { Logger } from '../../util/logger';

/**
 * Cache entry for diagnostic results
 */
interface DiagnosticCacheEntry {
    version: number;
    diagnostics: Diagnostic[];
    timestamp: number;
}

/**
 * Shared cache for diagnostic results to avoid running diagnostics on every request
 */
class DiagnosticsCache {
    private cache = new Map<string, DiagnosticCacheEntry>();
    private readonly ttl: number;

    constructor(ttlMs: number = 5000) {
        this.ttl = ttlMs;
    }

    /**
     * Get cached diagnostics only if available (does not trigger diagnostics run)
     * Returns empty array if not cached or cache is stale
     */
    getCachedDiagnosticsOnly(doc: TextDocument): Diagnostic[] {
        const uri = doc.uri;
        const version = doc.version;
        const now = Date.now();

        // Check if we have a valid cache entry
        const cached = this.cache.get(uri);
        if (cached &&
            cached.version === version &&
            (now - cached.timestamp) < this.ttl) {
            Logger.debug(`Using cached diagnostics for ${uri} (version ${version})`);
            return cached.diagnostics;
        }
        return [];
    }

    /**
     * Clear cached diagnostics for a specific document
     */
    clearForDocument(uri: string): void {
        this.cache.delete(uri);
    }

    /**
     * Clear all cached diagnostics
     */
    clearAll(): void {
        this.cache.clear();
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const now = Date.now();
        let validEntries = 0;
        let expiredEntries = 0;

        for (const entry of this.cache.values()) {
            if ((now - entry.timestamp) < this.ttl) {
                validEntries++;
            } else {
                expiredEntries++;
            }
        }

        return {
            totalEntries: this.cache.size,
            validEntries,
            expiredEntries,
            ttlMs: this.ttl
        };
    }
}

// Shared instance
export const diagnosticsCache = new DiagnosticsCache();
