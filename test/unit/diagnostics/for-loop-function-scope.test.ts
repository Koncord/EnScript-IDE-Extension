import { UndeclaredVariableRule } from '../../../server/src/server/diagnostics/rules/undeclared-variable';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectNoDiagnosticWithMessage,
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

    // TODO: This should fail in the future when we implement variable shadowing/redeclaration detection
    // Since for loop variables are function-scoped, declaring 'int i' twice is a redeclaration error
    it.skip('should detect redeclaration in nested for loops with same variable name', async () => {
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

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should have redeclaration error (not undeclared-variable)
        // This is a different diagnostic rule that doesn't exist yet
        expect(results).toHaveLength(0); // Placeholder - will need redeclaration rule
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
