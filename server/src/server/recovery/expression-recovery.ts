/**
 * Expression Parser Recovery Strategies
 */

import { Token, TokenKind } from '../lexer/token';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { RecoveryAction, RecoveryResult } from './recovery-actions';
import { BaseRecoveryStrategy } from './base-recovery';

/**
 * Expression parser recovery strategies
 */
export class ExpressionRecoveryStrategy extends BaseRecoveryStrategy {
    constructor(
        document: TextDocument,
        onWarning?: (message: string, line: number, character: number) => void
    ) {
        super(document, {
            maxRecoverySteps: 25,
            lenientSemicolons: false,
            suppressStylisticWarnings: false
        }, onWarning);
    }

    /**
     * Handle missing comma in array literal
     */
    handleMissingCommaInArray(
        nextToken: Token,
        _context: 'nested-array' | 'literal-element'
    ): RecoveryResult {
        const pos = this.document.positionAt(nextToken.start);
        const message = 'Missing comma in array literal';

        // Report warning if callback is available
        if (this.onWarning) {
            this.onWarning(message, pos.line + 1, pos.character + 1);
        }

        return {
            action: RecoveryAction.WarnAndContinue,
            message
        };
    }

    /**
     * Handle token expectation failures with enhanced error messages
     */
    handleExpectedToken(
        expected: string,
        actual: Token
    ): RecoveryResult {
        // Handle special case: >> token splitting for nested generics
        if (expected === '>' && actual.value === '>>') {
            return this.handleNestedGenericTokenSplit(actual);
        }

        return {
            action: RecoveryAction.ThrowError,
            message: `Expected '${expected}', got '${actual.value}'`
        };
    }

    /**
     * Handle >> token splitting for nested generics
     */
    private handleNestedGenericTokenSplit(token: Token): RecoveryResult {
        const secondGreaterToken: Token = {
            kind: TokenKind.Operator,
            value: '>',
            start: token.start + 1,
            end: token.end
        };

        return {
            action: RecoveryAction.SplitToken,
            syntheticToken: secondGreaterToken,
            message: 'Split >> token for nested generics'
        };
    }

    /**
     * Generate enhanced error messages for identifier parsing
     */
    generateIdentifierError(token: Token): string {
        let errorMessage = `Expected identifier, got '${token.value}'`;

        // Provide context-specific suggestions
        if (token.kind === TokenKind.KeywordDeclaration || 
            token.kind === TokenKind.KeywordModifier ||
            token.kind === TokenKind.KeywordType ||
            token.kind === TokenKind.KeywordControl ||
            token.kind === TokenKind.KeywordStorage ||
            token.kind === TokenKind.KeywordLiteral) {
            errorMessage += `. '${token.value}' is a reserved keyword and cannot be used as an identifier.`;
        } else if (token.kind === TokenKind.Number) {
            errorMessage += `. Identifiers cannot start with numbers.`;
        } else if (token.kind === TokenKind.Punctuation) {
            if (token.value === '{' || token.value === '}') {
                errorMessage += `. This might indicate a missing semicolon or statement termination issue.`;
            } else if (token.value === '(' || token.value === ')') {
                errorMessage += `. Check for missing method call or expression syntax.`;
            }
        }

        return errorMessage;
    }

    /**
     * Generate enhanced error messages for expression context violations
     */
    generateExpressionContextError(token: Token): string {
        switch (token.kind) {
            case TokenKind.KeywordType:
                return `Type keyword '${token.value}' cannot be used in expression context. Did you mean to declare a variable? (e.g., '${token.value} variableName = ...')`;
            
            case TokenKind.KeywordDeclaration:
                return `Declaration keyword '${token.value}' cannot be used in expression context. This keyword is used to declare ${token.value === 'class' ? 'classes' : token.value === 'enum' ? 'enums' : 'types'}.`;
            
            case TokenKind.KeywordModifier:
                return `Modifier keyword '${token.value}' cannot be used in expression context. This keyword modifies declarations (e.g., 'static ${token.value}' or '${token.value} static').`;
            
            case TokenKind.KeywordControl:
                return `Control flow keyword '${token.value}' cannot be used in expression context. This keyword belongs in statement context.`;
            
            case TokenKind.KeywordStorage:
                return `Storage keyword '${token.value}' cannot be used in expression context. This keyword modifies variable declarations.`;
            
            default:
                return `Unexpected token: ${token.value}`;
        }
    }

    /**
     * Handle unexpected literal tokens
     */
    handleUnexpectedLiteral(token: Token): RecoveryResult {
        let message: string;
        
        if (token.kind === TokenKind.KeywordLiteral) {
            message = `Unexpected literal keyword: ${token.value}`;
        } else {
            message = `Unexpected literal token: ${token.value}`;
        }

        return {
            action: RecoveryAction.ThrowError,
            message
        };
    }

    /**
     * Handle cast expression validation errors
     */
    handleInvalidCastType(token: Token): RecoveryResult {
        return {
            action: RecoveryAction.ThrowError,
            message: `Expected type name in cast, got '${token.value}'`
        };
    }

    /**
     * Handle generic type parsing errors
     */
    handleGenericTypeError(expected: string, actual: Token): RecoveryResult {
        if (expected === 'type name') {
            return {
                action: RecoveryAction.ThrowError,
                message: `Expected type name, got ${actual.value}`
            };
        }

        return {
            action: RecoveryAction.ThrowError,
            message: `Expected '${expected}', got ${actual.value}`
        };
    }

    /**
     * Validate array literal element separation
     */
    validateArrayElementSeparation(
        nextToken: Token,
        _isLastElement: boolean = false
    ): RecoveryResult {
        if (nextToken.value === ',') {
            return { action: RecoveryAction.Continue };
        }

        if (nextToken.value === '}') {
            return { action: RecoveryAction.Continue };
        }

        // Check for missing comma scenarios
        if (nextToken.value === '{') {
            return this.handleMissingCommaInArray(nextToken, 'nested-array');
        }

        if (nextToken.kind === TokenKind.String || nextToken.kind === TokenKind.Number) {
            return this.handleMissingCommaInArray(nextToken, 'literal-element');
        }

        // Unexpected token - provide recovery guidance
        return {
            action: RecoveryAction.Skip,
            message: `Unexpected token in array literal: ${nextToken.value}`
        };
    }
}
