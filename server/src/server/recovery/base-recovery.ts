/**
 * Base recovery strategy that provides common recovery patterns and utilities
 * that can be extended by specific parser recovery strategies.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { TokenStream } from '../lexer/token-stream';
import { Token, TokenKind } from '../lexer/token';
import { ParseError, ParseWarning } from '../ast/errors';
import { RecoveryAction, RecoveryResult } from './recovery-actions';
import { declarationKeywords, keywords } from '../lexer/rules';

/**
 * Error context information for better diagnostics
 */
export interface ErrorContext {
    expected: string;
    actual: string;
    suggestions?: string[];
    context?: string;
}

/**
 * Configuration for recovery behavior
 */
export interface RecoveryConfig {
    maxRecoverySteps: number;
    lenientSemicolons: boolean;
    suppressStylisticWarnings: boolean;
    completionMode?: boolean;
}

/**
 * Base class for all recovery strategies providing common utilities and patterns
 */
export abstract class BaseRecoveryStrategy {
    protected readonly MAX_RECOVERY_STEPS: number;

    constructor(
        protected document: TextDocument,
        protected config: RecoveryConfig = { maxRecoverySteps: 25, lenientSemicolons: false, suppressStylisticWarnings: false },
        protected onWarning?: (message: string, line: number, character: number) => void,
        protected onError?: (message: string, line: number, character: number) => void
    ) {
        this.MAX_RECOVERY_STEPS = config.maxRecoverySteps;
    }

    /**
     * Skip tokens until a recovery point is found
     */
    public skipToRecoveryPoint(
        tokenStream: TokenStream, 
        recoveryTokens: string[], 
        recoveryKeywords: TokenKind[] = [],
        context?: string
    ): RecoveryResult {
        let steps = 0;
        let recoveredToPoint = false;
        const startPosition = tokenStream.getPosition();

        while (!tokenStream.eof() && steps < this.MAX_RECOVERY_STEPS) {
            const token = tokenStream.peek();
            const prevPos = tokenStream.getPosition();

            // Check for recovery delimiter tokens (semicolon, braces, etc.)
            if (recoveryTokens.includes(token.value)) {
                if (token.value === ';') {
                    tokenStream.next(); // consume semicolon
                }
                recoveredToPoint = true;
                break;
            }

            // Check for recovery keyword tokens
            if (recoveryKeywords.includes(token.kind)) {
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
     * Check if an error should be suppressed based on configuration
     */
    protected shouldSuppressError(message: string): boolean {
        if (!this.config.lenientSemicolons && !this.config.suppressStylisticWarnings) {
            return false;
        }

        const lowerMessage = message.toLowerCase();

        // Suppress semicolon-related errors when lenient mode is enabled
        if (this.config.lenientSemicolons && (
            lowerMessage.includes('semicolon') ||
            lowerMessage.includes('expected \';\'') ||
            (lowerMessage.includes('expected') && lowerMessage.includes('\';\'')))
        ) {
            return true;
        }

        // Suppress stylistic warnings when configured
        if (this.config.suppressStylisticWarnings && (
            lowerMessage.includes('comma') ||
            lowerMessage.includes('expected \',\'') ||
            lowerMessage.includes('expected \'}\'') ||
            (lowerMessage.includes('expected') && (lowerMessage.includes('\',\'') || lowerMessage.includes('\'}\'')))
        )) {
            return true;
        }

        // Suppress "Expected identifier" errors for common keywords in valid contexts
        if (this.config.suppressStylisticWarnings && lowerMessage.includes('expected identifier')) {
            if (lowerMessage.includes('got \'else\'') ||
                lowerMessage.includes('got \'break\'') ||
                lowerMessage.includes('got \'continue\'') ||
                lowerMessage.includes('got \'case\'') ||
                lowerMessage.includes('got \'default\'') ||
                lowerMessage.includes('got \'if\'') ||
                lowerMessage.includes('got \'for\'') ||
                lowerMessage.includes('got \'while\'') ||
                lowerMessage.includes('got \'switch\'') ||
                lowerMessage.includes('got \'return\'')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Generate contextual error messages for different token types
     */
    protected generateContextualErrorMessage(token: Token, context: string): string {
        switch (token.kind) {
            case TokenKind.KeywordType:
                return `Type keyword '${token.value}' found in ${context} context. Did you mean to declare a variable? (e.g., '${token.value} variableName = ...')`;
            
            case TokenKind.KeywordDeclaration:
                const declarationType = token.value === 'class' ? 'Class declarations' : 
                                       token.value === 'enum' ? 'Enum declarations' : 
                                       'Type declarations';
                return `Declaration keyword '${token.value}' found in ${context} context. ${declarationType} should be at the top level, not inside functions or methods.`;
            
            case TokenKind.KeywordModifier:
                return `Modifier keyword '${token.value}' found in ${context} context. Modifiers should be used with declarations (e.g., '${token.value} type variableName').`;
            
            case TokenKind.KeywordStorage:
                return `Storage keyword '${token.value}' found in ${context} context. Did you mean to declare a ${token.value} variable? (e.g., '${token.value} type variableName = value;')`;

            case TokenKind.KeywordControl:
                return `Control flow keyword '${token.value}' found in ${context} context. This keyword is used for control flow (loops, conditionals, etc.).`;

            case TokenKind.Punctuation:
                if (token.value === '}') {
                    return `Unexpected closing brace '}' - not part of any declaration`;
                } else if (token.value === ')') {
                    return `Unexpected closing parenthesis ')' - check for missing opening parenthesis or malformed expression`;
                } else if (token.value === ']') {
                    return `Unexpected closing bracket ']' - check for missing opening bracket or malformed array access`;
                }
                return `Unexpected punctuation '${token.value}' in ${context}`;
            
            default:
                return `Unexpected token: ${token.value}`;
        }
    }

    /**
     * Create a parse error with position information
     */
    public createParseError(message: string, token: Token, context?: ErrorContext): ParseError {
        const pos = this.document.positionAt(token.start);
        
        if (context) {
            return new ContextualParseError(
                this.document.uri,
                pos.line + 1,
                pos.character + 1,
                message,
                context
            );
        }
        
        return new ParseError(
            this.document.uri,
            pos.line + 1,
            pos.character + 1,
            message
        );
    }

    /**
     * Create a parse warning with position information
     */
    public createParseWarning(message: string, token: Token): ParseWarning {
        const pos = this.document.positionAt(token.start);
        
        return new ParseWarning(
            this.document.uri,
            pos.line + 1,
            pos.character + 1,
            message
        );
    }

    /**
     * Report warning using the configured callback
     */
    public reportWarning(message: string, position: Position): void {
        if (this.onWarning) {
            this.onWarning(message, position.line + 1, position.character + 1);
        }
    }

    /**
     * Report error using the configured callback
     */
    protected reportError(message: string, position: Position): void {
        if (this.onError) {
            this.onError(message, position.line + 1, position.character + 1);
        }
    }

    /**
     * Create error context for better error reporting
     */
    protected createErrorContext(token: Token, context: string, expected?: string, suggestions?: string[]): ErrorContext {
        return {
            expected: expected || `valid token in ${context}`,
            actual: token.value,
            suggestions,
            context
        };
    }

    /**
     * Check if a token indicates the start of a new declaration
     */
    protected isDeclarationStart(token: Token): boolean {
        return token.kind === TokenKind.KeywordDeclaration ||
               token.kind === TokenKind.KeywordModifier ||
               token.kind === TokenKind.KeywordType ||
               (token.kind === TokenKind.Identifier && this.isAnnotation(token));
    }

    /**
     * Check if a token is an annotation marker
     */
    protected isAnnotation(token: Token): boolean {
        return token.value.startsWith('[') && token.value.endsWith(']');
    }

    /**
     * Create a synthetic token for recovery purposes
     */
    protected createSyntheticToken(value: string, kind: TokenKind, position: number): Token {
        return {
            kind,
            value,
            start: position,
            end: position
        };
    }

    /**
     * Create common synthetic tokens for recovery scenarios
     */

    /**
     * Generic method to handle missing punctuation with synthetic token insertion
     */
    protected handleMissingPunctuation(
        expectedToken: string,
        position: number,
        context?: string,
        warnOnly: boolean = false
    ): RecoveryResult {
        const syntheticToken = this.createSyntheticToken(expectedToken, TokenKind.Punctuation, position);
        const contextStr = context ? ` in ${context}` : '';
        const message = `Missing ${expectedToken}${contextStr}`;

        if (warnOnly && this.onWarning) {
            const pos = this.document.positionAt(position);
            this.onWarning(message, pos.line + 1, pos.character + 1);
        }

        return {
            action: warnOnly ? RecoveryAction.WarnAndContinue : RecoveryAction.InsertSynthetic,
            message,
            syntheticToken
        };
    }

    /**
     * Common pattern for handling expected token failures
     */
    protected handleExpectedTokenGeneric(
        expected: string,
        actual: Token,
        context?: string,
        allowSynthetic: boolean = false
    ): RecoveryResult {
        const contextStr = context ? ` in ${context}` : '';
        const message = `Expected '${expected}', got '${actual.value}'${contextStr}`;

        // Check if we can create a synthetic token for common cases
        if (allowSynthetic) {
            if (expected === ';') {
                return this.handleMissingPunctuation(';', actual.start, context, true);
            }
            if (expected === '}') {
                return this.handleMissingPunctuation('}', actual.start, context);
            }
            if (expected === ')') {
                return this.handleMissingPunctuation(')', actual.start, context);
            }
            if (expected === ',') {
                return this.handleMissingPunctuation(',', actual.start, context);
            }
        }

        return {
            action: RecoveryAction.ThrowError,
            message,
            recoveredPosition: actual.start
        };
    }
}

/**
 * Extended ParseError with contextual information
 */
export class ContextualParseError extends ParseError {
    constructor(
        uri: string,
        line: number,
        column: number,
        message: string,
        public readonly context: ErrorContext
    ) {
        super(uri, line, column, message);
    }
}

/**
 * Helper function to check if a token is a type keyword
 */
export function isTypeKeyword(token: Token): boolean {
    return token.kind === TokenKind.KeywordType ||
           keywords.has(token.value);
}

/**
 * Helper function to check if a token is a declaration keyword
 */
export function isDeclarationKeyword(token: Token): boolean {
    return token.kind === TokenKind.KeywordDeclaration ||
           declarationKeywords.has(token.value);
}
