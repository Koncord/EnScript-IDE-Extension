import { UndeclaredMethodRule } from '../../../server/src/server/diagnostics/rules/undeclared-method';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    DiagnosticTestContext,
} from '../../test-helpers/diagnostic-test-helper';

describe('Typedef Generic Method Chaining', () => {
    let testContext: DiagnosticTestContext;
    let rule: UndeclaredMethodRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new UndeclaredMethodRule();
    });

    it('should resolve generic type parameters when calling methods on typedef', async () => {
        const code = `
class TestGeneric<Class TKey, Class TElem>  {
    TElem Get(TKey key);
}

class TestItem {
    int GetWidgetSetID();
}

typedef TestGeneric<int,ref TestItem> TestMap;

class MyTestClass {
    protected ref TestMap m_test;
    void TestMethod() {
        m_test.Get(0).GetWidgetSetID();
    }
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results).toHaveLength(0);
    });

    it('should handle ref modifier in typedef generic arguments', async () => {
        const code = `
class Container<Class T> {
    T GetValue();
}

class MyClass {
    void DoSomething();
}

typedef Container<ref MyClass> MyContainer;

void Test() {
    MyContainer c;
    c.GetValue().DoSomething();
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results).toHaveLength(0);
    });

    // TODO: Nested generics require recursive type resolution
    // This test is kept for future enhancement
    it.skip('should handle nested generic typedef', async () => {
        const code = `
class Outer<Class T> {
    T GetOuter();
}

class Inner<Class U> {
    U GetInner();
}

class Value {
    void Process();
}

typedef Outer<Inner<Value>> ComplexType;

void Test() {
    ComplexType c;
    c.GetOuter().GetInner().Process();
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results).toHaveLength(0);
    });
});
