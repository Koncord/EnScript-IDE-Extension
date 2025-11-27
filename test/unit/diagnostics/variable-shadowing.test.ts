/**
 * Tests for VariableShadowingRule
 * 
 * Tests for detecting variable shadowing warnings
 */

import { VariableShadowingRule } from '../../../server/src/server/diagnostics/rules/variable-shadowing';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectDiagnosticWithMessage,
    expectNoDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('VariableShadowingRule', () => {
    let testContext: DiagnosticTestContext;
    let rule: VariableShadowingRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new VariableShadowingRule();
    });

    describe('Global variable shadowing', () => {
        it('should detect local variable shadowing global variable', async () => {
            const code = `
int myVar;

void TestFunc() {
    float myVar = 0.0; // shadows global myVar
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "Local variable 'myVar' shadows global variable");
        });

        it('should not warn when local variable does not shadow', async () => {
            const code = `
int myVar;

void TestFunc() {
    float otherVar = 0.0;
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });

        it('should detect multiple shadowed variables', async () => {
            const code = `
int myVar;
float anotherVar;

void TestFunc() {
    int myVar = 1;
    string anotherVar = "test";
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "myVar");
            expectDiagnosticWithMessage(results, "anotherVar");
            expect(results.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Parameter shadowing', () => {
        it('should detect local variable shadowing parameter', async () => {
            const code = `
void TestFunc(int param) {
    float param = 0.0; // shadows parameter
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "Local variable 'param' shadows parameter");
        });

        it('should prioritize parameter shadowing over global shadowing', async () => {
            const code = `
int myVar;

void TestFunc(int myVar) {
    float myVar = 0.0; // shadows parameter, not global
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "shadows parameter");
            expectNoDiagnosticWithMessage(results, "shadows global");
        });
    });

    describe('Class member shadowing', () => {
        it('should detect local variable shadowing class member in method', async () => {
            const code = `
class MyClass {
    int memberVar;
    
    void TestMethod() {
        float memberVar = 0.0; // shadows class member
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "Local variable 'memberVar' shadows class member");
            expectDiagnosticWithMessage(results, "MyClass.memberVar");
        });

        it('should prioritize class member shadowing over global shadowing', async () => {
            const code = `
int myVar;

class MyClass {
    int myVar;
    
    void TestMethod() {
        float myVar = 0.0; // shadows class member, not global
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "shadows class member");
            expectNoDiagnosticWithMessage(results, "shadows global");
        });

        it('should not warn about shadowing in functions outside classes', async () => {
            const code = `
class MyClass {
    int memberVar;
}

void TestFunc() {
    int memberVar = 0; // not shadowing, different scope
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });
    });

    describe('Priority order', () => {
        it('should check parameter > class member > global', async () => {
            const code = `
int myVar;

class MyClass {
    int myVar;
    
    void TestMethod(int myVar) {
        float myVar = 0.0; // shadows parameter (highest priority)
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "shadows parameter");
            expectNoDiagnosticWithMessage(results, "shadows class member");
            expectNoDiagnosticWithMessage(results, "shadows global");
        });
    });

    describe('Edge cases', () => {
        it('should handle comma-separated declarations', async () => {
            const code = `
int globalA, globalB;

void TestFunc() {
    float globalA, globalB; // both shadow
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "globalA");
            expectDiagnosticWithMessage(results, "globalB");
            expect(results.length).toBeGreaterThanOrEqual(2);
        });
    });
});
