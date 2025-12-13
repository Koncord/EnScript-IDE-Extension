import { UndeclaredVariableRule } from '../../../server/src/server/diagnostics/rules/undeclared-variable';
import { VariableShadowingRule } from '../../../server/src/server/diagnostics/rules/variable-shadowing';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectNoDiagnosticWithMessage,
    expectDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('For Loop Function Scope', () => {
    let testContext: DiagnosticTestContext;
    let rule: UndeclaredVariableRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new UndeclaredVariableRule();
    });

    it('should allow using for loop variable in subsequent for loops', async () => {
        const code = `
class MyTestClass {
    void TestMethod() {
        for (int a = 0; a < 5; ++a) {}
        for (a = 0; a < 10; ++a) {}
    }
}`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should have NO undeclared variable errors - 'a' is function-scoped
        expectNoDiagnosticWithMessage(results, 'Cannot find name \'a\'');
    });

    it('should allow using for loop variable after the loop', async () => {
        const code = `
class MyTestClass {
    void TestMethod() {
        for (int i = 0; i < 5; ++i) {}
        Print(i.ToString());
    }
}`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should have NO undeclared variable error for 'i' - it's function-scoped
        expectNoDiagnosticWithMessage(results, 'Cannot find name \'i\'');
    });

    it('should detect redeclaration in nested for loops with same variable name', async () => {
        const code = `
class MyTestClass {
    void TestMethod() {
        for (int i = 0; i < 5; ++i) {
            for (int i = 0; i < 10; ++i) {
                Print(i.ToString());
            }
        }
    }
}`;

        // Use the shadowing rule which also checks redeclarations - for loop variables are function-scoped
        const redeclRule = new VariableShadowingRule();
        const results = await runDiagnosticRule(redeclRule, code, testContext);

        // Should have redeclaration error since both 'i' are in function scope
        expect(results).toHaveLength(1);
        expectDiagnosticWithMessage(results, "Variable 'i' is already declared in this scope");
    });

    it('should allow for loop variable with comma-separated declarations', async () => {
        const code = `
class MyTestClass {
    void TestMethod() {
        for (int i = 0, j = 0; i < 5; ++i, ++j) {}
        Print(i.ToString() + j.ToString());
    }
}`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should have NO undeclared variable errors - both 'i' and 'j' are function-scoped
        expectNoDiagnosticWithMessage(results, 'Cannot find name \'i\'');
        expectNoDiagnosticWithMessage(results, 'Cannot find name \'j\'');
    });

    it('should detect truly undeclared variables in for loop', async () => {
        const code = `
class MyTestClass {
    void TestMethod() {
        for (int i = 0; i < 5; ++i) {
            Print(undeclaredVar.ToString());
        }
    }
}`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should have ONE undeclared variable error for 'undeclaredVar'
        expect(results).toHaveLength(1);
        expect(results[0].message).toContain('undeclaredVar');
    });
});
