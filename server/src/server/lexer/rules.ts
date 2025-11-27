import { TokenKind } from './token';

// Categorized keywords for improved lexing and parsing
export const declarationKeywords = new Set([
    'class', 'enum', 'typedef'
]);

export const modifierKeywords = new Set([
    'override', 'private', 'protected', 'modded', 'proto', 
    'native', 'owned', 'local', 'sealed', 'external', 'event', 'static'
]);

export const typeKeywords = new Set([
    'auto', 'void', 'bool', 'int', 'float', 'string', 'Class'
]);

export const controlKeywords = new Set([
    'if', 'else', 'for', 'foreach', 'while', 'switch', 'case', 'default',
    'break', 'continue', 'return', 'extends', 'new', 'delete', 'thread'
]);

export const storageKeywords = new Set([
    'ref', 'reference', 'const', 'volatile', 'notnull', 'autoptr', 
    'out', 'inout'
]);

export const literalKeywords = new Set([
    'true', 'false', 'null', 'NULL'
]);

// Backward compatibility - all keywords combined
export const keywords = new Set([
    ...declarationKeywords,
    ...modifierKeywords,
    ...typeKeywords,
    ...controlKeywords,
    ...storageKeywords,
    ...literalKeywords
]);

// Map keywords to their specific token types
export const keywordToTokenKind = new Map<string, TokenKind>([
    ...Array.from(declarationKeywords).map(k => [k, TokenKind.KeywordDeclaration] as [string, TokenKind]),
    ...Array.from(modifierKeywords).map(k => [k, TokenKind.KeywordModifier] as [string, TokenKind]),
    ...Array.from(typeKeywords).map(k => [k, TokenKind.KeywordType] as [string, TokenKind]),
    ...Array.from(controlKeywords).map(k => [k, TokenKind.KeywordControl] as [string, TokenKind]),
    ...Array.from(storageKeywords).map(k => [k, TokenKind.KeywordStorage] as [string, TokenKind]),
    ...Array.from(literalKeywords).map(k => [k, TokenKind.KeywordLiteral] as [string, TokenKind])
]);

export const punct = '(){}[];:,.<>=';

