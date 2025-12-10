/**
 * Test helper utilities for diagnostic rule testing
 * Provides common setup and utilities for testing diagnostic rules with proper type resolution
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Container } from 'inversify';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { parseWithDiagnostics } from '../../server/src/server/parser/parser';
import { TypeResolver } from '../../server/src/server/types/type-resolver';
import { SymbolCacheManager } from '../../server/src/server/cache/symbol-cache-manager';
import { TypeCache } from '../../server/src/server/cache/type-cache';
import { DocumentCacheManager } from '../../server/src/server/cache/document-cache-manager';
import { WorkspaceManager } from '../../server/src/server/workspace/workspace-manager';
import { ClassDiscovery } from '../../server/src/server/analyzer/class-discovery';
import { ProjectManager } from '../../server/src/server/project/project';
import { PreprocessorConfig } from '../../server/src/server/di/preprocessor-config';
import { TYPES } from '../../server/src/server/di/tokens';
import { FileNode } from '../../server/src/server/ast/node-types';
import { DiagnosticRuleContext, DiagnosticRule } from '../../server/src/server/diagnostics/rules';
import { buildSuppressionMap, isDiagnosticSuppressed } from '../../server/src/server/diagnostics/suppression';
import { lex } from '../../server/src/server/lexer/preprocessor-lexer';

/**
 * Test context that includes all necessary components for diagnostic testing
 */
export interface DiagnosticTestContext {
    container: Container;
    typeResolver: TypeResolver;
    docCacheManager: DocumentCacheManager;
    workspaceManager: WorkspaceManager;
}

/**
 * Create a text document for testing
 */
export function createDocument(content: string, uri = 'test://test.c'): TextDocument {
    return TextDocument.create(uri, 'enscript', 1, content);
}

/**
 * Setup a DI container with all necessary services for diagnostic testing
 */
export function setupDiagnosticTestContainer(): DiagnosticTestContext {
    const container = new Container();
    container.bind(TYPES.IPreprocessorConfig).to(PreprocessorConfig).inSingletonScope();
    container.bind(TYPES.ISymbolCacheManager).to(SymbolCacheManager).inSingletonScope();
    container.bind(TYPES.ITypeCache).to(TypeCache).inSingletonScope();
    container.bind(TYPES.IDocumentCacheManager).to(DocumentCacheManager).inSingletonScope();
    container.bind(TYPES.IWorkspaceManager).to(WorkspaceManager).inSingletonScope();
    container.bind(TYPES.ITypeResolver).to(TypeResolver).inSingletonScope();
    container.bind(TYPES.IClassDiscovery).to(ClassDiscovery).inSingletonScope();
    container.bind(TYPES.IProjectManager).to(ProjectManager).inSingletonScope();
    container.bind<() => TypeResolver>(TYPES.ITypeResolverFactory).toFactory(() => {
        return () => container.get<TypeResolver>(TYPES.ITypeResolver);
    });

    const docCacheManager = container.get<DocumentCacheManager>(TYPES.IDocumentCacheManager);
    const typeResolver = container.get<TypeResolver>(TYPES.ITypeResolver);
    const workspaceManager = container.get<WorkspaceManager>(TYPES.IWorkspaceManager);

    // Load SDK base file if available
    if ((global as any).SDK_BASE_CONTENT && (global as any).SDK_BASE_URI) {
        parseAndRegisterDocument((global as any).SDK_BASE_CONTENT, docCacheManager, (global as any).SDK_BASE_URI);
        // Reindex symbols from the SDK to make them available for lookups
        typeResolver.reindexDocumentSymbols((global as any).SDK_BASE_URI);
    }

    return {
        container,
        typeResolver,
        docCacheManager,
        workspaceManager
    };
}

/**
 * Parse code and register it with the document cache manager
 */
export function parseAndRegisterDocument(
    code: string,
    docCacheManager: DocumentCacheManager,
    uri = 'test://test.c'
): { document: TextDocument; file: FileNode } {
    const document = createDocument(code, uri);
    const { file } = parseWithDiagnostics(document);
    docCacheManager.ensureDocumentParsed(document);
    return { document, file };
}

/**
 * Create a diagnostic rule context for testing
 */
export function createDiagnosticContext(
    document: TextDocument,
    file: FileNode,
    testContext: DiagnosticTestContext
): DiagnosticRuleContext {
    // Build suppression map from document
    const tokens = lex(document.getText());
    const suppressionMap = buildSuppressionMap(tokens, document);
    
    return {
        document,
        ast: file,
        workspaceRoot: 'test://',
        typeResolver: testContext.typeResolver,
        includePaths: [],
        loadClassFromIncludePaths: async () => {},
        sharedCache: {},
        suppressionMap
    };
}

/**
 * Run a diagnostic rule on all applicable nodes in the AST
 */
export async function runDiagnosticRule(
    rule: DiagnosticRule,
    code: string,
    testContext: DiagnosticTestContext,
    uri = 'test://test.c'
): Promise<any[]> {
    const { document, file } = parseAndRegisterDocument(code, testContext.docCacheManager, uri);
    const context = createDiagnosticContext(document, file, testContext);
    const results: any[] = [];

    // Traverse all nodes and check applicable ones
    const visited = new Set<any>();
    const traverse = async (node: any) => {
        if (!node || visited.has(node)) {
            return;
        }
        visited.add(node);

        if (rule.appliesToNode(node)) {
            const diagnostics = await rule.check(node, context, {
                enabled: true,
                severity: DiagnosticSeverity.Error
            });
            
            // Filter suppressed diagnostics (mimics DiagnosticVisitor behavior)
            for (const diagnostic of diagnostics) {
                const line = diagnostic.range.start.line;
                const isSuppressed = context.suppressionMap && 
                    isDiagnosticSuppressed(line, rule.id, context.suppressionMap);
                
                if (!isSuppressed) {
                    results.push(diagnostic);
                }
            }
        }

        // Traverse children - only follow structural properties, not parent references
        for (const key in node) {
            if (key === 'parent') continue; // Skip parent references to avoid cycles

            const value = node[key];
            if (value && typeof value === 'object') {
                if (Array.isArray(value)) {
                    for (const item of value) {
                        if (item && typeof item === 'object' && 'kind' in item) {
                            await traverse(item);
                        }
                    }
                } else if ('kind' in value) {
                    await traverse(value);
                }
            }
        }
    };

    await traverse(file);
    return results;
}

/**
 * Setup multiple documents for cross-file testing
 * Useful for testing inheritance, imports, etc.
 */
export function setupMultipleDocuments(
    documents: Array<{ code: string; uri: string }>,
    testContext: DiagnosticTestContext
): Array<{ document: TextDocument; file: FileNode }> {
    return documents.map(({ code, uri }) =>
        parseAndRegisterDocument(code, testContext.docCacheManager, uri)
    );
}

/**
 * Helper to find diagnostics by message content
 */
export function findDiagnosticByMessage(
    diagnostics: any[],
    messageSubstring: string
): any | undefined {
    return diagnostics.find(d => d.message && d.message.includes(messageSubstring));
}

/**
 * Helper to assert no diagnostic contains a specific message
 */
export function expectNoDiagnosticWithMessage(
    diagnostics: any[],
    messageSubstring: string
): void {
    const found = findDiagnosticByMessage(diagnostics, messageSubstring);
    if (found) {
        throw new Error(
            `Expected no diagnostic with message containing "${messageSubstring}", ` +
            `but found: ${found.message}`
        );
    }
}

/**
 * Helper to assert a diagnostic contains a specific message
 */
export function expectDiagnosticWithMessage(
    diagnostics: any[],
    messageSubstring: string
): any {
    const found = findDiagnosticByMessage(diagnostics, messageSubstring);
    if (!found) {
        const messages = diagnostics.map(d => d.message).join(', ');
        throw new Error(
            `Expected diagnostic with message containing "${messageSubstring}", ` +
            `but found diagnostics: ${messages || '(none)'}`
        );
    }
    return found;
}
