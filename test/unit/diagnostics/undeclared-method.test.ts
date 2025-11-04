/**
 * Tests for UndeclaredMethodRule
 * 
 * Tests for detecting undeclared method calls and proper handling of static/instance mismatches
 */

import { UndeclaredMethodRule } from '../../../server/src/server/diagnostics/rules/undeclared-method';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectNoDiagnosticWithMessage,
    expectDiagnosticWithMessage,
    DiagnosticTestContext,
    parseAndRegisterDocument
} from '../../test-helpers/diagnostic-test-helper';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('UndeclaredMethodRule', () => {
    let testContext: DiagnosticTestContext;
    let rule: UndeclaredMethodRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new UndeclaredMethodRule();

        // Load built-in string class fixture
        const stringFixturePath = join(__dirname, '../../fixtures/builtin_string.c');
        const stringFixtureContent = readFileSync(stringFixturePath, 'utf-8');
        parseAndRegisterDocument(
            stringFixtureContent,
            testContext.docCacheManager,
            'test://builtin_string.c'
        );

        // Load SDK base fixture (includes Class base with Cast method)
        const sdkBasePath = join(__dirname, '../../fixtures/sdk_base.c');
        const sdkBaseContent = readFileSync(sdkBasePath, 'utf-8');
        parseAndRegisterDocument(
            sdkBaseContent,
            testContext.docCacheManager,
            'test://sdk_base.c'
        );
    });
    describe('Static/Instance Method Access', () => {
        it('should allow static method called on class name', async () => {
            const code = `
class TestClass {
    static void StaticMethod() {}
}

void TestFunction() {
    TestClass.StaticMethod();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not have any diagnostics for StaticMethod
            expectNoDiagnosticWithMessage(results, 'StaticMethod');
        });

        it('should allow instance method called on instance', async () => {
            const code = `
class TestClass {
    void InstanceMethod() {}
}

void TestFunction() {
    TestClass obj;
    obj.InstanceMethod();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not have any diagnostics for InstanceMethod
            expectNoDiagnosticWithMessage(results, 'InstanceMethod');
        });

        it('should not report error for static method called on instance', async () => {
            const code = `
class TestClass {
    static void StaticMethod() {}
}

void TestFunction() {
    TestClass obj;
    obj.StaticMethod(); // Static mismatch handled by StaticInstanceMismatchRule
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // UndeclaredMethodRule should not report this - StaticInstanceMismatchRule will
            expectNoDiagnosticWithMessage(results, 'StaticMethod');
        });
    });

    describe('Const Members', () => {
        it('should allow const member accessed statically', async () => {
            const code = `
class TestClass {
    const float MAX_VALUE = 100.0;
}

void TestFunction() {
    float max = TestClass.MAX_VALUE;
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Const members are implicitly static
            expectNoDiagnosticWithMessage(results, 'MAX_VALUE');
        });
    });

    describe('Private Member Access', () => {
        it('should allow private method accessed from within same class', async () => {
            const code = `
class TestClass {
    private void PrivateMethod() {}
    
    void PublicMethod() {
        this.PrivateMethod();
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not have diagnostics for PrivateMethod when called from within class
            expectNoDiagnosticWithMessage(results, 'PrivateMethod');
        });

        it('should detect private method accessed from outside class', async () => {
            const code = `
class TestClass {
    private void PrivateMethod() {}
}

void TestFunction() {
    TestClass obj;
    obj.PrivateMethod();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Should have diagnostic about private method access
            expectDiagnosticWithMessage(results, 'PrivateMethod');
        });
    });

    describe('Undeclared Methods', () => {
        it('should detect undeclared method calls', async () => {
            const code = `
class TestClass {
    void DeclaredMethod() {}
}

void TestFunction() {
    TestClass obj;
    obj.UndeclaredMethod();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, 'UndeclaredMethod');
        });

        it('should allow declared method calls', async () => {
            const code = `
class TestClass {
    void DeclaredMethod() {}
}

void TestFunction() {
    TestClass obj;
    obj.DeclaredMethod();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not have diagnostics for DeclaredMethod
            expectNoDiagnosticWithMessage(results, 'DeclaredMethod');
        });
    });

    describe('Built-in Type Methods', () => {
        it('should allow built-in array methods', async () => {
            const code = `
void TestFunction() {
    array<int> arr;
    arr.Insert(5);
    int size = arr.Count();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Built-in methods should not be flagged as undeclared
            expectNoDiagnosticWithMessage(results, 'Insert');
            expectNoDiagnosticWithMessage(results, 'Count');
        });

        it('should allow built-in string methods', async () => {
            const code = `
void TestFunction() {
    string str = "hello";
    int len = str.Length();
    string upper = str.ToUpper();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Built-in methods should not be flagged as undeclared
            expectNoDiagnosticWithMessage(results, 'Length');
            expectNoDiagnosticWithMessage(results, 'ToUpper');
        });
    });

    describe('Method Chaining', () => {
        it('should handle method chaining', async () => {
            const code = `
class TestClass {
    TestClass ChainMethod() {
        return this;
    }
    
    void FinalMethod() {}
}

void TestFunction() {
    TestClass obj;
    obj.ChainMethod().FinalMethod();
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not have diagnostics for properly chained methods
            expectNoDiagnosticWithMessage(results, 'ChainMethod');
            expectNoDiagnosticWithMessage(results, 'FinalMethod');
        });
    });

    describe('Super Access', () => {
        it('should allow super method calls', async () => {
            const code = `
class BaseClass {
    void BaseMethod() {}
}

class DerivedClass extends BaseClass {
    void DerivedMethod() {
        super.BaseMethod();
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not have diagnostics for super.BaseMethod()
            expectNoDiagnosticWithMessage(results, 'BaseMethod');
        });

        it('should check super access only in original class (not modded)', async () => {
            // This test verifies that super.Method() only checks the original class
            // Not the modded version (excludeModded flag)
            const code = `
class BaseClass {
    void OriginalMethod() {}
}

modded class BaseClass {
    void ModdedMethod() {}
}

class DerivedClass extends BaseClass {
    void DerivedMethod() {
        super.OriginalMethod();  // Should work
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not have diagnostics for super.OriginalMethod()
            // because it checks the original BaseClass, not the modded one
            expectNoDiagnosticWithMessage(results, 'OriginalMethod');
        });
    });

    describe('Inheritance', () => {
        it('should allow calling inherited methods', async () => {
            const code = `
class BaseClass {
    void BaseMethod() {}
}

class DerivedClass extends BaseClass {
    void DerivedMethod() {
        this.BaseMethod();
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not have diagnostics for inherited BaseMethod
            expectNoDiagnosticWithMessage(results, 'BaseMethod');
        });

        it('should allow calling inherited static methods', async () => {
            const code = `
class BaseClass {
    static void BaseStaticMethod() {}
}

class DerivedClass extends BaseClass {
    void DerivedMethod() {
        DerivedClass.BaseStaticMethod();
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not have diagnostics for inherited static method
            expectNoDiagnosticWithMessage(results, 'BaseStaticMethod');
        });
    });

    describe('Static Cast Method Type Resolution', () => {
        it('should resolve Cast return type to calling class for direct member access', async () => {
            const code = `
class TestClass {
    void Method(Man man) {
        PlayerBase.Cast(man).m_ActionQBControl = true;
        DayZPlayer.Cast(man).m_ActionQBControl = true;
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Cast should return the calling class type, allowing access to its members
            expectNoDiagnosticWithMessage(results, 'm_ActionQBControl');
        });

        it('should resolve Cast return type when assigned to variable', async () => {
            const code = `
class TestClass {
    void Method(Man man) {
        auto player = PlayerBase.Cast(man);
        player.m_ActionQBControl = true;
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'm_ActionQBControl');
        });

        it('should handle nested Cast calls', async () => {
            const code = `
class TestClass {
    void Method(Entity entity) {
        DayZPlayer.Cast(PlayerBase.Cast(entity)).m_ActionQBControl = true;
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'm_ActionQBControl');
        });

        it('should detect incorrect member access after Cast', async () => {
            const code = `
class TestClass {
    void Method(Man man) {
        PlayerBase.Cast(man).m_NonExistentMember = true;
    }
}`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "Method 'm_NonExistentMember' is not declared");
        });
    });
});
