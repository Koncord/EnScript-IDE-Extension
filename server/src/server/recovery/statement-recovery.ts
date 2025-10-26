/**
 * Statement Parser Recovery Strategies
 */

import { Token, TokenKind } from '../lexer/token';
import { TokenStream } from '../lexer/token-stream';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { RecoveryAction, RecoveryResult } from './recovery-actions';
import { BaseRecoveryStrategy } from './base-recovery';

/**
 * Recovery point types for statement parsing
 */
export enum RecoveryPointType {
    Semicolon = ';',
    OpenBrace = '{',
    CloseBrace = '}',
    StatementKeyword = 'statement'
}

/**
 * Statement parser recovery strategies
 */
export class StatementRecoveryStrategy extends BaseRecoveryStrategy {
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
     * Skip to a recovery point for error handling
     */
    skipToStatementRecoveryPoint(
        tokenStream: TokenStream,
        context?: string
    ): RecoveryResult {
        let steps = 0;
        let recoveredToPoint = false;
        const startPosition = tokenStream.getPosition();

        while (!tokenStream.eof() && steps < this.config.maxRecoverySteps) {
            const token = tokenStream.peek();
            const prevPos = tokenStream.getPosition();

            // Recovery points: semicolon, braces, or statement keywords
            if (token.value === ';' || token.value === '}' || token.value === '{') {
                if (token.value === ';') {
                    tokenStream.next(); // consume semicolon
                }
                recoveredToPoint = true;
                break;
            }

            // Also stop at statement keywords
            if (token.kind === TokenKind.KeywordControl) {
                // Don't consume - let parser handle it
                recoveredToPoint = true;
                break;
            }

            tokenStream.next();

            // Infinite loop protection
            const newPos = tokenStream.getPosition();
            if (newPos === prevPos) {
                tokenStream.setPosition(Math.min(newPos + 1, tokenStream.getTokenCount()));
                break;
            }

            steps++;
        }

        const finalPosition = tokenStream.getPosition();
        
        let message: string;
        if (recoveredToPoint) {
            message = context ? 
                `Recovery completed for ${context}: skipped ${finalPosition - startPosition} tokens` :
                `Recovery completed: skipped ${finalPosition - startPosition} tokens`;
        } else {
            message = context ?
                `Recovery failed for ${context}: unable to find recovery point after ${finalPosition - startPosition} tokens` :
                `Recovery failed: unable to find recovery point after ${finalPosition - startPosition} tokens`;
        }

        return {
            action: recoveredToPoint ? RecoveryAction.Continue : RecoveryAction.ThrowError,
            message,
            recoveredPosition: finalPosition
        };
    }

    /**
     * Generate contextual error messages for statement-specific cases
     */
    protected generateContextualErrorMessage(token: Token, context: string): string {
        // Handle statement-specific cases
        if (context === 'statement' && token.value === 'else') {
            return `Unexpected 'else' token. This usually means the corresponding 'if' statement had parsing errors. Check the 'if' statement syntax above this line.`;
        }
        
        // Defer to base class for other cases
        return super.generateContextualErrorMessage(token, context);
    }

    /**
     * Handle unexpected tokens in statement context
     */
    handleUnexpectedToken(token: Token, context: string): RecoveryResult {
        const errorMessage = this.generateContextualErrorMessage(token, context);
        
        return {
            action: RecoveryAction.ThrowError,
            message: errorMessage
        };
    }



    /**
     * Handle expected token failures
     */
    handleExpectedToken(
        tokenStream: TokenStream,
        expected: string,
        actual: Token,
        context?: string
    ): RecoveryResult {
        const contextStr = context ? ` in ${context}` : '';
        const message = `Expected '${expected}', got '${actual.value}'${contextStr}`;
        
        // Special recovery for missing semicolons
        if (expected === ';') {
            return this.handleMissingSemicolon(actual, context);
        }

        // Special recovery for missing braces
        if (expected === '}') {
            return this.handleMissingCloseBrace(actual, context);
        }

        return {
            action: RecoveryAction.ThrowError,
            message
        };
    }

    /**
     * Handle missing semicolon scenarios
     */
    private handleMissingSemicolon(actual: Token, context?: string): RecoveryResult {
        // Create synthetic semicolon token
        const syntheticSemicolon: Token = {
            kind: TokenKind.Punctuation,
            value: ';',
            start: actual.start,
            end: actual.start
        };

        const contextStr = context ? ` in ${context}` : '';
        const message = `Missing semicolon${contextStr}`;

        // Report warning if callback is available
        if (this.onWarning) {
            const pos = this.document.positionAt(actual.start);
            this.onWarning(message, pos.line + 1, pos.character + 1);
        }

        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken: syntheticSemicolon
        };
    }

    /**
     * Handle missing closing brace scenarios
     */
    private handleMissingCloseBrace(actual: Token, context?: string): RecoveryResult {
        // Create synthetic closing brace token
        const syntheticBrace: Token = {
            kind: TokenKind.Punctuation,
            value: '}',
            start: actual.start,
            end: actual.start
        };

        const contextStr = context ? ` in ${context}` : '';
        const message = `Missing closing brace${contextStr}`;

        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken: syntheticBrace
        };
    }

    /**
     * Handle identifier expectation failures
     */
    handleExpectedIdentifier(actual: Token, context?: string): RecoveryResult {
        let message = `Expected identifier, got '${actual.value}'`;
        const suggestions: string[] = [];

        // Provide context-specific suggestions
        if (actual.kind === TokenKind.KeywordDeclaration || 
            actual.kind === TokenKind.KeywordModifier ||
            actual.kind === TokenKind.KeywordType ||
            actual.kind === TokenKind.KeywordControl ||
            actual.kind === TokenKind.KeywordStorage ||
            actual.kind === TokenKind.KeywordLiteral) {
            message += `. '${actual.value}' is a reserved keyword and cannot be used as an identifier.`;
            suggestions.push('Choose a different variable name');
        } else if (actual.kind === TokenKind.Number) {
            message += `. Identifiers cannot start with numbers.`;
            suggestions.push('Start identifier with a letter or underscore');
        } else if (actual.kind === TokenKind.Punctuation) {
            if (actual.value === '{' || actual.value === '}') {
                message += `. This might indicate a missing semicolon or statement termination issue.`;
                suggestions.push('Check for missing semicolon before this token');
            } else if (actual.value === '(' || actual.value === ')') {
                message += `. Check for missing method call or expression syntax.`;
                suggestions.push('Verify function call syntax');
            }
        }

        if (context) {
            message += ` (in ${context})`;
        }

        return {
            action: RecoveryAction.ThrowError,
            message
        };
    }

    /**
     * Handle infinite loop detection in parsing
     */
    handleInfiniteLoopDetection(iterationCount: number, context: string): RecoveryResult {
        return {
            action: RecoveryAction.ThrowError,
            message: `Infinite loop detected in ${context} after ${iterationCount} iterations`
        };
    }

    /**
     * Handle token stream advancement failures
     */
    handleTokenStreamStuck(context: string): RecoveryResult {
        return {
            action: RecoveryAction.ThrowError,
            message: `Token stream not advancing in ${context}`
        };
    }

    /**
     * Validate block statement structure
     */
    validateBlockStructure(
        tokenStream: TokenStream,
        hasOpenBrace: boolean,
        statementCount: number
    ): RecoveryResult {
        if (!hasOpenBrace) {
            return {
                action: RecoveryAction.ThrowError,
                message: 'Block statement must start with opening brace'
            };
        }

        // Check for empty blocks that might indicate syntax errors
        if (statementCount === 0 && !tokenStream.eof()) {
            const nextToken = tokenStream.peek();
            if (nextToken.value !== '}') {
                return {
                    action: RecoveryAction.SkipToCloseBrace,
                    message: 'Empty block with unexpected tokens'
                };
            }
        }

        return {
            action: RecoveryAction.Continue
        };
    }
}
