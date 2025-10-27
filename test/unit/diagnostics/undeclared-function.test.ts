/**
 * Tests for UndeclaredFunctionRule
 * 
 * Tests for detecting undeclared function calls and proper handling of static/instance method contexts
 */

import { UndeclaredFunctionRule } from '../../../server/src/server/diagnostics/rules/undeclared-function';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectNoDiagnosticWithMessage,
    expectDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('UndeclaredFunctionRule', () => {
    let testContext: DiagnosticTestContext;
    let rule: UndeclaredFunctionRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new UndeclaredFunctionRule();
    });
    describe('Static Method Access', () => {
        it('should allow static method calling another static method', async () => {
            const code = `
class TestClass {
    static void StaticMethod1() {
        StaticMethod2();
    }

    static void StaticMethod2() {}
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should not have any diagnostics for StaticMethod2
            expectNoDiagnosticWithMessage(results, 'StaticMethod2');
        });

        it('should allow static method calling another static method with class prefix', async () => {
            const code = `
class TestClass {
    static void StaticMethod1() {
        TestClass.StaticMethod2();
    }

    static void StaticMethod2() {}
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // This is handled by undeclared-method rule, not undeclared-function
            // So we shouldn't get errors from this rule
            expect(results).toHaveLength(0);
        });

        it('should prevent instance method call from static method', async () => {
            const code = `
class TestClass {
    void InstanceMethod() {}
    
    static void StaticMethod() {
        InstanceMethod();
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should have diagnostic about calling instance method from static context
            expect(results.length).toBeGreaterThan(0);
            expectDiagnosticWithMessage(results, 'Cannot call instance method');
            expectDiagnosticWithMessage(results, 'static context');
        });

        it('should allow instance method calling another instance method', async () => {
            const code = `
class TestClass {
    void InstanceMethod1() {
        InstanceMethod2();
    }

    void InstanceMethod2() {}
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should not have any diagnostics for InstanceMethod2
            expectNoDiagnosticWithMessage(results, 'InstanceMethod2');
        });

        it('should allow instance method calling static method', async () => {
            const code = `
class TestClass {
    static void StaticMethod() {}
    
    void InstanceMethod() {
        StaticMethod();
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should not have any diagnostics for StaticMethod
            expectNoDiagnosticWithMessage(results, 'StaticMethod');
        });
    });

    describe('Constructor Calls', () => {
        it('should allow constructor calls without new keyword', async () => {
            const code = `
class MyClass {
    void MyClass() {}
}

void TestFunction() {
    MyClass obj = MyClass();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should not flag MyClass() as undeclared
            expect(results).toHaveLength(0);
        });
    });

    describe('Undeclared Functions', () => {
        it('should detect undeclared function calls', async () => {
            const code = `
void TestFunction() {
    UndeclaredFunc();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            expectDiagnosticWithMessage(results, 'UndeclaredFunc');
        });

        it('should allow declared function calls', async () => {
            const code = `
void DeclaredFunc() {}

void TestFunction() {
    DeclaredFunc();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should not have diagnostics for DeclaredFunc
            expectNoDiagnosticWithMessage(results, 'DeclaredFunc');
        });
    });

    describe('Method Calls with MemberExpression', () => {
        it('should not check method calls (handled by undeclared-method rule)', async () => {
            const code = `
class MyClass {
    void Method() {}
}

void TestFunction() {
    MyClass obj;
    obj.Method();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // This rule should not check obj.Method() - that's for undeclared-method rule
            expect(results).toHaveLength(0);
        });
    });

    describe('Private Method Access', () => {
        it('should allow private static method calling another private static method', async () => {
            const code = `
class TestClass {
    private static void PrivateStatic1() {
        PrivateStatic2();
    }

    private static void PrivateStatic2() {}
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should not have any diagnostics
            expectNoDiagnosticWithMessage(results, 'PrivateStatic2');
        });

        it('should allow private instance method calling another private instance method', async () => {
            const code = `
class TestClass {
    private void PrivateInstance1() {
        PrivateInstance2();
    }

    private void PrivateInstance2() {}
}`;
            const results = await runDiagnosticRule(rule, code, testContext);
            
            // Should not have any diagnostics
            expectNoDiagnosticWithMessage(results, 'PrivateInstance2');
        });
    });
});
