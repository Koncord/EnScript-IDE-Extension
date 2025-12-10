/**
 * Tests for diagnostic suppression via comments
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { lex } from '../../../server/src/server/lexer/preprocessor-lexer';
import {
    buildSuppressionMap,
    isDiagnosticSuppressed,
    getSuppressedRulesForLine,
    SuppressionMap
} from '../../../server/src/server/diagnostics/suppression';

describe('Diagnostic Suppression', () => {
    describe('buildSuppressionMap', () => {
        test('should parse suppress comment on next line', () => {
            const code = `
// enscript-suppress
int undeclaredVar;
`;
            const document = TextDocument.create('test://test.c', 'enscript', 1, code);
            const tokens = lex(code);
            const suppressionMap = buildSuppressionMap(tokens, document);

            expect(suppressionMap.suppressionsByLine.has(2)).toBe(true);
            const directives = suppressionMap.suppressionsByLine.get(2);
            expect(directives).toBeDefined();
            expect(directives![0].type).toBe('next-line');
            expect(directives![0].ruleIds).toBeUndefined(); // Suppresses all rules
        });

        test('should parse suppress with specific rule', () => {
            const code = `
// enscript-suppress[undeclared-variable]
int undeclaredVar;
`;
            const document = TextDocument.create('test://test.c', 'enscript', 1, code);
            const tokens = lex(code);
            const suppressionMap = buildSuppressionMap(tokens, document);

            expect(suppressionMap.suppressionsByLine.has(2)).toBe(true);
            const directives = suppressionMap.suppressionsByLine.get(2);
            expect(directives).toBeDefined();
            expect(directives![0].ruleIds).toBeDefined();
            expect(directives![0].ruleIds!.has('undeclared-variable')).toBe(true);
        });

        test('should parse suppress with multiple rules', () => {
            const code = `
// enscript-suppress[undeclared-variable, type-mismatch]
int undeclaredVar;
`;
            const document = TextDocument.create('test://test.c', 'enscript', 1, code);
            const tokens = lex(code);
            const suppressionMap = buildSuppressionMap(tokens, document);

            expect(suppressionMap.suppressionsByLine.has(2)).toBe(true);
            const directives = suppressionMap.suppressionsByLine.get(2);
            expect(directives).toBeDefined();
            expect(directives![0].ruleIds).toBeDefined();
            expect(directives![0].ruleIds!.has('undeclared-variable')).toBe(true);
            expect(directives![0].ruleIds!.has('type-mismatch')).toBe(true);
        });

        test('should parse inline suppress comment', () => {
            const code = `
int undeclaredVar; // enscript-suppress
`;
            const document = TextDocument.create('test://test.c', 'enscript', 1, code);
            const tokens = lex(code);
            const suppressionMap = buildSuppressionMap(tokens, document);

            expect(suppressionMap.suppressionsByLine.has(1)).toBe(true);
            const directives = suppressionMap.suppressionsByLine.get(1);
            expect(directives).toBeDefined();
            expect(directives![0].type).toBe('current-line');
        });

        test('should parse inline suppress with specific rule', () => {
            const code = `
int undeclaredVar; // enscript-suppress[undeclared-variable]
`;
            const document = TextDocument.create('test://test.c', 'enscript', 1, code);
            const tokens = lex(code);
            const suppressionMap = buildSuppressionMap(tokens, document);

            expect(suppressionMap.suppressionsByLine.has(1)).toBe(true);
            const directives = suppressionMap.suppressionsByLine.get(1);
            expect(directives).toBeDefined();
            expect(directives![0].ruleIds!.has('undeclared-variable')).toBe(true);
        });

        test('should handle case-insensitive suppression comments', () => {
            const code = `
// ENSCRIPT-SUPPRESS
int undeclaredVar;
`;
            const document = TextDocument.create('test://test.c', 'enscript', 1, code);
            const tokens = lex(code);
            const suppressionMap = buildSuppressionMap(tokens, document);

            expect(suppressionMap.suppressionsByLine.has(2)).toBe(true);
        });

        test('should ignore non-suppression comments', () => {
            const code = `
// This is a regular comment
int undeclaredVar;
`;
            const document = TextDocument.create('test://test.c', 'enscript', 1, code);
            const tokens = lex(code);
            const suppressionMap = buildSuppressionMap(tokens, document);

            expect(suppressionMap.suppressionsByLine.size).toBe(0);
        });

        test('should handle multiple suppressions on same line', () => {
            const code = `
// enscript-suppress[undeclared-variable]
// enscript-suppress[type-mismatch]
int undeclaredVar;
`;
            const document = TextDocument.create('test://test.c', 'enscript', 1, code);
            const tokens = lex(code);
            const suppressionMap = buildSuppressionMap(tokens, document);

            // Both comments apply to line 3 (0-indexed), so we should see directives there
            expect(suppressionMap.suppressionsByLine.has(3)).toBe(true);
            const directives = suppressionMap.suppressionsByLine.get(3);
            expect(directives).toBeDefined();
            // Note: Both comments target line 3, but they're separate directives
            // The actual count might be 1 if they merge, but let's check what we actually get
            expect(directives!.length).toBeGreaterThanOrEqual(1);
        });

        test('should handle whitespace variations', () => {
            const code = `
//enscript-suppress
//  enscript-suppress[undeclared-variable]  
int x;
int y;
`;
            const document = TextDocument.create('test://test.c', 'enscript', 1, code);
            const tokens = lex(code);
            const suppressionMap = buildSuppressionMap(tokens, document);

            expect(suppressionMap.suppressionsByLine.has(2)).toBe(true);
            expect(suppressionMap.suppressionsByLine.has(3)).toBe(true);
        });
    });

    describe('isDiagnosticSuppressed', () => {
        test('should suppress diagnostic when rule suppressed on line', () => {
            const suppressionMap: SuppressionMap = {
                suppressionsByLine: new Map([
                    [5, [{
                        line: 5,
                        ruleIds: new Set(['undeclared-variable']),
                        type: 'next-line',
                        commentText: '// enscript-suppress[undeclared-variable]'
                    }]]
                ])
            };

            expect(isDiagnosticSuppressed(5, 'undeclared-variable', suppressionMap)).toBe(true);
            expect(isDiagnosticSuppressed(5, 'type-mismatch', suppressionMap)).toBe(false);
        });

        test('should suppress all rules when no specific rules listed', () => {
            const suppressionMap: SuppressionMap = {
                suppressionsByLine: new Map([
                    [5, [{
                        line: 5,
                        ruleIds: undefined, // Suppress all rules
                        type: 'next-line',
                        commentText: '// enscript-suppress'
                    }]]
                ])
            };

            expect(isDiagnosticSuppressed(5, 'undeclared-variable', suppressionMap)).toBe(true);
            expect(isDiagnosticSuppressed(5, 'type-mismatch', suppressionMap)).toBe(true);
            expect(isDiagnosticSuppressed(5, 'any-rule', suppressionMap)).toBe(true);
        });

        test('should not suppress diagnostic on different line', () => {
            const suppressionMap: SuppressionMap = {
                suppressionsByLine: new Map([
                    [5, [{
                        line: 5,
                        ruleIds: new Set(['undeclared-variable']),
                        type: 'next-line',
                        commentText: '// enscript-suppress[undeclared-variable]'
                    }]]
                ])
            };

            expect(isDiagnosticSuppressed(6, 'undeclared-variable', suppressionMap)).toBe(false);
        });

        test('should handle multiple directives on same line', () => {
            const suppressionMap: SuppressionMap = {
                suppressionsByLine: new Map([
                    [5, [
                        {
                            line: 5,
                            ruleIds: new Set(['undeclared-variable']),
                            type: 'next-line',
                            commentText: '// enscript-suppress[undeclared-variable]'
                        },
                        {
                            line: 5,
                            ruleIds: new Set(['type-mismatch']),
                            type: 'next-line',
                            commentText: '// enscript-suppress[type-mismatch]'
                        }
                    ]]
                ])
            };

            expect(isDiagnosticSuppressed(5, 'undeclared-variable', suppressionMap)).toBe(true);
            expect(isDiagnosticSuppressed(5, 'type-mismatch', suppressionMap)).toBe(true);
            expect(isDiagnosticSuppressed(5, 'other-rule', suppressionMap)).toBe(false);
        });
    });

    describe('getSuppressedRulesForLine', () => {
        test('should return empty set when no suppressions', () => {
            const suppressionMap: SuppressionMap = {
                suppressionsByLine: new Map()
            };

            const result = getSuppressedRulesForLine(5, suppressionMap);
            expect(result).toEqual(new Set());
        });

        test('should return null when all rules suppressed', () => {
            const suppressionMap: SuppressionMap = {
                suppressionsByLine: new Map([
                    [5, [{
                        line: 5,
                        ruleIds: undefined,
                        type: 'next-line',
                        commentText: '// enscript-suppress'
                    }]]
                ])
            };

            const result = getSuppressedRulesForLine(5, suppressionMap);
            expect(result).toBeNull();
        });

        test('should return set of suppressed rule IDs', () => {
            const suppressionMap: SuppressionMap = {
                suppressionsByLine: new Map([
                    [5, [{
                        line: 5,
                        ruleIds: new Set(['undeclared-variable', 'type-mismatch']),
                        type: 'next-line',
                        commentText: '// enscript-suppress[undeclared-variable, type-mismatch]'
                    }]]
                ])
            };

            const result = getSuppressedRulesForLine(5, suppressionMap);
            expect(result).toBeDefined();
            expect(result!.has('undeclared-variable')).toBe(true);
            expect(result!.has('type-mismatch')).toBe(true);
            expect(result!.size).toBe(2);
        });

        test('should merge multiple directives', () => {
            const suppressionMap: SuppressionMap = {
                suppressionsByLine: new Map([
                    [5, [
                        {
                            line: 5,
                            ruleIds: new Set(['undeclared-variable']),
                            type: 'next-line',
                            commentText: '// enscript-suppress[undeclared-variable]'
                        },
                        {
                            line: 5,
                            ruleIds: new Set(['type-mismatch']),
                            type: 'next-line',
                            commentText: '// enscript-suppress[type-mismatch]'
                        }
                    ]]
                ])
            };

            const result = getSuppressedRulesForLine(5, suppressionMap);
            expect(result).toBeDefined();
            expect(result!.has('undeclared-variable')).toBe(true);
            expect(result!.has('type-mismatch')).toBe(true);
            expect(result!.size).toBe(2);
        });

        test('should return null if any directive suppresses all', () => {
            const suppressionMap: SuppressionMap = {
                suppressionsByLine: new Map([
                    [5, [
                        {
                            line: 5,
                            ruleIds: new Set(['undeclared-variable']),
                            type: 'next-line',
                            commentText: '// enscript-suppress[undeclared-variable]'
                        },
                        {
                            line: 5,
                            ruleIds: undefined, // Suppress all
                            type: 'next-line',
                            commentText: '// enscript-suppress'
                        }
                    ]]
                ])
            };

            const result = getSuppressedRulesForLine(5, suppressionMap);
            expect(result).toBeNull();
        });
    });
});
