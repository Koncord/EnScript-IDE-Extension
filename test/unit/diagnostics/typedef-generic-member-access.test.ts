/**
 * Tests for typedef with generic parameters member access
 */

import { TypeMismatchRule } from '../../../server/src/server/diagnostics/rules/type-mismatch';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('Typedef Generic Member Access', () => {
    let testContext: DiagnosticTestContext;
    let rule: TypeMismatchRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new TypeMismatchRule();
    });

    it('should not report false positive for typedef with generic parameters', async () => {
        const code = `
class Param2<Class T1, Class T2> {
    T1 param1;
    T2 param2;
}

typedef Param2<string, string> TestParams;

void Func() {
    TestParams p;
    string str = p.param2;
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results).toHaveLength(0);
    });

    it('should handle typedef with different generic types', async () => {
        const code = `
class Param2<Class T1, Class T2> {
    T1 param1;
    T2 param2;
}

typedef Param2<int, float> NumberParams;

void Test() {
    NumberParams p;
    float val = p.param2;
    int key = p.param1;
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results).toHaveLength(0);
    });

    it('should still detect real type mismatches with typedef', async () => {
        const code = `
class Param2<Class T1, Class T2> {
    T1 param1;
    T2 param2;
}

typedef Param2<string, string> TestParams;

void Func() {
    TestParams p;
    int wrongType = p.param2;  // Should error: param2 is string, not int
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results).toHaveLength(1);
        expect(results[0].code).toBe('type-mismatch');
        expect(results[0].message).toContain('string');
        expect(results[0].message).toContain('int');
    });

    it('should handle nested generic typedefs', async () => {
        const code = `
class Param2<Class T1, Class T2> {
    T1 param1;
    T2 param2;
}

class Container<Class T> {
    T value;
}

typedef Param2<Container<int>, Container<string>> ComplexParams;

void Test() {
    ComplexParams p;
    Container<string> strContainer = p.param2;
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results).toHaveLength(0);
    });

    it('should work with typedef pointing to non-generic class', async () => {
        const code = `
class SimpleClass {
    int value;
}

typedef SimpleClass MyClass;

void Test() {
    MyClass obj;
    int val = obj.value;
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results).toHaveLength(0);
    });
});
