/**
 * Analyzer Dependency Injection Container Configuration
 * 
 * Configures the DI container for analyzer components.
 */

import { Container } from 'inversify';
import { DocumentCacheManager } from '../cache/document-cache-manager';
import { SymbolCacheManager } from '../cache/symbol-cache-manager';
import { TypeCache } from '../cache/type-cache';
import { WorkspaceManager } from '../workspace/workspace-manager';
import { TypeResolver } from '../types/type-resolver';
import { SymbolOperations } from '../symbols/symbol-operations';
import { ASTScopeResolver } from '../scopes/ast-scope-resolver';
import { ClassDiscovery } from '../analyzer/class-discovery';
import { DiagnosticEngineFactory } from '../diagnostics/engine-factory';
import { ASTCompletionProvider } from '../analyzer/ast-completion-provider';
import { DiagnosticsProvider } from '../analyzer/diagnostics-provider';
import { Analyzer } from '../analyzer/analyzer';
import { ProjectManager } from '../project/project';
import { PreprocessorConfig, IPreprocessorConfig } from './preprocessor-config';
import { IDocumentCacheManager } from '../cache/document-cache-interfaces';
import { ISymbolCacheManager } from '../cache/symbol-cache-manager-interfaces';
import { ITypeCache } from '../cache/type-cache';
import { ITypeResolver } from '../types/type-resolver-interfaces';
import { ISymbolOperations } from '../symbols/symbol-operations-interfaces';
import { IASTScopeResolver } from '../scopes/ast-scope-resolver-interfaces';
import { IASTCompletionProvider } from '../analyzer/ast-completion-provider-interfaces';
import { IDiagnosticsProvider } from '../analyzer/diagnostics-provider-interfaces';
import { IAnalyzer } from '../analyzer/analyzer-interfaces';
import { IClassDiscovery } from '../analyzer/class-discovery-interfaces';
import { IDiagnosticEngineFactory } from '../diagnostics/engine-interfaces';
import { IProjectManager } from '../project/project-interfaces';
import {
    IWorkspaceManager
} from '../workspace/workspace-interfaces';
import { TYPES } from './tokens';

/**
 * Configure analyzer components in the DI container
 * This is called during Analyzer initialization to set up dependencies
 */
export function configureAnalyzerContainer(
    container: Container
): void {
    // Singletons - Stateful components that need to be shared
    container.bind<IPreprocessorConfig>(TYPES.IPreprocessorConfig).to(PreprocessorConfig).inSingletonScope();
    container.bind<IDocumentCacheManager>(TYPES.IDocumentCacheManager).to(DocumentCacheManager).inSingletonScope();
    container.bind<ISymbolCacheManager>(TYPES.ISymbolCacheManager).to(SymbolCacheManager).inSingletonScope();
    container.bind<ITypeCache>(TYPES.ITypeCache).to(TypeCache).inSingletonScope();
    container.bind<ITypeResolver>(TYPES.ITypeResolver).to(TypeResolver).inSingletonScope();
    container.bind<IClassDiscovery>(TYPES.IClassDiscovery).to(ClassDiscovery).inSingletonScope();
    container.bind<IWorkspaceManager>(TYPES.IWorkspaceManager).to(WorkspaceManager).inSingletonScope();
    container.bind<IProjectManager>(TYPES.IProjectManager).to(ProjectManager).inSingletonScope();
    container.bind<IAnalyzer>(TYPES.IAnalyzer).to(Analyzer).inSingletonScope();
    container.bind<IDiagnosticEngineFactory>(TYPES.IDiagnosticEngineFactory).to(DiagnosticEngineFactory).inSingletonScope();
    
    // Factory for TypeResolver (breaks WorkspaceManager ↔ TypeResolver circular dependency)
    container.bind<() => ITypeResolver>(TYPES.ITypeResolverFactory).toFactory(() => {
        return () => container.get<ITypeResolver>(TYPES.ITypeResolver);
    });
    
    // Transient - Stateless components that can be created per-request
    container.bind<IASTScopeResolver>(TYPES.IASTScopeResolver).to(ASTScopeResolver).inTransientScope();
    container.bind<ISymbolOperations>(TYPES.ISymbolOperations).to(SymbolOperations).inTransientScope();
    container.bind<IASTCompletionProvider>(TYPES.IASTCompletionProvider).to(ASTCompletionProvider).inTransientScope();
    container.bind<IDiagnosticsProvider>(TYPES.IDiagnosticsProvider).to(DiagnosticsProvider).inTransientScope();
}
