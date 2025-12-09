/**
 * Tests for MissingOverrideRule
 * 
 * Tests for detecting missing override keyword warnings
 */

import { MissingOverrideRule } from '../../../server/src/server/diagnostics/rules/missing-override';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectDiagnosticWithMessage,
    expectNoDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('MissingOverrideRule', () => {
    let testContext: DiagnosticTestContext;
    let rule: MissingOverrideRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new MissingOverrideRule();
    });

    describe('Method shadowing without override', () => {
        it('should detect method shadowing base class method without override keyword', async () => {
            const code = `
class BaseClass {
    void DoSomething() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    void DoSomething() {  // Missing override keyword
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "Method 'DoSomething' shadows base class method without 'override' keyword");
        });

        it('should not warn when override keyword is present', async () => {
            const code = `
class BaseClass {
    void DoSomething() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    override void DoSomething() {
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });

        it('should not warn when method does not exist in base class', async () => {
            const code = `
class BaseClass {
    void BaseMethod() {
        Print("Base");
    }
}

class DerivedClass : BaseClass {
    void DerivedMethod() {
        Print("Derived");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });

        it('should not warn when there is no base class', async () => {
            const code = `
class SimpleClass {
    void DoSomething() {
        Print("Simple");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });
    });

    describe('Method shadowing with inheritance chain', () => {
        it('should detect shadowing from grandparent class', async () => {
            const code = `
class GrandParent {
    void DoSomething() {
        Print("GrandParent");
    }
}

class Parent : GrandParent {
    void OtherMethod() {
        Print("Parent");
    }
}

class Child : Parent {
    void DoSomething() {  // Shadows GrandParent method
        Print("Child");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "Method 'DoSomething' shadows base class method without 'override' keyword");
        });
    });

    describe('Special method handling', () => {
        it('should not warn for constructors', async () => {
            const code = `
class BaseClass {
    void BaseClass() {
        Print("Base constructor");
    }
}

class DerivedClass : BaseClass {
    void DerivedClass() {
        Print("Derived constructor");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });

        it('should not warn for destructors', async () => {
            const code = `
class BaseClass {
    void ~BaseClass() {
        Print("Base destructor");
    }
}

class DerivedClass : BaseClass {
    void ~DerivedClass() {
        Print("Derived destructor");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });

        it('should not warn for proto methods', async () => {
            const code = `
class BaseClass {
    proto void DoSomething();
}

class DerivedClass : BaseClass {
    proto void DoSomething();
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });

        it('should not warn for native methods', async () => {
            const code = `
class BaseClass {
    native void DoSomething();
}

class DerivedClass : BaseClass {
    native void DoSomething();
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });
    });

    describe('Static and private methods', () => {
        it('should not warn when base method is static', async () => {
            const code = `
class BaseClass {
    static void DoSomething() {
        Print("Base static");
    }
}

class DerivedClass : BaseClass {
    void DoSomething() {
        Print("Derived instance");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });

        it('should not warn when base method is private', async () => {
            const code = `
class BaseClass {
    private void DoSomething() {
        Print("Base private");
    }
}

class DerivedClass : BaseClass {
    void DoSomething() {
        Print("Derived public");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });
    });

    describe('Modded classes', () => {
        it('should detect method overriding in modded class without override keyword', async () => {
            const code = `
class BaseClass {
    void DoSomething() {
        Print("Base");
    }
}

modded class BaseClass {
    void DoSomething() {  // Missing override keyword
        Print("Modded");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "Method 'DoSomething' shadows base class method without 'override' keyword");
        });

        it('should not warn when modded class has override keyword', async () => {
            const code = `
class BaseClass {
    void DoSomething() {
        Print("Base");
    }
}

modded class BaseClass {
    override void DoSomething() {
        Print("Modded");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });

        it('should not warn when modded class adds new method', async () => {
            const code = `
class BaseClass {
    void BaseMethod() {
        Print("Base");
    }
}

modded class BaseClass {
    void NewMethod() {
        Print("New method in modded");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, 'shadows');
        });

        it('should detect multiple overridden methods in modded class', async () => {
            const code = `
class BaseClass {
    void Method1() {
        Print("Base 1");
    }
    
    void Method2() {
        Print("Base 2");
    }
}

modded class BaseClass {
    void Method1() {  // Missing override
        Print("Modded 1");
    }
    
    override void Method2() {  // Has override
        Print("Modded 2");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "Method1");
            expectNoDiagnosticWithMessage(results, "Method2");
            expect(results.length).toBe(1);
        });
    });

    describe('Multiple methods', () => {
        it('should detect multiple shadowed methods', async () => {
            const code = `
class BaseClass {
    void Method1() {
        Print("Base 1");
    }
    
    void Method2() {
        Print("Base 2");
    }
}

class DerivedClass : BaseClass {
    void Method1() {  // Missing override
        Print("Derived 1");
    }
    
    void Method2() {  // Missing override
        Print("Derived 2");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectDiagnosticWithMessage(results, "Method1");
            expectDiagnosticWithMessage(results, "Method2");
            expect(results.length).toBeGreaterThanOrEqual(2);
        });

        it('should detect some missing override keywords but not others', async () => {
            const code = `
class BaseClass {
    void Method1() {
        Print("Base 1");
    }
    
    void Method2() {
        Print("Base 2");
    }
}

class DerivedClass : BaseClass {
    override void Method1() {  // Has override
        Print("Derived 1");
    }
    
    void Method2() {  // Missing override
        Print("Derived 2");
    }
}
`;
            const results = await runDiagnosticRule(rule, code, testContext);

            expectNoDiagnosticWithMessage(results, "Method1");
            expectDiagnosticWithMessage(results, "Method2");
            expect(results.length).toBe(1);
        });
    });
});
