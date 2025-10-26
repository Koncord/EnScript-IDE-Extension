/**
 * Preprocessor recovery strategy for handling conditional compilation directive errors
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenStream } from '../lexer/token-stream';
import { Token, TokenKind } from '../lexer/token';
import { BaseRecoveryStrategy, RecoveryConfig } from './base-recovery';
import { RecoveryAction, RecoveryResult } from './recovery-actions';

/**
 * Recovery strategy for handling preprocessor parsing errors
 */
export class PreprocessorRecoveryStrategy extends BaseRecoveryStrategy {

    constructor(
        document: TextDocument,
        config?: RecoveryConfig,
        onWarning?: (message: string, line: number, character: number) => void,
        onError?: (message: string, line: number, character: number) => void
    ) {
        super(document, config, onWarning, onError);
    }

    /**
     * Handle errors when parsing conditional directives (#ifdef, #ifndef, #if)
     */
    handleConditionalDirectiveError(tokenStream: TokenStream, error: string, directive: string): RecoveryResult {
        const currentToken = tokenStream.peek();
        
        // Check for common conditional directive errors
        if (error.includes('expected condition') || error.includes('missing condition expression')) {
            return this.handleMissingCondition(tokenStream, currentToken, directive);
        }
        
        if (error.includes('unmatched') && error.includes('endif')) {
            return this.handleUnmatchedEndif(tokenStream, currentToken);
        }
        
        if (error.includes('unmatched') && error.includes('else')) {
            return this.handleUnmatchedElse(tokenStream, currentToken);
        }
        
        if (error.includes('nested conditional too deep')) {
            return this.handleNestedConditionalOverflow(tokenStream, currentToken);
        }

        // Generic recovery - skip to next preprocessor directive
        return this.skipToNextDirective(tokenStream, directive);
    }

    /**
     * Handle errors when parsing #define directives
     */
    handleDefineDirectiveError(tokenStream: TokenStream, error: string): RecoveryResult {
        const currentToken = tokenStream.peek();
        
        // Check for common #define errors
        if (error.includes('expected macro name') || error.includes('missing identifier')) {
            return this.handleMissingMacroName(tokenStream, currentToken);
        }
        
        if (error.includes('malformed macro parameters')) {
            return this.handleMalformedMacroParams(tokenStream, currentToken);
        }
        
        if (error.includes('macro redefinition')) {
            return this.handleMacroRedefinition(tokenStream, currentToken);
        }

        // Generic recovery
        return this.skipToNextDirective(tokenStream, 'define');
    }

    /**
     * Handle errors when parsing #include directives
     */
    handleIncludeDirectiveError(tokenStream: TokenStream, error: string): RecoveryResult {
        const currentToken = tokenStream.peek();
        
        // Check for common #include errors
        if (error.includes('expected filename') || error.includes('missing include path')) {
            return this.handleMissingIncludePath(tokenStream, currentToken);
        }
        
        if (error.includes('invalid include path format')) {
            return this.handleInvalidIncludeFormat(tokenStream, currentToken);
        }

        // Generic recovery
        return this.skipToNextDirective(tokenStream, 'include');
    }

    /**
     * Handle errors in preprocessor condition expressions
     */
    handleConditionExpressionError(tokenStream: TokenStream, error: string): RecoveryResult {
        const currentToken = tokenStream.peek();
        
        // Check for common condition expression errors
        if (error.includes('undefined identifier')) {
            return this.handleUndefinedIdentifier(tokenStream, currentToken);
        }
        
        if (error.includes('invalid operator') || error.includes('malformed expression')) {
            return this.handleMalformedExpression(tokenStream, currentToken);
        }
        
        if (error.includes('unbalanced parentheses')) {
            return this.handleUnbalancedParentheses(tokenStream, currentToken);
        }

        // Generic recovery - skip to end of line
        return this.skipToEndOfLine(tokenStream);
    }

    /**
     * Skip to the next preprocessor directive
     */
    private skipToNextDirective(tokenStream: TokenStream, currentDirective: string): RecoveryResult {
        let steps = 0;
        const _startPosition = tokenStream.getPosition();

        while (!tokenStream.eof() && steps < this.MAX_RECOVERY_STEPS) {
            const token = tokenStream.peek();

            // Found a preprocessor directive
            if (token.kind === TokenKind.Preproc) {
                break;
            }

            // Also stop at certain recovery points
            if (token.value === '}' || token.kind === TokenKind.KeywordDeclaration) {
                break;
            }

            tokenStream.next();
            steps++;
        }

        const finalPosition = tokenStream.getPosition();
        const message = `Recovery from ${currentDirective} directive: skipped ${finalPosition - _startPosition} tokens`;

        return {
            action: RecoveryAction.Continue,
            message,
            recoveredPosition: finalPosition,
            directiveType: this.getDirectiveType(currentDirective)
        };
    }

    /**
     * Skip to matching #endif for current conditional block
     */
    private skipToEndif(tokenStream: TokenStream, context: string): RecoveryResult {
        let depth = 1; // We're already inside one conditional
        let steps = 0;

        while (!tokenStream.eof() && steps < this.MAX_RECOVERY_STEPS && depth > 0) {
            const token = tokenStream.peek();

            if (token.kind === TokenKind.Preproc) {
                const directive = this.extractDirectiveName(token.value);
                
                if (directive === 'ifdef' || directive === 'ifndef' || directive === 'if') {
                    depth++;
                } else if (directive === 'endif') {
                    depth--;
                    if (depth === 0) {
                        tokenStream.next(); // consume the #endif
                        break;
                    }
                }
            }

            tokenStream.next();
            steps++;
        }

        const finalPosition = tokenStream.getPosition();
        const message = depth === 0 ? 
            `Recovery completed: found matching #endif` :
            `Recovery failed: no matching #endif found for ${context}`;

        return {
            action: depth === 0 ? RecoveryAction.Continue : RecoveryAction.ThrowError,
            message,
            recoveredPosition: finalPosition,
            skipTarget: 'endif'
        };
    }

    /**
     * Skip to end of current line (for single-line directives)
     */
    private skipToEndOfLine(tokenStream: TokenStream): RecoveryResult {
        let steps = 0;

        while (!tokenStream.eof() && steps < this.MAX_RECOVERY_STEPS) {
            const token = tokenStream.peek();

            // Check for line ending or next directive
            if (token.kind === TokenKind.Preproc || 
                token.kind === TokenKind.KeywordDeclaration ||
                token.value === '\n') {
                break;
            }

            tokenStream.next();
            steps++;
        }

        const finalPosition = tokenStream.getPosition();
        const message = `Recovery: skipped to end of preprocessor line`;

        return {
            action: RecoveryAction.Continue,
            message,
            recoveredPosition: finalPosition
        };
    }

    /**
     * Handle missing condition in conditional directive
     */
    private handleMissingCondition(tokenStream: TokenStream, token: Token, directive: string): RecoveryResult {
        const syntheticCondition = '1'; // Default to true condition
        const syntheticToken = this.createSyntheticToken(syntheticCondition, TokenKind.Number, token.start);
        const message = `Missing condition in #${directive}. Using '${syntheticCondition}' as default`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken,
            directiveType: this.getDirectiveType(directive)
        };
    }

    /**
     * Handle unmatched #endif
     */
    private handleUnmatchedEndif(tokenStream: TokenStream, token: Token): RecoveryResult {
        const message = `Unmatched #endif directive - no corresponding #ifdef, #ifndef, or #if`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        // Skip the unmatched #endif
        tokenStream.next();

        return {
            action: RecoveryAction.Continue,
            message,
            directiveType: 'endif'
        };
    }

    /**
     * Handle unmatched #else
     */
    private handleUnmatchedElse(tokenStream: TokenStream, token: Token): RecoveryResult {
        const message = `Unmatched #else directive - no corresponding #ifdef, #ifndef, or #if`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        // Skip the unmatched #else
        tokenStream.next();

        return {
            action: RecoveryAction.Continue,
            message,
            directiveType: 'else'
        };
    }

    /**
     * Handle nested conditional overflow
     */
    private handleNestedConditionalOverflow(tokenStream: TokenStream, token: Token): RecoveryResult {
        const message = `Nested conditional directives too deep - consider simplifying preprocessor logic`;
        
        const pos = this.document.positionAt(token.start);
        this.reportWarning(message, pos);

        // Continue parsing but warn about complexity
        return {
            action: RecoveryAction.WarnAndContinue,
            message,
            directiveType: 'ifdef'
        };
    }

    /**
     * Handle missing macro name in #define
     */
    private handleMissingMacroName(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticName = `MISSING_MACRO_${token.start}`;
        const syntheticToken = this.createSyntheticToken(syntheticName, TokenKind.Identifier, token.start);
        const message = `Missing macro name in #define. Using '${syntheticName}'`;
        
        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken,
            directiveType: 'define'
        };
    }

    /**
     * Handle malformed macro parameters
     */
    private handleMalformedMacroParams(tokenStream: TokenStream, _token: Token): RecoveryResult {
        // Skip to end of parameter list or end of line
        let depth = 0;
        while (!tokenStream.eof()) {
            const current = tokenStream.peek();
            
            if (current.value === '(') {
                depth++;
            } else if (current.value === ')') {
                depth--;
                if (depth <= 0) {
                    tokenStream.next(); // consume closing paren
                    break;
                }
            } else if (depth === 0 && (current.kind === TokenKind.Preproc || current.value === '\n')) {
                break;
            }
            
            tokenStream.next();
        }

        const message = `Recovered from malformed macro parameters`;
        
        return {
            action: RecoveryAction.Continue,
            message,
            directiveType: 'define'
        };
    }

    /**
     * Handle macro redefinition
     */
    private handleMacroRedefinition(tokenStream: TokenStream, token: Token): RecoveryResult {
        const message = `Macro redefinition - previous definition will be overwritten`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        return {
            action: RecoveryAction.WarnAndContinue,
            message,
            directiveType: 'define'
        };
    }

    /**
     * Handle missing include path
     */
    private handleMissingIncludePath(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticPath = '"missing_file.h"';
        const syntheticToken = this.createSyntheticToken(syntheticPath, TokenKind.String, token.start);
        const message = `Missing include path. Using ${syntheticPath}`;
        
        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken,
            directiveType: 'include'
        };
    }

    /**
     * Handle invalid include format
     */
    private handleInvalidIncludeFormat(tokenStream: TokenStream, token: Token): RecoveryResult {
        const message = `Invalid include path format. Expected "filename" or <filename>`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        return {
            action: RecoveryAction.WarnAndContinue,
            message,
            directiveType: 'include'
        };
    }

    /**
     * Handle undefined identifier in condition
     */
    private handleUndefinedIdentifier(tokenStream: TokenStream, token: Token): RecoveryResult {
        const message = `Undefined identifier '${token.value}' in preprocessor condition. Treating as 0`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        // Replace with 0 (false)
        const syntheticToken = this.createSyntheticToken('0', TokenKind.Number, token.start);
        
        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken
        };
    }

    /**
     * Handle malformed expression in condition
     */
    private handleMalformedExpression(tokenStream: TokenStream, _token: Token): RecoveryResult {
        // Skip to end of line
        return this.skipToEndOfLine(tokenStream);
    }

    /**
     * Handle unbalanced parentheses in condition
     */
    private handleUnbalancedParentheses(tokenStream: TokenStream, token: Token): RecoveryResult {
        const message = `Unbalanced parentheses in preprocessor condition`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        // Try to balance by adding missing closing paren
        const syntheticToken = this.createSyntheticToken(')', TokenKind.Punctuation, token.start);
        
        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken
        };
    }

    /**
     * Extract directive name from preprocessor token
     */
    private extractDirectiveName(preprocValue: string): string {
        // Remove # prefix and get first word
        const withoutHash = preprocValue.startsWith('#') ? preprocValue.substring(1) : preprocValue;
        const firstWord = withoutHash.trim().split(/\s+/)[0];
        return firstWord.toLowerCase();
    }

    /**
     * Convert directive name to typed enum value
     */
    private getDirectiveType(directive: string): 'ifdef' | 'ifndef' | 'if' | 'else' | 'elif' | 'endif' | 'define' | 'undef' | 'include' {
        const lower = directive.toLowerCase();
        switch (lower) {
            case 'ifdef': return 'ifdef';
            case 'ifndef': return 'ifndef';
            case 'if': return 'if';
            case 'else': return 'else';
            case 'elif': return 'elif';
            case 'endif': return 'endif';
            case 'define': return 'define';
            case 'undef': return 'undef';
            case 'include': return 'include';
            default: return 'ifdef'; // fallback
        }
    }
}

