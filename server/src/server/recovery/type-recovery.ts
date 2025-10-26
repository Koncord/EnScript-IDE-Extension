/**
 * Type recovery strategy for handling type parsing, generic type arguments, and type modifier errors
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenStream } from '../lexer/token-stream';
import { Token, TokenKind } from '../lexer/token';
import { BaseRecoveryStrategy, RecoveryConfig, isTypeKeyword } from './base-recovery';
import { RecoveryAction, RecoveryResult } from './recovery-actions';

/**
 * Specific recovery actions for type parsing
 */
export enum TypeRecoveryAction {
    Continue = 'continue',
    SkipToGenericEnd = 'skip_to_generic_end',
    SkipToTypeEnd = 'skip_to_type_end',
    SplitToken = 'split_token',
    ThrowError = 'throw_error',
    InsertSynthetic = 'insert_synthetic',
    WarnAndContinue = 'warn_continue'
}



/**
 * Recovery strategy for handling type parsing errors
 */
export class TypeRecoveryStrategy extends BaseRecoveryStrategy {

    constructor(
        document: TextDocument,
        config?: RecoveryConfig,
        onWarning?: (message: string, line: number, character: number) => void,
        onError?: (message: string, line: number, character: number) => void
    ) {
        super(document, config, onWarning, onError);
    }

    /**
     * Handle errors when parsing basic types
     */
    handleBasicTypeError(tokenStream: TokenStream, error: string, context?: string): RecoveryResult {
        const currentToken = tokenStream.peek();
        
        // Check for common basic type errors
        if (error.includes('expected type identifier') || error.includes('invalid type')) {
            return this.handleInvalidType(tokenStream, currentToken, context);
        }
        
        if (error.includes('unexpected modifier')) {
            return this.handleUnexpectedModifier(tokenStream, currentToken);
        }

        // Generic recovery - skip to type boundary
        return this.skipToTypeEnd(tokenStream, 'basic type');
    }

    /**
     * Handle errors when parsing generic type arguments
     */
    handleGenericTypeError(tokenStream: TokenStream, error: string, context?: string): RecoveryResult {
        const currentToken = tokenStream.peek();
        
        // Check for common generic type errors
        if (error.includes('expected \'>\'') || error.includes('unclosed generic')) {
            return this.handleUnclosedGeneric(tokenStream, currentToken);
        }
        
        if (error.includes('expected type argument')) {
            return this.handleMissingTypeArgument(tokenStream, currentToken);
        }
        
        if (error.includes('too many \'>\'') || error.includes('>>' )) {
            return this.handleNestedGenericEnd(tokenStream, currentToken);
        }

        if (error.includes('expected \',\' between type arguments')) {
            return this.handleMissingGenericComma(tokenStream, currentToken);
        }

        // Generic recovery - skip to generic end
        return this.skipToGenericEnd(tokenStream, context || 'generic type');
    }

    /**
     * Handle errors when parsing array type dimensions
     */
    handleArrayTypeError(tokenStream: TokenStream, error: string, context?: string): RecoveryResult {
        const currentToken = tokenStream.peek();
        
        // Check for common array type errors
        if (error.includes('expected \']\'') || error.includes('unclosed array dimension')) {
            return this.handleUnclosedArrayDimension(tokenStream, currentToken);
        }
        
        if (error.includes('expected array size')) {
            return this.handleMissingArraySize(tokenStream, currentToken);
        }

        // Generic recovery
        return this.skipToArrayEnd(tokenStream, context || 'array type');
    }

    /**
     * Handle errors when parsing type modifiers (ref, out, inout, const)
     */
    handleTypeModifierError(tokenStream: TokenStream, error: string, _context?: string): RecoveryResult {
        const currentToken = tokenStream.peek();
        
        // Check for common modifier errors
        if (error.includes('conflicting modifiers') || error.includes('duplicate modifier')) {
            return this.handleConflictingModifiers(tokenStream, currentToken);
        }
        
        if (error.includes('modifier in wrong position')) {
            return this.handleMisplacedModifier(tokenStream, currentToken);
        }

        // Generic recovery - continue parsing
        return {
            action: RecoveryAction.Continue,
            message: `Ignored problematic type modifier: ${currentToken.value}`,
            typeContext: 'modifier'
        };
    }

    /**
     * Skip to the end of a generic type declaration
     */
    private skipToGenericEnd(tokenStream: TokenStream, context: string): RecoveryResult {
        let depth = 0;
        let steps = 0;
        const startPosition = tokenStream.getPosition();

        while (!tokenStream.eof() && steps < this.MAX_RECOVERY_STEPS) {
            const token = tokenStream.peek();

            if (token.value === '<') {
                depth++;
            } else if (token.value === '>') {
                depth--;
                if (depth <= 0) {
                    tokenStream.next(); // consume the closing >
                    break;
                }
            } else if (token.value === '>>' && depth > 0) {
                // Handle nested generics like map<string, array<int>>
                depth -= 2;
                if (depth <= 0) {
                    // Split >> token if needed
                    return this.splitNestedGenericToken(tokenStream, token);
                }
            } else if (depth === 0 && (token.value === ';' || token.value === ',' || token.value === ')' || token.value === '}')) {
                // Hit a boundary at depth 0, stop here
                break;
            }

            tokenStream.next();
            steps++;
        }

        const finalPosition = tokenStream.getPosition();
        const message = `Recovery completed for ${context}: skipped ${finalPosition - startPosition} tokens`;

        return {
            action: RecoveryAction.Continue,
            message,
            recoveredPosition: finalPosition,
            typeContext: 'generic'
        };
    }

    /**
     * Skip to the end of a basic type declaration
     */
    private skipToTypeEnd(tokenStream: TokenStream, context: string): RecoveryResult {
        const recoveryTokens = [';', ',', ')', '}', '=', '{'];
        const recoveryKeywords = [TokenKind.Identifier]; // Next identifier might be variable name
        
        const baseResult = this.skipToRecoveryPoint(
            tokenStream, 
            recoveryTokens, 
            recoveryKeywords,
            context
        );

        return {
            action: baseResult.action === RecoveryAction.Continue ? 
                RecoveryAction.Continue : 
                RecoveryAction.ThrowError,
            message: baseResult.message,
            recoveredPosition: baseResult.recoveredPosition,
            typeContext: 'basic'
        };
    }

    /**
     * Skip to the end of array dimension
     */
    private skipToArrayEnd(tokenStream: TokenStream, context: string): RecoveryResult {
        let depth = 0;
        let steps = 0;
        const startPosition = tokenStream.getPosition();

        while (!tokenStream.eof() && steps < this.MAX_RECOVERY_STEPS) {
            const token = tokenStream.peek();

            if (token.value === '[') {
                depth++;
            } else if (token.value === ']') {
                depth--;
                if (depth <= 0) {
                    tokenStream.next(); // consume the closing ]
                    break;
                }
            } else if (depth === 0 && (token.value === ';' || token.value === ',' || token.value === ')' || token.value === '}')) {
                // Hit a boundary at depth 0, stop here
                break;
            }

            tokenStream.next();
            steps++;
        }

        const finalPosition = tokenStream.getPosition();
        const message = `Recovery completed for ${context}: skipped ${finalPosition - startPosition} tokens`;

        return {
            action: RecoveryAction.Continue,
            message,
            recoveredPosition: finalPosition,
            typeContext: 'array'
        };
    }

    /**
     * Handle invalid type identifier
     */
    private handleInvalidType(tokenStream: TokenStream, token: Token, _context?: string): RecoveryResult {
        // Check if it's a keyword that might be valid in this context
        if (isTypeKeyword(token)) {
            return {
                action: RecoveryAction.Continue,
                message: `Accepted '${token.value}' as valid type identifier`,
                typeContext: 'basic'
            };
        }

        // Generate synthetic type name
        const syntheticType = 'UnknownType';
        const message = `Invalid type identifier '${token.value}'. Using '${syntheticType}' instead`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        const syntheticToken = this.createSyntheticToken(syntheticType, TokenKind.Identifier, token.start);
        
        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken,
            typeContext: 'basic'
        };
    }

    /**
     * Handle unexpected modifier in type context
     */
    private handleUnexpectedModifier(tokenStream: TokenStream, token: Token): RecoveryResult {
        const message = `Unexpected modifier '${token.value}' in type context. Skipping modifier`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        tokenStream.next(); // Skip the problematic modifier
        
        return {
            action: RecoveryAction.Continue,
            message,
            typeContext: 'modifier'
        };
    }

    /**
     * Handle unclosed generic type arguments
     */
    private handleUnclosedGeneric(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticToken = this.createSyntheticToken('>', TokenKind.Punctuation, token.start);
        const message = `Missing closing '>' for generic type arguments`;
        
        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken,
            typeContext: 'generic'
        };
    }

    /**
     * Handle missing type argument in generic
     */
    private handleMissingTypeArgument(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticType = 'MissingType';
        const syntheticToken = this.createSyntheticToken(syntheticType, TokenKind.Identifier, token.start);
        const message = `Missing type argument in generic. Using '${syntheticType}'`;
        
        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken,
            typeContext: 'generic'
        };
    }

    /**
     * Handle nested generic end tokens (>>)
     */
    private handleNestedGenericEnd(tokenStream: TokenStream, token: Token): RecoveryResult {
        if (token.value === '>>') {
            return this.splitNestedGenericToken(tokenStream, token);
        }

        const message = `Too many closing '>' tokens in generic type`;
        
        return {
            action: RecoveryAction.WarnAndContinue,
            message,
            typeContext: 'generic'
        };
    }

    /**
     * Split >> token into two > tokens for nested generics
     */
    private splitNestedGenericToken(tokenStream: TokenStream, token: Token): RecoveryResult {
        // Create two '>' tokens from the '>>' token
        const firstToken = this.createSyntheticToken('>', TokenKind.Punctuation, token.start);
        const secondToken = this.createSyntheticToken('>', TokenKind.Punctuation, token.start + 1);
        
        tokenStream.next(); // consume the >> token
        
        return {
            action: RecoveryAction.SplitToken,
            message: `Split '>>' token into two '>' tokens for nested generics`,
            splitTokens: [firstToken, secondToken],
            typeContext: 'generic'
        };
    }

    /**
     * Handle missing comma between generic type arguments
     */
    private handleMissingGenericComma(tokenStream: TokenStream, token: Token): RecoveryResult {
        const result = this.handleMissingPunctuation(',', token.start, 'comma between generic type arguments');
        result.typeContext = 'generic';
        return result;
    }

    /**
     * Handle unclosed array dimension
     */
    private handleUnclosedArrayDimension(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticToken = this.createSyntheticToken(']', TokenKind.Punctuation, token.start);
        const message = `Missing closing ']' for array dimension`;
        
        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken,
            typeContext: 'array'
        };
    }

    /**
     * Handle missing array size
     */
    private handleMissingArraySize(_tokenStream: TokenStream, _token: Token): RecoveryResult {
        // Array dimensions can be empty in EnScript
        const message = `Empty array dimension - this is valid in EnScript`;
        
        return {
            action: RecoveryAction.Continue,
            message,
            typeContext: 'array'
        };
    }

    /**
     * Handle conflicting type modifiers
     */
    private handleConflictingModifiers(tokenStream: TokenStream, token: Token): RecoveryResult {
        const message = `Conflicting type modifier '${token.value}'. Skipping duplicate modifier`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        tokenStream.next(); // Skip the conflicting modifier
        
        return {
            action: RecoveryAction.Continue,
            message,
            typeContext: 'modifier'
        };
    }

    /**
     * Handle misplaced type modifiers
     */
    private handleMisplacedModifier(tokenStream: TokenStream, token: Token): RecoveryResult {
        const message = `Modifier '${token.value}' in wrong position. Consider moving it before the type`;
        
        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        // Continue parsing but note the issue
        return {
            action: RecoveryAction.WarnAndContinue,
            message,
            typeContext: 'modifier'
        };
    }
}

