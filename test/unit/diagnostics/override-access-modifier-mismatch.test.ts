/**
 * Tests for OverrideAccessModifierMismatchRule
 * 
 * Tests for detecting mismatched access modifiers in override methods
 */

import { OverrideAccessModifierMismatchRule } from '../../../server/src/server/diagnostics/rules/override-access-modifier-mismatch';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectDiagnosticWithMessage,
    expectNoDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('OverrideAccessModifierMismatchRule', () => {
    let testContext: DiagnosticTestContext;
    let rule: OverrideAccessModifierMismatchRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new OverrideAccessModifierMismatchRule();
    });

    describe('Protected method overrides', () => {
        it('should detect missing protected modifier on override', async () => {
            const code = `
class BaseClass {
    protected void Test() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override void Test() {  // Missing 'protected'
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "has 'public' access but overrides 'protected'");
        });

        it('should not warn when protected modifier is correctly present', async () => {
            const code = `
class BaseClass {
    protected void Test() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override protected void Test() {
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'access but overrides');
        });

        it('should detect protected override attempting to widen to public', async () => {
            const code = `
class BaseClass {
    protected void DoSomething() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override void DoSomething() {  // Trying to make it public (default)
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "has 'public' access but overrides 'protected'");
            expectDiagnosticWithMessage(results, "Use 'override protected void DoSomething(...)'");
        });
    });

    describe('Private method handling', () => {
        it('should error when trying to override a private method', async () => {
            const code = `
class BaseClass {
    private void InternalMethod() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override void InternalMethod() {  // ERROR: Cannot override private method
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, 'Cannot override private method');
        });

        it('should error when trying to override private method with any access modifier', async () => {
            const code = `
class BaseClass {
    private void SecretMethod() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override protected void SecretMethod() {  // ERROR: Still can't override private
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, 'Cannot override private method');
        });

        it('should not error for private methods without override keyword', async () => {
            const code = `
class BaseClass {
    private void InternalMethod() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    void InternalMethod() {  // This is a new method, not an override (no override keyword)
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            // Without override keyword, this rule doesn't check it
            expectNoDiagnosticWithMessage(results, 'Cannot override private method');
        });
    });

    describe('Public (default) method overrides', () => {
        it('should not warn when both base and override are public', async () => {
            const code = `
class BaseClass {
    void PublicMethod() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override void PublicMethod() {
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'access but overrides');
        });

        it('should detect protected modifier when base is public', async () => {
            const code = `
class BaseClass {
    void PublicMethod() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override protected void PublicMethod() {  // Trying to narrow from public to protected
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "has 'protected' access but overrides 'public'");
        });
    });

    describe('Modded classes', () => {
        it('should detect access modifier mismatch in modded class', async () => {
            const code = `
class PlayerBase {
    protected void Init() {
        Print("Original");
    }
}

modded class PlayerBase {
    override void Init() {  // Missing 'protected'
        super.Init();
        Print("Modded");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "in modded class has 'public' access but original method has 'protected' access");
        });

        it('should not warn when modded class uses correct access modifier', async () => {
            const code = `
class PlayerBase {
    protected void Init() {
        Print("Original");
    }
}

modded class PlayerBase {
    override protected void Init() {
        super.Init();
        Print("Modded");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'access but overrides');
        });
    });

    describe('Inheritance chain', () => {
        it('should detect mismatch when overriding from grandparent class', async () => {
            const code = `
class GrandParent {
    protected void Method() {
        Print("GrandParent");
    }
}

class Parent : GrandParent {
}

class Child : Parent {
    override void Method() {  // Missing 'protected' from grandparent
        Print("Child");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "has 'public' access but overrides 'protected'");
        });
    });

    describe('No false positives', () => {
        it('should not warn when there is no override keyword', async () => {
            const code = `
class BaseClass {
    protected void Test() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    void Test() {  // Shadowing without override (handled by different rule)
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'access but overrides');
        });

        it('should not warn when method does not exist in base class', async () => {
            const code = `
class BaseClass {
    void BaseMethod() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override void DerivedMethod() {  // No such method in base (handled by different rule)
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'access but overrides');
        });

        it('should not warn for constructors', async () => {
            const code = `
class BaseClass {
    protected void BaseClass() {
    }
}

class DerivedClass : BaseClass {
    void DerivedClass() {
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'access but overrides');
        });

        it('should not warn when overriding method has different signature (overload)', async () => {
            const code = `
class BaseClass {
    protected void Test(int x) {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override void Test(string s) {  // Different signature = overload, not override
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'access but overrides');
        });

        it('should not warn for static methods', async () => {
            const code = `
class BaseClass {
    protected static void StaticMethod() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override static void StaticMethod() {
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'access but overrides');
        });
    });

    describe('Access modifier transitions', () => {
        it('should detect protected to private narrowing', async () => {
            const code = `
class BaseClass {
    protected void Method() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override private void Method() {
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "has 'private' access but overrides 'protected'");
        });
    });
});
