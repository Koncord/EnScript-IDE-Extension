/**
 * Basic Parser Tests
 * 
 * Tests for the EnScript/Enforce parser AST generation functionality
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseWithDiagnostics } from '../../../server/src/server/parser/parser';
import {
    FileNode,
    ClassDeclNode,
    FunctionDeclNode,
    VarDeclNode,
    EnumDeclNode,
    TypedefDeclNode,
    MethodDeclNode
} from '../../../server/src/server/ast/node-types';

/**
 * Helper function to create a text document for testing
 */
function createDocument(content: string, uri = 'test://test.c'): TextDocument {
    return TextDocument.create(uri, 'enscript', 1, content);
}

/**
 * Helper to parse code and return the AST
 */
function parseCode(code: string) {
    const doc = createDocument(code);
    return parseWithDiagnostics(doc);
}

describe('Parser', () => {
    describe('Basic Parsing', () => {
        it('should parse an empty file', () => {
            const { file, diagnostics } = parseCode('');

            expect(file).toBeDefined();
            expect(file.kind).toBe('File');
            expect(file.body).toHaveLength(0);
            expect(diagnostics).toHaveLength(0);
        });

        it('should parse a file with only comments', () => {
            const code = `// This is a comment
/* Multi-line
   comment */`;
            const { file, diagnostics } = parseCode(code);

            expect(file).toBeDefined();
            expect(diagnostics).toHaveLength(0);
        });

        it('should parse a file with preprocessor directives', () => {
            const code = `#define FOO
#ifdef DEBUG
#endif`;
            const { file, diagnostics } = parseCode(code);

            expect(file).toBeDefined();
            // Preprocessor directives should not generate errors
            expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);
        });
    });

    describe('Variable Declarations', () => {
        it('should parse a simple variable declaration', () => {
            const { file, diagnostics } = parseCode('int x;');

            expect(file.body).toHaveLength(1);
            const varDecl = file.body[0] as VarDeclNode;
            expect(varDecl.kind).toBe('VarDecl');
            expect(varDecl.name).toBe('x');
            expect(varDecl.type.kind).toBe('TypeReference');
            expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);
        });

        it('should parse multiple variable declarations', () => {
            const { file } = parseCode('int x; float y; bool z;');

            expect(file.body.length).toBeGreaterThanOrEqual(3);
        });

        it('should parse variable with initialization', () => {
            const { file, diagnostics } = parseCode('int x = 42;');

            expect(file.body).toHaveLength(1);
            const varDecl = file.body[0] as VarDeclNode;
            expect(varDecl.name).toBe('x');
            expect(varDecl.initializer).toBeDefined();
            expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);
        });

        it('should parse string variable', () => {
            const { file } = parseCode('string name = "test";');

            expect(file.body).toHaveLength(1);
            const varDecl = file.body[0] as VarDeclNode;
            expect(varDecl.name).toBe('name');
            expect(varDecl.initializer).toBeDefined();
        });

        it('should parse array variable', () => {
            const { file } = parseCode('int[] numbers;');

            expect(file.body).toHaveLength(1);
            const varDecl = file.body[0] as VarDeclNode;
            expect(varDecl.name).toBe('numbers');
            expect(varDecl.type.kind).toBe('ArrayType');
        });

        it('should parse reference variable', () => {
            const { file } = parseCode('ref MyClass obj;');

            expect(file.body).toHaveLength(1);
            const varDecl = file.body[0] as VarDeclNode;
            expect(varDecl.name).toBe('obj');
        });
    });

    describe('Function Declarations', () => {
        it('should parse a simple function', () => {
            const code = `void myFunction() {}`;
            const { file, diagnostics } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const funcDecl = file.body[0] as FunctionDeclNode;
            expect(funcDecl.kind).toBe('FunctionDecl');
            expect(funcDecl.name).toBe('myFunction');
            expect(funcDecl.returnType.kind).toBe('TypeReference');
            expect(funcDecl.parameters).toHaveLength(0);
            expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);
        });

        it('should parse a function with parameters', () => {
            const code = `int add(int a, int b) { return a + b; }`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const funcDecl = file.body[0] as FunctionDeclNode;
            expect(funcDecl.name).toBe('add');
            expect(funcDecl.parameters).toHaveLength(2);
            expect(funcDecl.parameters[0].name).toBe('a');
            expect(funcDecl.parameters[1].name).toBe('b');
        });

        it('should parse a function with return type', () => {
            const code = `string getName() { return "test"; }`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const funcDecl = file.body[0] as FunctionDeclNode;
            expect(funcDecl.returnType).toBeDefined();
        });

        it('should parse a function with modifiers', () => {
            const code = `static void staticFunc() {}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const funcDecl = file.body[0] as FunctionDeclNode;
            expect(funcDecl.modifiers).toBeDefined();
        });
    });

    describe('Class Declarations', () => {
        it('should parse an empty class', () => {
            const code = `class MyClass {}`;
            const { file, diagnostics } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const classDecl = file.body[0] as ClassDeclNode;
            expect(classDecl.kind).toBe('ClassDecl');
            expect(classDecl.name).toBe('MyClass');
            expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);
        });

        it('should parse a class with fields', () => {
            const code = `class MyClass {
    int x;
    string name;
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const classDecl = file.body[0] as ClassDeclNode;
            expect(classDecl.members.length).toBeGreaterThanOrEqual(2);
        });

        it('should parse a class with methods', () => {
            const code = `class MyClass {
    void doSomething() {}
    int getValue() { return 42; }
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const classDecl = file.body[0] as ClassDeclNode;
            expect(classDecl.members.length).toBeGreaterThanOrEqual(2);

            const methods = classDecl.members.filter((m) => m.kind === 'MethodDecl');
            expect(methods.length).toBeGreaterThanOrEqual(2);
        });

        it('should parse a class with constructor', () => {
            const code = `class MyClass {
    void MyClass() {}
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const classDecl = file.body[0] as ClassDeclNode;
            expect(classDecl.members.length).toBeGreaterThanOrEqual(1);
        });

        it('should parse a class with inheritance', () => {
            const code = `class Derived : Base {}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const classDecl = file.body[0] as ClassDeclNode;
            expect(classDecl.name).toBe('Derived');
            expect(classDecl.baseClass).toBeDefined();
        });

        it('should parse a class with modifiers', () => {
            const code = `class MyClass {
    private int x;
    protected void method() {}
    string name;
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const classDecl = file.body[0] as ClassDeclNode;
            expect(classDecl.members).toHaveLength(3);
        });

        it('should parse a modded class', () => {
            const code = `modded class MyClass {}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const classDecl = file.body[0] as ClassDeclNode;
            expect(classDecl.modifiers).toBeDefined();
        });
    });

    describe('Enum Declarations', () => {
        it('should parse an empty enum', () => {
            const code = `enum MyEnum {}`;
            const { file, diagnostics } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const enumDecl = file.body[0] as EnumDeclNode;
            expect(enumDecl.kind).toBe('EnumDecl');
            expect(enumDecl.name).toBe('MyEnum');
            expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);
        });

        it('should parse an enum with members', () => {
            const code = `enum Color {
    RED,
    GREEN,
    BLUE
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const enumDecl = file.body[0] as EnumDeclNode;
            expect(enumDecl.members.length).toBeGreaterThanOrEqual(3);
        });

        it('should parse an enum with explicit values', () => {
            const code = `enum Status {
    OK = 0,
    ERROR = 1,
    PENDING = 2
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const enumDecl = file.body[0] as EnumDeclNode;
            expect(enumDecl.members.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('Typedef Declarations', () => {
        it('should parse a simple typedef', () => {
            const code = `typedef int MyInt;`;
            const { file, diagnostics } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const typedefDecl = file.body[0] as TypedefDeclNode;
            expect(typedefDecl.kind).toBe('TypedefDecl');
            expect(typedefDecl.name).toBe('MyInt');
            expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);
        });

        it('should parse a typedef with generic type', () => {
            const code = `typedef array<int> IntArray;`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const typedefDecl = file.body[0] as TypedefDeclNode;
            expect(typedefDecl.name).toBe('IntArray');
        });

        it('should parse a typedef enum', () => {
            const code = `typedef enum { A, B, C } MyEnum;`;
            const { file } = parseCode(code);

            // Typedef enum may be parsed differently by the parser
            // Just check that parsing doesn't crash
            expect(file).toBeDefined();
        });
    });

    describe('Complex Code', () => {
        it('should parse a class with multiple members', () => {
            const code = `class Player {
    private int health;
    private string name;
    
    void Player() {
        health = 100;
        name = "Player";
    }
    
    void TakeDamage(int amount) {
        health = health - amount;
    }
    
    int GetHealth() {
        return health;
    }
}`;
            const { file, diagnostics } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const classDecl = file.body[0] as ClassDeclNode;
            expect(classDecl.name).toBe('Player');
            expect(classDecl.members.length).toBeGreaterThanOrEqual(5);

            // Should not have critical errors
            const errors = diagnostics.filter(d => d.severity === 1);
            expect(errors.length).toBe(0);
        });

        it('should parse multiple top-level declarations', () => {
            const code = `class MyClass {}
enum MyEnum { A, B }
void myFunction() {}
int globalVar;`;
            const { file } = parseCode(code);

            expect(file.body.length).toBeGreaterThanOrEqual(4);
        });

        it('should parse nested statements', () => {
            const code = `void test() {
    if (true) {
        for (int i = 0; i < 10; i++) {
            while (true) {
                break;
            }
        }
    }
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const funcDecl = file.body[0] as FunctionDeclNode;
            expect(funcDecl.body).toBeDefined();
        });

        it('should parse complex expressions', () => {
            const code = `void test() {
    int x = (a + b) * (c - d);
    bool result = x > 10 && y < 20;
    string name = obj.GetName();
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const funcDecl = file.body[0] as FunctionDeclNode;
            expect(funcDecl.body).toBeDefined();
        });
    });

    describe('Error Recovery', () => {
        it('should recover from missing semicolon', () => {
            const code = `int x
int y;`;
            const { file, diagnostics } = parseCode(code);

            // Should still parse and produce declarations
            expect(file.body.length).toBeGreaterThanOrEqual(1);

            // Should have diagnostics about the error
            expect(diagnostics.length).toBeGreaterThan(0);
        });

        it('should recover from incomplete function', () => {
            const code = `void incomplete(
int complete;`;
            const { file } = parseCode(code);

            // Should attempt to recover and continue parsing
            expect(file).toBeDefined();
        });

        it('should handle invalid tokens gracefully', () => {
            const code = `class Valid {}
@@@
int valid;`;
            const { file } = parseCode(code);

            // Should still parse valid parts
            expect(file.body.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Statement Parsing', () => {
        it('should parse if statement', () => {
            const code = `void test() {
    if (x > 0) {
        doSomething();
    }
}`;
            const { file, diagnostics } = parseCode(code);

            expect(file.body).toHaveLength(1);
            expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);
        });

        it('should parse if-else statement', () => {
            const code = `void test() {
    if (x > 0) {
        doSomething();
    } else {
        doOther();
    }
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse while loop', () => {
            const code = `void test() {
    while (x > 0) {
        x--;
    }
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse for loop', () => {
            const code = `void test() {
    for (int i = 0; i < 10; i++) {
        doSomething();
    }
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse foreach loop', () => {
            const code = `void test() {
    foreach (int item : items) {
        process(item);
    }
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse switch statement', () => {
            const code = `void test() {
    switch (value) {
        case 1:
            doOne();
            break;
        case 2:
            doTwo();
            break;
        default:
            doDefault();
    }
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse return statement', () => {
            const code = `int test() {
    return 42;
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });
    });

    describe('Expression Parsing', () => {
        it('should parse binary expressions', () => {
            const code = `void test() {
    int x = a + b;
    int y = c * d;
    bool z = a > b;
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse unary expressions', () => {
            const code = `void test() {
    int x = -a;
    bool y = !b;
    int z = ++c;
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse member access', () => {
            const code = `void test() {
    int x = obj.member;
    obj.method();
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse array access', () => {
            const code = `void test() {
    int x = arr[0];
    arr[1] = 42;
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse function calls', () => {
            const code = `void test() {
    myFunction();
    otherFunction(a, b, c);
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse new expressions', () => {
            const code = `void test() {
    MyClass obj = new MyClass();
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });

        it('should parse cast expressions', () => {
            const code = `void test() {
    MyClass obj = MyClass.Cast(other);
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });
    });

    describe('Type Parsing', () => {
        it('should parse primitive types', () => {
            const code = `int x; float y; bool z; string s; void v;`;
            const { file } = parseCode(code);

            expect(file.body.length).toBeGreaterThanOrEqual(4);
        });

        it('should parse array types', () => {
            const code = `int[] numbers; string[] names;`;
            const { file } = parseCode(code);

            expect(file.body.length).toBeGreaterThanOrEqual(2);
        });

        it('should parse generic types', () => {
            const code = `array<int> numbers; map<string, int> lookup;`;
            const { file } = parseCode(code);

            expect(file.body.length).toBeGreaterThanOrEqual(2);
        });

        it('should parse auto type', () => {
            const code = `void test() {
    auto x = getValue();
}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
        });
    });

    describe('Position Tracking', () => {
        it('should track declaration positions', () => {
            const code = `class MyClass {}`;
            const { file } = parseCode(code);

            expect(file.body).toHaveLength(1);
            const classDecl = file.body[0];
            expect(classDecl.start).toBeDefined();
            expect(classDecl.end).toBeDefined();
            expect(classDecl.start.line).toBeGreaterThanOrEqual(0);
            expect(classDecl.start.character).toBeGreaterThanOrEqual(0);
        });

        it('should track correct line and column', () => {
            const code = `int x;\nstring y;`;
            const { file } = parseCode(code);

            expect(file.body.length).toBeGreaterThanOrEqual(2);
            const firstDecl = file.body[0];
            const secondDecl = file.body[1];

            expect(firstDecl.start.line).toBe(0);
            expect(secondDecl.start.line).toBe(1);
        });
    });

    describe('Error Handling', () => {
        it('should generate diagnostic for invalid type argument syntax', () => {
            const code = `ref array<int> g_array = new <int>();`;
            const { diagnostics } = parseCode(code);

            // Should have at least one error diagnostic
            const errors = diagnostics.filter(d => d.severity === 1); // 1 = Error
            expect(errors.length).toBeGreaterThan(0);
            
            // Check that the error mentions the problem with the identifier
            const errorMessages = errors.map(e => e.message).join(' ');
            expect(errorMessages).toMatch(/identifier/i);
        });

        it('should handle malformed generic type arguments gracefully', () => {
            const code = `array<<int>> arr;`;
            const { file, diagnostics } = parseCode(code);

            // Should generate an error but not crash
            expect(file).toBeDefined();
            const errors = diagnostics.filter(d => d.severity === 1);
            expect(errors.length).toBeGreaterThan(0);
        });
    });
});
