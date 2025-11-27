import { TextDocument } from 'vscode-languageserver-textdocument';
import { FunctionDeclNode, MethodDeclNode, parseWithDiagnostics } from '../../../server/src/server/parser/parser';
import { IncorrectRefUsageRule } from '../../../server/src/server/diagnostics/rules/incorrect-ref-usage';
import { DiagnosticRuleContext } from '../../../server/src/server/diagnostics/rules';
import { isMethod, isFunction } from '../../../server/src/util';
import { ASTNode } from '../../../server/src/server/ast';

/**
 * Helper function to find all method and function nodes in the AST
 */
function findAllFunctionsAndMethods(ast: ASTNode): ASTNode[] {
    const results: ASTNode[] = [];

    function visit(node: any) {
        if (isMethod(node) || isFunction(node)) {
            results.push(node);
        }

        // Visit children array
        if (node.children) {
            for (const child of node.children) {
                visit(child);
            }
        }

        // Visit body array (for FileNode)
        if (node.body && Array.isArray(node.body)) {
            for (const item of node.body) {
                visit(item);
            }
        }

        // Visit members array (for ClassDecl)
        if (node.members && Array.isArray(node.members)) {
            for (const member of node.members) {
                visit(member);
            }
        }
    }

    visit(ast);
    return results;
}

describe('IncorrectRefUsageRule', () => {
    const rule = new IncorrectRefUsageRule();

    /**
     * Helper to run the rule on source code and return diagnostics
     */
    async function getDiagnostics(source: string) {
        const document = TextDocument.create(
            'file:///test.c',
            'enscript',
            1,
            source
        );

        const parseResult = parseWithDiagnostics(document);
        if (!parseResult.file) {
            throw new Error('Failed to parse test source');
        }

        const context: DiagnosticRuleContext = {
            document,
            ast: parseResult.file,
            workspaceRoot: '/test',
            includePaths: []
        };

        const allDiagnostics: Array<{ message: string; line: number }> = [];

        // Find all functions and methods to check
        const nodes = findAllFunctionsAndMethods(parseResult.file);

        for (const node of nodes) {
            if (rule.appliesToNode(node)) {
                const results = await rule.check(node as MethodDeclNode | FunctionDeclNode, context, rule.defaultConfig);
                for (const diag of results) {
                    allDiagnostics.push({
                        message: diag.message,
                        line: diag.range.start.line
                    });
                }
            }
        }

        return allDiagnostics;
    }

    describe('Valid usage - should not produce diagnostics', () => {
        it('should allow ref on global variables', async () => {
            const source = `
                class TestObject;
                ref array<int> g_arr;
            `;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(0);
        });

        it('should allow ref on class member variables', async () => {
            const source = `
                class TestObject;
                class TestClass {
                    ref array<TestObject> m_arr;
                    ref array<ref TestObject> m_arr2;
                }
            `;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(0);
        });

        it('should allow return type without outer ref but with inner ref', async () => {
            const source = `
                class TestObject;
                class TestClass {
                    array<ref TestObject> MethodValidA() {
                        return null;
                    }
                }
            `;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(0);
        });

        it('should allow parameter without outer ref but with inner ref', async () => {
            const source = `
                class TestObject;
                class TestClass {
                    void MethodValidB(array<ref TestObject> arg) {}
                }
            `;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(0);
        });

        it('should allow local variable without outer ref but with inner ref', async () => {
            const source = `
                class TestObject;
                class TestClass {
                    void MethodValidC() {
                        array<ref TestObject> local;
                    }
                }
            `;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(0);
        });

        it('should allow ref without nested ref in generics', async () => {
            const source = `
                class TestObject;
                class TestClass {
                    ref array<TestObject> MethodValid() {
                        return null;
                    }
                }
            `;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(0);
        });
    });

    describe('Invalid usage - should produce diagnostics', () => {
        it('should detect ref on return type with ref-counted generic arguments', async () => {
            const source = `class TestObject {}
class TestClass {
    ref array<ref TestObject> MethodInvalidA() {
        return null;
    }
}`;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].message).toContain('return types');
            expect(diagnostics[0].message).toContain('undefined behavior');
        });

        it('should detect ref on parameter with ref-counted generic arguments', async () => {
            const source = `class TestObject {}
class TestClass {
    void MethodInvalidB(ref array<ref TestObject> arg) {}
}`;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].message).toContain("parameter 'arg'");
            expect(diagnostics[0].message).toContain('undefined behavior');
        });

        it('should detect ref on local variable with ref-counted generic arguments', async () => {
            const source = `class TestObject {}
class TestClass {
    void MethodInvalidC() {
        ref array<ref TestObject> variable;
    }
}`;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].message).toContain("local variable 'variable'");
            expect(diagnostics[0].message).toContain('undefined behavior');
        });

        it('should detect ref on local variable in global function', async () => {
            const source = `class TestObject {}
void FuncInvalidC() {
    ref array<ref TestObject> variable;
}`;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].message).toContain("local variable 'variable'");
            expect(diagnostics[0].message).toContain('undefined behavior');
        });

        it('should detect multiple violations in the same function', async () => {
            const source = `class TestObject {}
class TestClass {
    ref array<ref TestObject> MethodMultipleIssues(ref array<ref TestObject> arg) {
        return null;
    }
}`;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics.length).toBeGreaterThanOrEqual(2);
            expect(diagnostics.some(d => d.message.includes('return types'))).toBe(true);
            expect(diagnostics.some(d => d.message.includes("parameter 'arg'"))).toBe(true);
        });

        it('should detect multiple parameter violations', async () => {
            const source = `class TestObject {}
void TestFunc(ref array<ref TestObject> arg1, ref array<ref TestObject> arg2) {}`;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(2);
            expect(diagnostics[0].message).toContain("parameter 'arg1'");
            expect(diagnostics[1].message).toContain("parameter 'arg2'");
        });

        it('should detect multiple local variable violations', async () => {
            const source = `class TestObject {}
void TestFunc() {
    ref array<ref TestObject> var1;
    ref array<ref TestObject> var2;
}`;
            const diagnostics = await getDiagnostics(source);
            expect(diagnostics).toHaveLength(2);
            expect(diagnostics.some(d => d.message.includes("local variable 'var1'"))).toBe(true);
            expect(diagnostics.some(d => d.message.includes("local variable 'var2'"))).toBe(true);
        });
    });
});
