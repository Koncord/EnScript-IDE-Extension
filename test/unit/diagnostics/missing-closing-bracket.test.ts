import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseWithDiagnostics } from '../../../server/src/server/parser/parser';
import { UndeclaredVariableRule } from '../../../server/src/server/diagnostics/rules/undeclared-variable';
import { UndeclaredMethodRule } from '../../../server/src/server/diagnostics/rules/undeclared-method';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectNoDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('Missing Closing Bracket Recovery', () => {
    let testContext: DiagnosticTestContext;
    let variableRule: UndeclaredVariableRule;
    let methodRule: UndeclaredMethodRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        variableRule = new UndeclaredVariableRule();
        methodRule = new UndeclaredMethodRule();
    });

    it('should recover from missing > in simple generic declaration', async () => {
        const content = `
class MyTest {
    void TestMethod() {
        array<int myVar;
        myVar.Insert(5);
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        // Should recover and recognize myVar as declared
        expectNoDiagnosticWithMessage(varResults, 'myVar');
        expectNoDiagnosticWithMessage(methodResults, 'Insert');
    });

    it('should recover from missing > in nested generic declaration', async () => {
        const content = `
class Param2<Class T1, Class T2> {
    T1 param1;
    T2 param2;
}

class MyTest {
    void TestMethod() {
        array<ref Param2<string, int myData;
        Param2<string, int> item = myData[0];
        string s = item.param1;
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        // Should recover and recognize myData as declared
        expectNoDiagnosticWithMessage(varResults, 'myData');
        expectNoDiagnosticWithMessage(varResults, 'item');
        expectNoDiagnosticWithMessage(methodResults, 'param1');
    });

    it('should recover from missing > before semicolon', async () => {
        const content = `
class MyTest {
    void TestMethod() {
        array<string items;
        string first = items[0];
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        
        expectNoDiagnosticWithMessage(varResults, 'items');
        expectNoDiagnosticWithMessage(varResults, 'first');
    });

    it('should recover from missing > before comma in parameter list', async () => {
        const content = `
void TestFunc(array<int arr, string name) {
    int first = arr[0];
    int len = name.Length();
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        
        expectNoDiagnosticWithMessage(varResults, 'arr');
        expectNoDiagnosticWithMessage(varResults, 'name');
        expectNoDiagnosticWithMessage(varResults, 'first');
        expectNoDiagnosticWithMessage(varResults, 'len');
    });

    it('should recover from missing > before closing paren', async () => {
        const content = `
void TestFunc(array<int arr) {
    int val = arr[0];
}

class MyTest {
    void CallTest() {
        array<int data;
        TestFunc(data);
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        
        expectNoDiagnosticWithMessage(varResults, 'arr');
        expectNoDiagnosticWithMessage(varResults, 'data');
        expectNoDiagnosticWithMessage(varResults, 'val');
    });

    it('should recover from missing > before assignment', async () => {
        const content = `
class MyTest {
    void TestMethod() {
        array<int nums = new array<int>;
        nums.Insert(42);
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        expectNoDiagnosticWithMessage(varResults, 'nums');
        expectNoDiagnosticWithMessage(methodResults, 'Insert');
    });

    it('should recover from missing > before array dimension', async () => {
        const content = `
class MyTest {
    void TestMethod() {
        array<int items[10];
        items[0].Insert(1);
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        expectNoDiagnosticWithMessage(varResults, 'items');
        expectNoDiagnosticWithMessage(methodResults, 'Insert');
    });

    it('should handle multiple missing > in same file', async () => {
        const content = `
class MyTest {
    void TestMethod() {
        array<int first;
        array<string second;
        first.Insert(1);
        second.Insert("test");
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        expectNoDiagnosticWithMessage(varResults, 'first');
        expectNoDiagnosticWithMessage(varResults, 'second');
        expectNoDiagnosticWithMessage(methodResults, 'Insert');
    });

    it('should report parse error for missing >', async () => {
        const content = `
class MyTest {
    void TestMethod() {
        array<int myVar;
    }
}
`;

        const document = TextDocument.create('file:///test.c', 'enscript', 1, content);
        const result = parseWithDiagnostics(document, { 
            errorRecovery: true, 
            lenientSemicolons: true 
        });
        
        // Should have a parse error about missing '>'
        const missingBracketError = result.diagnostics.find(d => 
            d.message.includes("Missing '>'") || d.message.includes("missing '>'")
        );
        
        expect(missingBracketError).toBeDefined();
    });

    it('should not false positive on valid generic syntax', async () => {
        const content = `
class MyTest {
    void TestMethod() {
        array<int> myVar;
        myVar.Insert(5);
        
        array<ref array<int>> nested;
        nested.Insert(myVar);
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        // Should not have any undeclared variable/method errors
        expectNoDiagnosticWithMessage(varResults, 'myVar');
        expectNoDiagnosticWithMessage(varResults, 'nested');
        expectNoDiagnosticWithMessage(methodResults, 'Insert');
        
        // Parse should succeed without errors
        const document = TextDocument.create('file:///test.c', 'enscript', 1, content);
        const result = parseWithDiagnostics(document, { 
            errorRecovery: true, 
            lenientSemicolons: true 
        });
        
        expect(result.diagnostics.length).toBe(0);
    });
});
