/**
 * Tests for for loop with multiple comma-separated variable declarations
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { UndeclaredVariableRule } from '../../../server/src/server/diagnostics/rules/undeclared-variable';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectNoDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('For Loop Multiple Variables', () => {
    let testContext: DiagnosticTestContext;
    let rule: UndeclaredVariableRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new UndeclaredVariableRule();
    });

    it('should recognize all comma-separated variables in for loop initializer', async () => {
        const code = `
class MyTestClass {
    void TestMethod() {
        for (int j = 1, i = 0; i < 10; i++) {
            Print(i.ToString());
            Print(j.ToString());
        }
    }
}
`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should not report 'i' or 'j' as undeclared
        expectNoDiagnosticWithMessage(results, 'i');
        expectNoDiagnosticWithMessage(results, 'j');
    });

    it('should handle for loop with multiple variables without initializers', async () => {
        const code = `
class MyTestClass {
    void TestMethod() {
        for (int j, i = 0; i < 10; i++) {
            j = i * 2;
        }
    }
}
`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should not report 'j' as undeclared
        expectNoDiagnosticWithMessage(results, 'j');
    });

    it('should handle for loop with three variables', async () => {
        const code = `
class MyTestClass {
    void TestMethod() {
        for (int a = 0, b = 1, c = 2; a < 10; a++) {
            Print(a.ToString() + b.ToString() + c.ToString());
        }
    }
}
`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should not report any variables as undeclared
        expectNoDiagnosticWithMessage(results, 'a');
        expectNoDiagnosticWithMessage(results, 'b');
        expectNoDiagnosticWithMessage(results, 'c');
    });
});
