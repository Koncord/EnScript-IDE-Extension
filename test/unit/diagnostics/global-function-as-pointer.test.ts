/**
 * Test: Global functions can be used as function pointers (delegates)
 * 
 * In EnScript, functions can be passed as arguments (function pointers).
 * This test verifies that the undeclared-variable rule correctly recognizes
 * global functions when they are used as identifiers (not in call position).
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { UndeclaredVariableRule } from '../../../server/src/server/diagnostics/rules/undeclared-variable';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectNoDiagnosticWithMessage,
    expectDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('UndeclaredVariableRule - Global Function as Pointer', () => {
    let testContext: DiagnosticTestContext;
    let rule: UndeclaredVariableRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new UndeclaredVariableRule();
    });

    it('should not flag global function used as function pointer in CallLater', async () => {
        const code = `
class MyClass {
    void Func() {
        GetGame().GetCallQueue().CallLater(Method, 100, false);
    }

    static void CalledLater() {
        
    }
}

void Method() {

}
`;

        const results = await runDiagnosticRule(rule, code, testContext);
        
        // Should not have any diagnostics - Method is a valid global function
        expectNoDiagnosticWithMessage(results, 'Method');
    });

    it('should still flag truly undeclared identifiers', async () => {
        const code = `
void Method() {
}

class MyClass {
    void Func() {
        GetGame().GetCallQueue().CallLater(Method, 100, false);
        GetGame().GetCallQueue().CallLater(UndeclaredFunc, 100, false);
    }
}
`;

        const results = await runDiagnosticRule(rule, code, testContext);
        
        // Should have one diagnostic for UndeclaredFunc
        expectDiagnosticWithMessage(results, "Cannot find name 'UndeclaredFunc'");
        expectNoDiagnosticWithMessage(results, 'Method');
    });

    it('should recognize static method as function pointer in same class', async () => {
        const code = `
class MyClass {
    void Func() {
        GetGame().GetCallQueue().CallLater(CalledLater, 100, false);
    }

    static void CalledLater() {
        
    }
}
`;

        const results = await runDiagnosticRule(rule, code, testContext);
        
        // Should not have any diagnostics - CalledLater is a static method in the same class
        expectNoDiagnosticWithMessage(results, 'CalledLater');
    });
});
