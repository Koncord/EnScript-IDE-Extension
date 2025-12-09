/**
 * Tests for Document Symbol Handler (Outline view)
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentSymbol, SymbolKind } from 'vscode-languageserver';
import { DocumentSymbolHandler } from '../../../server/src/lsp/handlers/documentSymbol';
import { Connection, TextDocuments } from 'vscode-languageserver';
import { setupDiagnosticTestContainer, DiagnosticTestContext } from '../../test-helpers/diagnostic-test-helper';

describe('DocumentSymbolHandler', () => {
    let handler: DocumentSymbolHandler;
    let testContext: DiagnosticTestContext;
    let mockConnection: Partial<Connection>;
    let mockDocuments: Partial<TextDocuments<TextDocument>>;
    let documentSymbolCallback: ((params: any) => DocumentSymbol[]) | undefined;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        handler = new DocumentSymbolHandler(testContext.docCacheManager);

        // Mock connection
        documentSymbolCallback = undefined;
        mockConnection = {
            onDocumentSymbol: (callback: any) => {
                documentSymbolCallback = callback;
            }
        } as Partial<Connection>;

        // Mock documents
        mockDocuments = {
            get: jest.fn()
        } as Partial<TextDocuments<TextDocument>>;

        // Register handler
        handler.register(mockConnection as Connection, mockDocuments as TextDocuments<TextDocument>);
    });

    describe('Top-level declarations', () => {
        it('should return document symbols for classes', () => {
            const code = `
class MyClass {
    int field;
    void Method() {}
}

class AnotherClass extends MyClass {
    string name;
}
`;
            const doc = TextDocument.create('file:///test.c', 'enscript', 1, code);
            testContext.docCacheManager.ensureDocumentParsed(doc);

            (mockDocuments.get as jest.Mock).mockReturnValue(doc);

            const symbols = documentSymbolCallback!({ textDocument: { uri: doc.uri } });

            expect(symbols).toHaveLength(2);
            expect(symbols[0].name).toBe('MyClass');
            expect(symbols[0].kind).toBe(SymbolKind.Class);
            expect(symbols[0].children).toHaveLength(2); // field and Method
            
            expect(symbols[1].name).toBe('AnotherClass');
            expect(symbols[1].kind).toBe(SymbolKind.Class);
            expect(symbols[1].detail).toContain('extends MyClass');
            expect(symbols[1].children).toHaveLength(1); // name field
        });

        it('should return document symbols for functions', () => {
            const code = `
void GlobalFunction(int param1, string param2) {
}

int CalculateValue() {
    return 42;
}
`;
            const doc = TextDocument.create('file:///test.c', 'enscript', 1, code);
            testContext.docCacheManager.ensureDocumentParsed(doc);

            (mockDocuments.get as jest.Mock).mockReturnValue(doc);

            const symbols = documentSymbolCallback!({ textDocument: { uri: doc.uri } });

            expect(symbols).toHaveLength(2);
            expect(symbols[0].name).toBe('GlobalFunction');
            expect(symbols[0].kind).toBe(SymbolKind.Function);
            expect(symbols[0].detail).toContain('void GlobalFunction');
            expect(symbols[0].detail).toContain('int param1');
            expect(symbols[0].detail).toContain('string param2');

            expect(symbols[1].name).toBe('CalculateValue');
            expect(symbols[1].kind).toBe(SymbolKind.Function);
            expect(symbols[1].detail).toContain('int CalculateValue');
        });

        it('should return document symbols for enums', () => {
            const code = `
enum MyEnum {
    VALUE_ONE,
    VALUE_TWO,
    VALUE_THREE = 100
}

enum TypedEnum : int {
    TYPED_ONE = 1,
    TYPED_TWO = 2
}
`;
            const doc = TextDocument.create('file:///test.c', 'enscript', 1, code);
            testContext.docCacheManager.ensureDocumentParsed(doc);

            (mockDocuments.get as jest.Mock).mockReturnValue(doc);

            const symbols = documentSymbolCallback!({ textDocument: { uri: doc.uri } });

            expect(symbols).toHaveLength(2);
            
            expect(symbols[0].name).toBe('MyEnum');
            expect(symbols[0].kind).toBe(SymbolKind.Enum);
            expect(symbols[0].children).toHaveLength(3);
            expect(symbols[0].children![0].name).toBe('VALUE_ONE');
            expect(symbols[0].children![0].kind).toBe(SymbolKind.EnumMember);

            expect(symbols[1].name).toBe('TypedEnum');
            expect(symbols[1].kind).toBe(SymbolKind.Enum);
            expect(symbols[1].detail).toContain(': int');
            expect(symbols[1].children).toHaveLength(2);
        });

        it('should return document symbols for typedefs', () => {
            const code = `
typedef int MyInt;
typedef array<ref MyClass> MyArray;
`;
            const doc = TextDocument.create('file:///test.c', 'enscript', 1, code);
            testContext.docCacheManager.ensureDocumentParsed(doc);

            (mockDocuments.get as jest.Mock).mockReturnValue(doc);

            const symbols = documentSymbolCallback!({ textDocument: { uri: doc.uri } });

            expect(symbols).toHaveLength(2);
            expect(symbols[0].name).toBe('MyInt');
            expect(symbols[0].kind).toBe(SymbolKind.TypeParameter);
            expect(symbols[1].name).toBe('MyArray');
            expect(symbols[1].kind).toBe(SymbolKind.TypeParameter);
        });
    });

    describe('Class members', () => {
        it('should show methods with their signatures', () => {
            const code = `
class MyClass {
    void MyClass() {}
    void ~MyClass() {}
    
    void PublicMethod(int param) {}
    private void PrivateMethod() {}
    protected void ProtectedMethod() {}
    static void StaticMethod() {}
}
`;
            const doc = TextDocument.create('file:///test.c', 'enscript', 1, code);
            testContext.docCacheManager.ensureDocumentParsed(doc);

            (mockDocuments.get as jest.Mock).mockReturnValue(doc);

            const symbols = documentSymbolCallback!({ textDocument: { uri: doc.uri } });

            expect(symbols).toHaveLength(1);
            const classSymbol = symbols[0];
            expect(classSymbol.name).toBe('MyClass');
            expect(classSymbol.children).toHaveLength(6);

            // Check constructor - constructors have the class name
            const constructor = classSymbol.children!.find(c => c.detail === 'constructor');
            expect(constructor).toBeDefined();
            expect(constructor!.kind).toBe(SymbolKind.Method);
            expect(constructor!.name).toBe('MyClass');

            // Check destructor - destructors have the class name with ~ prefix
            const destructor = classSymbol.children!.find(c => c.detail === 'destructor');
            expect(destructor).toBeDefined();
            expect(destructor!.kind).toBe(SymbolKind.Method);
            expect(destructor!.name).toBe('~MyClass');

            // Check methods with modifiers
            const publicMethod = classSymbol.children!.find(c => c.name === 'PublicMethod');
            expect(publicMethod).toBeDefined();
            expect(publicMethod!.detail).toContain('void PublicMethod(int param)');

            const privateMethod = classSymbol.children!.find(c => c.name === 'PrivateMethod');
            expect(privateMethod).toBeDefined();
            expect(privateMethod!.detail).toContain('void PrivateMethod()');

            const staticMethod = classSymbol.children!.find(c => c.name === 'StaticMethod');
            expect(staticMethod).toBeDefined();
            expect(staticMethod!.detail).toContain('void StaticMethod()');
        });

        it('should show fields', () => {
            const code = `
class MyClass {
    int publicField;
    private string privateField;
    protected ref MyOtherClass protectedField;
    static const float CONSTANT = 3.14;
}
`;
            const doc = TextDocument.create('file:///test.c', 'enscript', 1, code);
            testContext.docCacheManager.ensureDocumentParsed(doc);

            (mockDocuments.get as jest.Mock).mockReturnValue(doc);

            const symbols = documentSymbolCallback!({ textDocument: { uri: doc.uri } });

            expect(symbols).toHaveLength(1);
            const classSymbol = symbols[0];
            expect(classSymbol.children).toHaveLength(4);

            // Check fields by name
            const publicField = classSymbol.children!.find(c => c.name === 'publicField');
            expect(publicField).toBeDefined();
            expect(publicField!.kind).toBe(SymbolKind.Variable);

            const privateField = classSymbol.children!.find(c => c.name === 'privateField');
            expect(privateField).toBeDefined();
            expect(privateField!.detail).toBe('private');

            const protectedField = classSymbol.children!.find(c => c.name === 'protectedField');
            expect(protectedField).toBeDefined();
            expect(protectedField!.detail).toContain('protected');

            const constant = classSymbol.children!.find(c => c.name === 'CONSTANT');
            expect(constant).toBeDefined();
            expect(constant!.detail).toContain('static');
            expect(constant!.detail).toContain('const');
        });
    });

    describe('Hierarchical structure', () => {
        it('should build proper hierarchy with ranges', () => {
            const code = `
class MyClass {
    int field;
    
    void Method() {
        int localVar;
    }
}
`;
            const doc = TextDocument.create('file:///test.c', 'enscript', 1, code);
            testContext.docCacheManager.ensureDocumentParsed(doc);

            (mockDocuments.get as jest.Mock).mockReturnValue(doc);

            const symbols = documentSymbolCallback!({ textDocument: { uri: doc.uri } });

            expect(symbols).toHaveLength(1);
            const classSymbol = symbols[0];

            // Class should have a range covering the entire class
            expect(classSymbol.range.start.line).toBe(1);
            expect(classSymbol.range.end.line).toBeGreaterThan(1);

            // Selection range should be just the class name
            expect(classSymbol.selectionRange.start.line).toBe(1);
            expect(classSymbol.selectionRange.end.line).toBe(1);

            // Children should have their own ranges
            expect(classSymbol.children).toHaveLength(2);
            const fieldSymbol = classSymbol.children!.find(c => c.name === 'field');
            const methodSymbol = classSymbol.children!.find(c => c.name === 'Method');

            expect(fieldSymbol).toBeDefined();
            expect(fieldSymbol!.range).toBeDefined();
            expect(fieldSymbol!.selectionRange).toBeDefined();

            expect(methodSymbol).toBeDefined();
            expect(methodSymbol!.range).toBeDefined();
            expect(methodSymbol!.selectionRange).toBeDefined();
        });
    });

    describe('Edge cases', () => {
        it('should return empty array for non-existent document', () => {
            (mockDocuments.get as jest.Mock).mockReturnValue(undefined);

            const symbols = documentSymbolCallback!({ textDocument: { uri: 'file:///nonexistent.c' } });

            expect(symbols).toEqual([]);
        });

        it('should return empty array for document with no AST', () => {
            const doc = TextDocument.create('file:///test.c', 'enscript', 1, '');
            (mockDocuments.get as jest.Mock).mockReturnValue(doc);

            const symbols = documentSymbolCallback!({ textDocument: { uri: doc.uri } });

            expect(symbols).toEqual([]);
        });

        it('should skip declarations without names', () => {
            const code = `
class MyClass {
    int validField;
}
`;
            const doc = TextDocument.create('file:///test.c', 'enscript', 1, code);
            const ast = testContext.docCacheManager.ensureDocumentParsed(doc);
            
            // Manually add a declaration without a name (simulating a parse error)
            ast.body.push({ kind: 'VarDecl', name: '', modifiers: [], annotations: [] } as any);

            (mockDocuments.get as jest.Mock).mockReturnValue(doc);

            const symbols = documentSymbolCallback!({ textDocument: { uri: doc.uri } });

            // Should only return MyClass, not the invalid declaration
            expect(symbols).toHaveLength(1);
            expect(symbols[0].name).toBe('MyClass');
        });
    });

    describe('Mixed content', () => {
        it('should handle files with classes, functions, and enums', () => {
            const code = `
enum Status {
    ACTIVE,
    INACTIVE
}

class MyClass {
    Status status;
    void SetStatus(Status s) {
        status = s;
    }
}

void GlobalFunction() {
}

typedef int Counter;
`;
            const doc = TextDocument.create('file:///test.c', 'enscript', 1, code);
            testContext.docCacheManager.ensureDocumentParsed(doc);

            (mockDocuments.get as jest.Mock).mockReturnValue(doc);

            const symbols = documentSymbolCallback!({ textDocument: { uri: doc.uri } });

            expect(symbols).toHaveLength(4);
            expect(symbols.map(s => s.name)).toEqual(['Status', 'MyClass', 'GlobalFunction', 'Counter']);
            expect(symbols.map(s => s.kind)).toEqual([
                SymbolKind.Enum,
                SymbolKind.Class,
                SymbolKind.Function,
                SymbolKind.TypeParameter
            ]);

            // Check enum has members
            expect(symbols[0].children).toHaveLength(2);

            // Check class has members
            expect(symbols[1].children).toHaveLength(2);
        });
    });
});
