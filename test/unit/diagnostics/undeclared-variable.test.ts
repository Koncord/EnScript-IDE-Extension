/**
 * Tests for UndeclaredVariableRule
 * 
 * Tests for detecting undeclared variable usage
 */

import { UndeclaredVariableRule } from '../../../server/src/server/diagnostics/rules/undeclared-variable';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectNoDiagnosticWithMessage,
    expectDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('UndeclaredVariableRule', () => {
    let testContext: DiagnosticTestContext;
    let rule: UndeclaredVariableRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new UndeclaredVariableRule();
    });

    describe('Basic Variable Declaration', () => {
        it('should not flag declared variables', async () => {
            const code = `
void TestFunction() {
    int myVar = 1;
    myVar = 2;
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should not have any diagnostics for myVar
            expectNoDiagnosticWithMessage(results, 'myVar');
        });

        it('should flag undeclared variables', async () => {
            const code = `
void TestFunction() {
    undeclaredVar = 2;
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should flag undeclaredVar
            expectDiagnosticWithMessage(results, "Cannot find name 'undeclaredVar'");
        });
    });

    describe('Class Members', () => {
        it('should allow access to class members', async () => {
            const code = `
class TestClass {
    int memberVar;
    
    void TestMethod() {
        memberVar = 1;
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should not have diagnostics for memberVar
            expectNoDiagnosticWithMessage(results, 'memberVar');
        });
    });

    describe('Function Parameters', () => {
        it('should allow access to function parameters', async () => {
            const code = `
void TestFunction(int param) {
    param = 2;
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should not have diagnostics for param
            expectNoDiagnosticWithMessage(results, 'param');
        });
    });
});
