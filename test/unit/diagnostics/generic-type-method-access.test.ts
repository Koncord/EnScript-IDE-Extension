/**
 * Tests for method access on generic types
 */

import { UndeclaredMethodRule } from '../../../server/src/server/diagnostics/rules/undeclared-method';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('Generic Type Method Access', () => {
    let testContext: DiagnosticTestContext;
    let rule: UndeclaredMethodRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new UndeclaredMethodRule();
    });

    it('should resolve generic type parameter for array<T>', async () => {
        const code = `
class MyClass {
    void MyMethod() {}
}

void Test() {
    array<MyClass> arr;
    MyClass item = arr.Get(0);
    item.MyMethod(); // Should resolve to MyClass and allow MyMethod
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        // Should not report undeclared method
        expect(results).toHaveLength(0);
    });

    it('should detect undeclared method on generic type element', async () => {
        const code = `
class MyClass {
    void MyMethod() {}
}

void Test() {
    array<MyClass> arr;
    MyClass item = arr.Get(0);
    item.NonExistentMethod(); // Should error
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expectDiagnosticWithMessage(results, "Method 'NonExistentMethod' is not declared on class 'MyClass'");
    });

    it('should resolve typedef with generic type', async () => {
        const code = `
class array<Class T> {
    proto T Get(int index);
    proto int Count();
}

class Player {
    void Respawn() {}
}

typedef array<Player> PlayerList;

void Test() {
    PlayerList players;
    Player p = players.Get(0);
    p.Respawn(); // Should resolve to Player and allow Respawn
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results).toHaveLength(0);
    });

    it('should evaluate generic type parameters in class members', async () => {
        const code = `
class PlayerInfo {
    void GetName() {}
}

class Param2<Class T1, Class T2> {
    T1 param1;
    T2 param2;
}

typedef Param2<string, PlayerInfo> TestParams;

void Func() {
    TestParams p;
    p.param2.GetName(); // T2 should be evaluated to PlayerInfo
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results).toHaveLength(0);
    });

    it('should detect undeclared method on evaluated generic type parameter', async () => {
        const code = `
class PlayerInfo {
    void GetName() {}
}

class Param2<Class T1, Class T2> {
    T1 param1;
    T2 param2;
}

typedef Param2<string, PlayerInfo> TestParams;

void Func() {
    TestParams p;
    p.param2.NonExistentMethod(); // Should error on PlayerInfo
}`;
        const results = await runDiagnosticRule(rule, code, testContext);

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].message).toContain('NonExistentMethod');
        expect(results[0].message).toContain('PlayerInfo');
    });
});
