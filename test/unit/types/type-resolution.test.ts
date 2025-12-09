import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { Container } from 'inversify';
import { TypeResolver } from '../../../server/src/server/types/type-resolver';
import { SymbolCacheManager } from '../../../server/src/server/cache/symbol-cache-manager';
import { TypeCache } from '../../../server/src/server/cache/type-cache';
import { DocumentCacheManager } from '../../../server/src/server/cache/document-cache-manager';
import { WorkspaceManager } from '../../../server/src/server/workspace/workspace-manager';
import { ClassDiscovery } from '../../../server/src/server/analyzer/class-discovery';
import { ProjectManager } from '../../../server/src/server/project/project';
import { PreprocessorConfig } from '../../../server/src/server/di/preprocessor-config';
import { TYPES } from '../../../server/src/server/di/tokens';

function createDocument(content: string, uri = 'test://test.c'): TextDocument {
    return TextDocument.create(uri, 'enscript', 1, content);
}

function setupContainer(): Container {
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
    return container;
}

describe('Type Resolution Cross-File Fix', () => {
    let container: Container;
    let typeResolver: TypeResolver;
    let docCacheManager: DocumentCacheManager;

    beforeEach(() => {
        container = setupContainer();
        typeResolver = container.get<TypeResolver>(TYPES.ITypeResolver);
        docCacheManager = container.get<DocumentCacheManager>(TYPES.IDocumentCacheManager);
    });

    it('should resolve variable types in both global functions and class methods', () => {
        // Create a CGame class definition (simulates external file)
        const gameClassDef = `class CGame {
    void SomeMethod();
}`;

        // Case 1: Global function with local variable
        const funcCode = `void Func() {
    CGame game = GetGame();
    game.
}`;

        // Case 2: Class method with local variable
        const classCode = `class AnotherClass {
    void Method1() {
        CGame game = GetGame();
        game.
    }
}`;

        const gameDoc = createDocument(gameClassDef, 'test://game.c');
        const funcDoc = createDocument(funcCode, 'test://funcDoc.c');
        const classDoc = createDocument(classCode, 'test://classDoc.c');

        // Parse all documents
        docCacheManager.ensureDocumentParsed(gameDoc);
        docCacheManager.ensureDocumentParsed(funcDoc);
        docCacheManager.ensureDocumentParsed(classDoc);

        // Position at completion point: "game." 
        const funcPos: Position = { line: 2, character: 4 }; // After "game." in global function
        const classPos: Position = { line: 3, character: 8 };  // After "game." in class method

        // Resolve variable types - both should succeed with the cross-file search fix
        const workingType = typeResolver.resolveObjectType('game', funcDoc, funcPos);
        const failingType = typeResolver.resolveObjectType('game', classDoc, classPos);

        // Verify both cases resolve to the correct type
        expect(workingType).toBe('CGame');
        expect(failingType).toBe('CGame'); // This was previously null due to the bug
    });

    it('should resolve inherited class members correctly', () => {
        const code = `
class ActionBase {
    string m_Text;
}

class ActionSingleUseBase extends ActionBase {
}

class ActionTest extends ActionSingleUseBase {
    void ActionTest() {
        m_Text = "Example";
    }
}`;

        const doc = createDocument(code, 'test://action.c');
        docCacheManager.ensureDocumentParsed(doc);
        typeResolver.reindexDocumentSymbols(doc.uri);

        // Position inside the constructor where m_Text is used
        const position: Position = { line: 10, character: 8 };

        // Resolve m_Text - should find it in the inheritance chain
        const resolvedType = typeResolver.resolveObjectType('m_Text', doc, position);

        // Should resolve to 'string' from ActionBase, not from some unrelated class
        expect(resolvedType).toBe('string');
    });
});
