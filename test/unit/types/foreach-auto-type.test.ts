/**
 * Tests for foreach variable auto type inference
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
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

describe('Foreach Auto Type Inference', () => {
    let container: Container;
    let typeResolver: TypeResolver;
    let cacheManager: DocumentCacheManager;

    beforeEach(() => {
        container = setupContainer();
        typeResolver = container.get<TypeResolver>(TYPES.ITypeResolver);
        cacheManager = container.get<DocumentCacheManager>(TYPES.IDocumentCacheManager);
    });

    test('should resolve auto foreach variable from array<PlayerIdentity>', () => {
        const code = `
class PlayerIdentity {
    string GetPlainId();
    string GetPlainName();
}

class MyTestClass {
    void TestMethod() {
        array<PlayerIdentity> identities = new array<PlayerIdentity>();
        foreach (auto identity : identities)
        {
            identity.GetPlainId();
        }
    }
}`;

        const doc = TextDocument.create('test://test.c', 'enscript', 1, code);
        cacheManager.ensureDocumentParsed(doc);

        // Resolve the type of 'identity' at the usage point
        // Line 10 (0-indexed line 9) is where identity.GetPlainId() is called
        const position = { line: 10, character: 12 }; // Position of 'identity'
        const resolvedType = typeResolver.resolveObjectType('identity', doc, position);

        expect(resolvedType).toBe('PlayerIdentity');
    });

    test('should resolve auto foreach variable from array generic type', () => {
        const code = `
class SomeClass {
    int value;
}

class TestClass {
    void TestMethod() {
        array<SomeClass> items = new array<SomeClass>();
        foreach (auto item : items)
        {
            auto val = item.value;
        }
    }
}`;

        const doc = TextDocument.create('test://test2.c', 'enscript', 1, code);
        cacheManager.ensureDocumentParsed(doc);

        // Resolve the type of 'item' at the usage point
        const position = { line: 9, character: 23 }; // Position of 'item' in item.value
        const resolvedType = typeResolver.resolveObjectType('item', doc, position);

        expect(resolvedType).toBe('SomeClass');
    });

    test('should resolve multiple foreach variables', () => {
        const code = `
class PlayerBase {
    string GetName();
}

class TestClass {
    void TestMethod() {
        array<PlayerBase> players1 = new array<PlayerBase>();
        array<PlayerBase> players2 = new array<PlayerBase>();
        
        foreach (auto player : players1)
        {
            player.GetName();
        }
        
        foreach (auto p : players2)
        {
            p.GetName();
        }
    }
}`;

        const doc = TextDocument.create('test://test3.c', 'enscript', 1, code);
        cacheManager.ensureDocumentParsed(doc);

        // Resolve first foreach variable
        const pos1 = { line: 11, character: 12 };
        const type1 = typeResolver.resolveObjectType('player', doc, pos1);
        expect(type1).toBe('PlayerBase');

        // Resolve second foreach variable
        const pos2 = { line: 16, character: 12 };
        const type2 = typeResolver.resolveObjectType('p', doc, pos2);
        expect(type2).toBe('PlayerBase');
    });

    test('should handle nested generic types in foreach', () => {
        const code = `
class Item {
    int id;
}

class Container {
    array<Item> items;
}

class TestClass {
    void TestMethod() {
        Container container = new Container();
        foreach (auto item : container.items)
        {
            auto itemId = item.id;
        }
    }
}`;

        const doc = TextDocument.create('test://test4.c', 'enscript', 1, code);
        cacheManager.ensureDocumentParsed(doc);

        const position = { line: 13, character: 26 }; // Position of 'item' in item.id
        const resolvedType = typeResolver.resolveObjectType('item', doc, position);

        expect(resolvedType).toBe('Item');
    });

    test('should resolve foreach with explicitly typed variable (not auto)', () => {
        const code = `
class PlayerIdentity {
    string GetPlainId();
}

class TestClass {
    void TestMethod() {
        array<PlayerIdentity> identities = new array<PlayerIdentity>();
        foreach (PlayerIdentity identity : identities)
        {
            identity.GetPlainId();
        }
    }
}`;

        const doc = TextDocument.create('test://test5.c', 'enscript', 1, code);
        cacheManager.ensureDocumentParsed(doc);

        const position = { line: 9, character: 12 };
        const resolvedType = typeResolver.resolveObjectType('identity', doc, position);

        expect(resolvedType).toBe('PlayerIdentity');
    });
});
