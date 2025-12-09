/**
 * Tests for UndeclaredVariableRule
 * 
 * Tests for detecting undeclared variable usage
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

    describe('Modded Classes', () => {

        it('should allow access to members from multiple modded class definitions', async () => {
            // Register file1.c with Func1() method
            const file1Code = `
modded class TestClass {
    void Func1() {}
}`;
            const file1Uri = 'test://file1.c';
            const file1Doc = TextDocument.create(file1Uri, 'enscript', 1, file1Code);
            testContext.docCacheManager.ensureDocumentParsed(file1Doc);
            testContext.typeResolver.reindexDocumentSymbols(file1Uri);

            // Register file2.c with Func2() method
            const file2Code = `
modded class TestClass {
    void Func2() {}
}`;
            const file2Uri = 'test://file2.c';
            const file2Doc = TextDocument.create(file2Uri, 'enscript', 1, file2Code);
            testContext.docCacheManager.ensureDocumentParsed(file2Doc);
            testContext.typeResolver.reindexDocumentSymbols(file2Uri);

            // Now test file3.c which references both Func1() and Func2()
            const file3Code = `
modded class TestClass {
    void TestMethod() {
        Func1();
        Func2();
    }
}`;
            const file3Uri = 'test://file3.c';
            const results = await runDiagnosticRule(rule, file3Code, testContext, file3Uri);

            // Should not flag either Func1 or Func2 as undeclared
            expectNoDiagnosticWithMessage(results, 'Func1');
            expectNoDiagnosticWithMessage(results, 'Func2');
        });
    });

    describe('Modded Class Members', () => {
        it('should find member from modded base class', async () => {
            const code = `
class TestBase {
}

modded class TestBase {
    int value;
}

class TestClass extends TestBase {
    void Method() {
        value = 1;
    }
}`;

            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not flag value as undeclared
            expectNoDiagnosticWithMessage(results, 'value');
        });

        it('should find member from modded grandparent class', async () => {
            const code = `
class GrandParent {
}

modded class GrandParent {
    int sharedValue;
}

class Parent extends GrandParent {
}

class Child extends Parent {
    void Method() {
        sharedValue = 42;
    }
}`;

            const results = await runDiagnosticRule(rule, code, testContext);

            // Should not flag sharedValue as undeclared
            expectNoDiagnosticWithMessage(results, 'sharedValue');
        });

        it('should detect truly undeclared variable even with modded classes', async () => {
            const code = `
class TestBase {
}

modded class TestBase {
    int value;
}

class TestClass extends TestBase {
    void Method() {
        unknownVar = 1;
    }
}`;

            const results = await runDiagnosticRule(rule, code, testContext);

            // Should flag unknownVar as undeclared
            expectDiagnosticWithMessage(results, 'unknownVar');
        });
    });
});
