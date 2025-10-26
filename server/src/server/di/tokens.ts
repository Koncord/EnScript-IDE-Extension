/**
 * Dependency Injection Tokens
 * 
 * Symbols for injecting dependencies throughout the analyzer.
 */

export const TYPES = {
    // Core components
    IAnalyzer: Symbol.for('IAnalyzer'),
    IDocumentCacheManager: Symbol.for('IDocumentCache'),
    ITypeCache: Symbol.for('ITypeCache'),
    ITypeResolver: Symbol.for('ITypeResolver'),
    IASTScopeResolver: Symbol.for('IASTScopeResolver'),
    ISymbolOperations: Symbol.for('ISymbolOperations'),
    IASTCompletionProvider: Symbol.for('IASTCompletionProvider'),
    IDiagnosticsProvider: Symbol.for('IDiagnosticsProvider'),
    ISymbolCacheManager: Symbol.for('ISymbolCacheManager'),
    IClassDiscovery: Symbol.for('IClassDiscovery'),
    
    // Factories (used to break circular dependencies)
    IDiagnosticEngineFactory: Symbol.for('IDiagnosticEngineFactory'),
    ITypeResolverFactory: Symbol.for('ITypeResolverFactory'),
    
    // Configuration
    IPreprocessorConfig: Symbol.for('IPreprocessorConfig'),
    
    // Workspace
    IWorkspaceManager: Symbol.for('IWorkspaceManager'),
    
    // Project
    IProjectManager: Symbol.for('IProjectManager'),
};
