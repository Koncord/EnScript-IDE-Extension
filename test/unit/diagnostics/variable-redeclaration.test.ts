import { VariableShadowingRule } from '../../../server/src/server/diagnostics/rules/variable-shadowing';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectDiagnosticWithMessage,
    expectNoDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('VariableRedeclarationRule', () => {
    let testContext: DiagnosticTestContext;
    let rule: VariableShadowingRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new VariableShadowingRule();
    });

    describe('Basic Redeclaration', () => {
        it('should detect redeclaration in function scope', async () => {
            const code = `
void TestFunction() {
    int x = 1;
    int x = 2;
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(1);
            expectDiagnosticWithMessage(results, "Variable 'x' is already declared in this scope");
        });

        it('should allow same variable name in different functions', async () => {
            const code = `
void Function1() {
    int x = 1;
}

void Function2() {
    int x = 2;
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(0);
        });

        it('should detect multiple redeclarations', async () => {
            const code = `
void TestFunction() {
    int x = 1;
    int y = 2;
    int x = 3;
    int y = 4;
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(2);
            expectDiagnosticWithMessage(results, "Variable 'x' is already declared in this scope");
            expectDiagnosticWithMessage(results, "Variable 'y' is already declared in this scope");
        });
    });

    describe('For Loop Redeclaration', () => {
        it('should detect redeclaration in nested for loops', async () => {
            const code = `
void TestFunction() {
    for (int i = 0; i < 5; ++i) {
        for (int i = 0; i < 10; ++i) {}
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(1);
            expectDiagnosticWithMessage(results, "Variable 'i' is already declared in this scope");
        });

        it('should detect redeclaration in sequential for loops', async () => {
            const code = `
void TestFunction() {
    for (int i = 0; i < 5; ++i) {}
    for (int i = 0; i < 10; ++i) {}
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(1);
            expectDiagnosticWithMessage(results, "Variable 'i' is already declared in this scope");
        });

        it('should detect redeclaration with comma-separated declarations', async () => {
            const code = `
void TestFunction() {
    int i = 0;
    for (int i = 0, j = 0; i < 5; ++i) {}
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(1);
            expectDiagnosticWithMessage(results, "Variable 'i' is already declared in this scope");
        });

        it('should allow reusing for loop variable after first loop', async () => {
            const code = `
void TestFunction() {
    for (int i = 0; i < 5; ++i) {}
    i = 10; // Not a redeclaration, just assignment
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(0);
        });
    });

    describe('Foreach Loop Redeclaration', () => {
        it('should detect redeclaration with foreach loop variable', async () => {
            const code = `
void TestFunction() {
    array<int> items = new array<int>;
    int item;
    foreach (int item : items) {}
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(1);
            expectDiagnosticWithMessage(results, "Variable 'item' is already declared in this scope");
        });

        it('should detect redeclaration in nested foreach loops', async () => {
            const code = `
void TestFunction() {
    array<int> items = new array<int>;
    foreach (int i : items) {
        foreach (int i : items) {}
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(1);
            expectDiagnosticWithMessage(results, "Variable 'i' is already declared in this scope");
        });
    });

    describe('Comma-Separated Declarations', () => {
        it('should detect redeclaration in comma-separated list', async () => {
            const code = `
void TestFunction() {
    int x = 1, x = 2;
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(1);
            expectDiagnosticWithMessage(results, "Variable 'x' is already declared in this scope");
        });

        it('should allow different variables in comma-separated list', async () => {
            const code = `
void TestFunction() {
    int x = 1, y = 2, z = 3;
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(0);
        });
    });

    describe('Class Methods', () => {
        it('should detect redeclaration in method', async () => {
            const code = `
class MyClass {
    void TestMethod() {
        int x = 1;
        int x = 2;
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(1);
            expectDiagnosticWithMessage(results, "Variable 'x' is already declared in this scope");
        });

        it('should allow same variable name in different methods', async () => {
            const code = `
class MyClass {
    void Method1() {
        int x = 1;
    }
    
    void Method2() {
        int x = 2;
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expect(results).toHaveLength(0);
        });
    });
});
