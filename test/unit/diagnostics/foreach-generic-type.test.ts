/**
 * Tests for foreach loop generic type resolution
 * 
 * Tests that generic types in foreach loop variables are properly resolved
 */

import { UndeclaredVariableRule } from '../../../server/src/server/diagnostics/rules/undeclared-variable';
import { UndeclaredMethodRule } from '../../../server/src/server/diagnostics/rules/undeclared-method';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectNoDiagnosticWithMessage,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('Foreach Generic Type Resolution', () => {
    let testContext: DiagnosticTestContext;
    let variableRule: UndeclaredVariableRule;
    let methodRule: UndeclaredMethodRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        variableRule = new UndeclaredVariableRule();
        methodRule = new UndeclaredMethodRule();
    });

    it('should resolve generic type in foreach loop variable', async () => {
        const content = `
class XMLParser {
    array<ref LineElement> GetElementString(string type, string itemType) { return null; }
    LineElement GetElementStringValue(string param, array<ref LineElement> data) { return null; }
    void ReplaceElementValue(string param, int index, string value) {}
}

class LineElement {
    string data;
    int index;
}

class Param3<Class T1, Class T2, Class T3> {
    T1 param1;
    T2 param2;
    T3 param3;
}

class MyTest {
    void EditElements() {
        array<ref Param3<string, string, int>> paramsData;
        string itemType;

        XMLParser parser;
        foreach (Param3<string, string, int> params : paramsData) {
            array<ref LineElement> Xmldata = parser.GetElementString("type", itemType);
            LineElement elementData = parser.GetElementStringValue(params.param1, Xmldata);
            if (elementData != null || elementData.data != string.Empty || elementData.index > -1) {
                parser.ReplaceElementValue(params.param1, elementData.index, params.param2);
            }
        }
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        // Should not have any "undeclared-variable" diagnostics for params
        expectNoDiagnosticWithMessage(varResults, 'params');
        
        // Should not have any "undeclared-method" diagnostics for param1 or param2
        expectNoDiagnosticWithMessage(methodResults, 'param1');
        expectNoDiagnosticWithMessage(methodResults, 'param2');
        
        // Should also not have errors for Xmldata (another foreach-scoped variable)
        expectNoDiagnosticWithMessage(varResults, 'Xmldata');
    });

    it('should handle nested foreach loops with generic types', async () => {
        const content = `
class Param2<Class T1, Class T2> {
    T1 first;
    T2 second;
}

class MyClass {
    void TestMethod() {
        array<ref Param2<string, int>> outerArray;
        foreach (Param2<string, int> outer : outerArray) {
            array<ref Param2<float, bool>> innerArray;
            foreach (Param2<float, bool> inner : innerArray) {
                string s = outer.first;
                int i = outer.second;
                float f = inner.first;
                bool b = inner.second;
            }
        }
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        // Should not have undeclared errors for outer or inner loop variables
        expectNoDiagnosticWithMessage(varResults, 'outer');
        expectNoDiagnosticWithMessage(varResults, 'inner');
        
        // Should not have undeclared errors for generic type members
        expectNoDiagnosticWithMessage(methodResults, 'first');
        expectNoDiagnosticWithMessage(methodResults, 'second');
    });

    it('should handle foreach with multiple loop variables', async () => {
        const content = `
class Param2<Class T1, Class T2> {
    T1 param1;
    T2 param2;
}

class MyClass {
    void TestMethod() {
        map<string, int> myMap;
        foreach (string key, int value : myMap) {
            string k = key;
            int v = value;
        }
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        
        // Should not have undeclared errors for key or value
        expectNoDiagnosticWithMessage(varResults, 'key');
        expectNoDiagnosticWithMessage(varResults, 'value');
    });

    it('should handle >> token in nested generics (valid syntax)', async () => {
        const content = `
class Param3<Class T1, Class T2, Class T3> {
    T1 param1;
    T2 param2;
    T3 param3;
}

class MyTest {
    void EditElements() {
        array<ref Param3<string, string, int>> paramsData;
        foreach (Param3<string, string, int> params : paramsData) {
            string s = params.param1;
            int i = params.param2;
        }
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        // >> in array<ref Param3<string, string, int>> is valid nested generic syntax
        // Parser should handle it without errors
        expectNoDiagnosticWithMessage(varResults, 'params');
        expectNoDiagnosticWithMessage(methodResults, 'param1');
        expectNoDiagnosticWithMessage(methodResults, 'param2');
    });

    it('should handle malformed >> token with error and recovery', async () => {
        const content = `
class Param3<Class T1, Class T2, Class T3> {
    T1 param1;
    T2 param2;
    T3 param3;
}

class MyTest {
    void EditElements() {
        array<ref Param3<string, string, int>> paramsData;
        foreach (Param3<string, string, int>> params : paramsData) {
            string s = params.param1;
            int i = params.param2;
        }
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        // With malformed >> (extra > after type), parser should recover and still
        // not generate false positive undeclared variable/method errors
        expectNoDiagnosticWithMessage(varResults, 'params');
        expectNoDiagnosticWithMessage(methodResults, 'param1');
        expectNoDiagnosticWithMessage(methodResults, 'param2');
        
        // Note: Parser will generate an error for the unexpected > token
    });

    it('should handle >>> token (three closing brackets) with error and recovery', async () => {
        const content = `
class Param3<Class T1, Class T2, Class T3> {
    T1 param1;
    T2 param2;
    T3 param3;
}

class MyTest {
    void EditElements() {
        array<ref Param3<string, string, int>>> paramsData;
        foreach (Param3<string, string, int> params : paramsData) {
            string s = params.param1;
            int i = params.param2;
        }
    }
}
`;

        const varResults = await runDiagnosticRule(variableRule, content, testContext);
        const methodResults = await runDiagnosticRule(methodRule, content, testContext);
        
        // With >>> (three >, one extra), parser should recover and still resolve types correctly
        expectNoDiagnosticWithMessage(varResults, 'params');
        expectNoDiagnosticWithMessage(methodResults, 'param1');
        expectNoDiagnosticWithMessage(methodResults, 'param2');
        
        // Note: Parser will generate an error for the extra > token in the declaration
    });
});
