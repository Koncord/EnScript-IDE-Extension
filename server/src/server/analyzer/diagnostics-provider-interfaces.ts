import { TextDocument } from 'vscode-languageserver-textdocument';
import { Diagnostic } from 'vscode-languageserver';
import { IDiagnosticEngine } from '../diagnostics/engine-interfaces';

/**
 * Interface for the DiagnosticsProvider
 */
export interface IDiagnosticsProvider {
    /**
     * Run diagnostics on a document
     */
    runDiagnostics(doc: TextDocument): Promise<Diagnostic[]>;

    /**
     * Get the diagnostic engine instance for advanced configuration
     */
    getDiagnosticEngine(): IDiagnosticEngine;

    /**
     * Get diagnostic statistics
     */
    getDiagnosticStats(): { engineStats: unknown; registryStats: unknown };

    /**
     * Increment the function cache version (cache invalidation)
     */
    incrementFunctionCacheVersion(): void;

    /**
     * Clear the function existence cache
     */
    clearFunctionExistenceCache(): void;
}
