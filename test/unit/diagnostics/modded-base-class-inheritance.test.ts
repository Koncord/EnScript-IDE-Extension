import { describe, it, beforeEach } from '@jest/globals';
import { UndeclaredMethodRule } from '../../../server/src/server/diagnostics/rules/undeclared-method';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    expectNoDiagnosticWithMessage,
    DiagnosticTestContext,
    parseAndRegisterDocument
} from '../../test-helpers/diagnostic-test-helper';

describe('Modded Base Class Inheritance', () => {
    let testContext: DiagnosticTestContext;
    let rule: UndeclaredMethodRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new UndeclaredMethodRule();
    });

    it('should find methods from modded base class when accessing through derived class instance', async () => {
        const cGameOriginal = `class CGame {
    void ConfigGetChildName(string path, int index, out string name);
    void ConfigGetText(string path, out string text);
}`;

        const cGameModded = `modded class CGame {

}`;

        // DayZGame extends CGame
        const dayZGame = `class DayZGame extends CGame {

}`;

        // Global variable g_Game is declared as DayZGame
        const globalVar = `DayZGame g_Game;`;

        // Register all dependency documents
        parseAndRegisterDocument(cGameOriginal, testContext.docCacheManager, 'test://CGame.c');
        parseAndRegisterDocument(cGameModded, testContext.docCacheManager, 'test://CGameModded.c');
        parseAndRegisterDocument(dayZGame, testContext.docCacheManager, 'test://DayZGame.c');
        parseAndRegisterDocument(globalVar, testContext.docCacheManager, 'test://globals.c');

        // Test code that accesses g_Game methods
        const testCode = `class TestClass {
    void Method() {
        string cfgVar;

        g_Game.ConfigGetChildName("", 0, cfgVar);
        g_Game.ConfigGetText("", cfgVar);
    }
}`;

        // Run diagnostics
        const results = await runDiagnosticRule(rule, testCode, testContext);

        expectNoDiagnosticWithMessage(results, 'ConfigGetChildName');
        expectNoDiagnosticWithMessage(results, 'ConfigGetText');
    });

    it('should find methods from modded base class with GetGame() function call', async () => {
        // Original CGame (base class)
        const cGameOriginal = `class CGame {
    void ConfigGetTextArray(string path, out array<string> values);
}`;

        const cGameModded = `modded class CGame {

}`;

        // GetGame function returns CGame
        const getGameFunc = `CGame GetGame();`;

        // Register all dependency documents
        parseAndRegisterDocument(cGameOriginal, testContext.docCacheManager, 'test://CGame.c');
        parseAndRegisterDocument(cGameModded, testContext.docCacheManager, 'test://CGameModded.c');
        parseAndRegisterDocument(getGameFunc, testContext.docCacheManager, 'test://globals.c');

        // Test code that uses GetGame()
        const testCode = `class TestClass
{
    void Method()
    {
        string cfgVar = "";
        array<string> cfgArr = new array<string>;        

        GetGame().ConfigGetTextArray(cfgVar, cfgArr);
    }
}`;

        // Run diagnostics
        const results = await runDiagnosticRule(rule, testCode, testContext);

        // There should be NO undeclared-method errors
        expectNoDiagnosticWithMessage(results, 'ConfigGetTextArray');
    });
});
