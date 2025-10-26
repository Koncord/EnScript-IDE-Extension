/**
 * Declaration recovery strategy for handling class, function, enum, and variable declaration parsing errors
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenStream } from '../lexer/token-stream';
import { Token, TokenKind } from '../lexer/token';
import { BaseRecoveryStrategy, RecoveryConfig, isDeclarationKeyword } from './base-recovery';
import { RecoveryAction, RecoveryResult } from './recovery-actions';

/**
 * Recovery strategy for handling declaration parsing errors
 */
export class DeclarationRecoveryStrategy extends BaseRecoveryStrategy {

    constructor(
        document: TextDocument,
        config?: RecoveryConfig,
        onWarning?: (message: string, line: number, character: number) => void,
        onError?: (message: string, line: number, character: number) => void
    ) {
        super(document, config, onWarning, onError);
    }

    /**
     * Handle errors when parsing class declarations
     */
    handleClassDeclarationError(tokenStream: TokenStream, error: string, context?: string): RecoveryResult {
        const currentToken = tokenStream.peek();

        // Check for common class declaration errors
        if (error.includes('expected class name') || error.includes('expected identifier')) {
            return this.handleMissingClassName(tokenStream, currentToken);
        }

        if (error.includes('expected \'{\' after class name')) {
            return this.handleMissingClassBody(tokenStream, currentToken);
        }

        if (error.includes('unexpected token in class body')) {
            return this.skipToClassMember(tokenStream, context);
        }

        // Handle context-specific cases
        if (context === 'missing_closing_brace') {
            return this.skipToClassMember(tokenStream, context);
        }

        if (context === 'missing_name') {
            return this.handleMissingClassName(tokenStream, currentToken);
        }

        // Handle inheritance context - need to determine if it's invalid or missing
        if (context === 'inheritance') {
            // Scan the token stream to find the inheritance part
            const originalPos = tokenStream.getPosition();
            let foundColon = false;
            let afterColonToken: Token | null = null;

            // Look for the colon and what comes after it
            for (let i = 0; i < 10 && !tokenStream.eof(); i++) {
                const token = tokenStream.peek();
                if (token.value === ':') {
                    foundColon = true;
                    tokenStream.next(); // Move past colon
                    if (!tokenStream.eof()) {
                        afterColonToken = tokenStream.peek();
                    }
                    break;
                }
                tokenStream.next();
            }

            // Restore position
            tokenStream.setPosition(originalPos);

            if (foundColon && afterColonToken) {
                if (afterColonToken.kind === TokenKind.Number) {
                    return this.handleInvalidInheritance(tokenStream, currentToken);
                } else if (afterColonToken.value === '{') {
                    return this.handleMissingParentClassName(tokenStream, currentToken);
                }
            }
        }

        // Check for inheritance-related errors
        if (error.includes('invalid inheritance') || error.includes('invalid parent class')) {
            return this.handleInvalidInheritance(tokenStream, currentToken);
        }

        if (error.includes('missing parent class name')) {
            return this.handleMissingParentClassName(tokenStream, currentToken);
        }

        // Generic recovery - skip to next declaration
        return this.skipToNextDeclaration(tokenStream, 'class declaration');
    }

    /**
     * Handle errors when parsing function declarations
     */
    handleFunctionDeclarationError(tokenStream: TokenStream, error: string, context?: string): RecoveryResult {
        const currentToken = tokenStream.peek();

        // Check for context-specific cases first
        if (context === 'missing_params') {
            return this.handleMissingParametersSynthetic(tokenStream, currentToken);
        }

        if (context === 'invalid_param_syntax') {
            return this.handleInvalidParameterSyntax(tokenStream, currentToken);
        }

        // Check for common function declaration errors
        if (error.includes('expected function name') || error.includes('expected identifier')) {
            return this.handleMissingFunctionName(tokenStream, currentToken);
        }

        if (error.includes('expected \'(\' after function name')) {
            return this.handleMissingParameterList(tokenStream, currentToken);
        }

        if (error.includes('malformed parameter list')) {
            return this.handleMalformedParameterList(tokenStream, currentToken);
        }

        if (error.includes('expected function body')) {
            return this.handleMissingFunctionBody(tokenStream, currentToken);
        }

        // Generic recovery - skip to next declaration
        return this.skipToNextDeclaration(tokenStream, 'function declaration');
    }

    /**
     * Handle errors when parsing enum declarations
     */
    handleEnumDeclarationError(tokenStream: TokenStream, error: string, context?: string): RecoveryResult {
        const currentToken = tokenStream.peek();

        // Check for context-specific cases first
        if (context === 'missing_name') {
            return this.handleMissingEnumNameSynthetic(tokenStream, currentToken);
        }

        if (context === 'missing_value') {
            return this.handleMissingEnumValueSynthetic(tokenStream, currentToken);
        }

        if (context === 'invalid_syntax') {
            return this.handleInvalidEnumSyntax(tokenStream, currentToken);
        }

        // Check for common enum declaration errors
        if (error.includes('expected enum name') || error.includes('expected identifier')) {
            return this.handleMissingEnumName(tokenStream, currentToken);
        }

        if (error.includes('expected \'{\' after enum name')) {
            return this.handleMissingEnumBody(tokenStream, currentToken);
        }

        if (error.includes('malformed enum member')) {
            return this.skipToNextEnumMember(tokenStream, context);
        }

        // Generic recovery - skip to next declaration
        return this.skipToNextDeclaration(tokenStream, 'enum declaration');
    }

    /**
     * Handle errors when parsing variable declarations
     */
    handleVariableDeclarationError(tokenStream: TokenStream, error: string, context?: string): RecoveryResult {
        const currentToken = tokenStream.peek();

        // Check for context-specific cases first
        if (context === 'missing_name') {
            return this.handleMissingVariableNameSynthetic(tokenStream, currentToken);
        }

        if (context === 'missing_semicolon') {
            return this.handleMissingSemicolonSynthetic(tokenStream, currentToken);
        }

        if (context === 'invalid_array_syntax') {
            return this.handleInvalidArraySyntax(tokenStream, currentToken);
        }

        // Check for common variable declaration errors
        if (error.includes('expected variable name') || error.includes('expected identifier')) {
            return this.handleMissingVariableName(tokenStream, currentToken);
        }

        if (error.includes('expected \';\' after variable declaration')) {
            return this.handleMissingSemicolon(tokenStream, currentToken, 'variable declaration');
        }

        if (error.includes('invalid initializer')) {
            return this.handleInvalidInitializer(tokenStream, currentToken);
        }

        // Generic recovery - skip to semicolon or next declaration
        return this.skipToStatementEnd(tokenStream, 'variable declaration');
    }

    /**
     * Skip to the next declaration boundary
     */
    private skipToNextDeclaration(tokenStream: TokenStream, declarationType: string): RecoveryResult {
        const recoveryTokens = [';', '}'];
        const recoveryKeywords = [TokenKind.KeywordDeclaration, TokenKind.KeywordModifier];

        const baseResult = this.skipToRecoveryPoint(
            tokenStream,
            recoveryTokens,
            recoveryKeywords,
            `${declarationType} recovery`
        );

        return {
            ...baseResult,
            action: baseResult.action === RecoveryAction.Continue ?
                RecoveryAction.Continue :
                RecoveryAction.ThrowError,
            declarationType: this.getDeclarationType(declarationType)
        };
    }

    /**
     * Skip to the next class member
     */
    private skipToClassMember(tokenStream: TokenStream, context?: string): RecoveryResult {
        const recoveryTokens = [';', '}'];
        const recoveryKeywords = [TokenKind.KeywordModifier, TokenKind.KeywordType];

        const baseResult = this.skipToRecoveryPoint(
            tokenStream,
            recoveryTokens,
            recoveryKeywords,
            context || 'class member recovery'
        );

        return {
            ...baseResult,
            action: RecoveryAction.SkipToClassMember,
            declarationType: 'class'
        };
    }

    /**
     * Handle missing class name
     */
    private handleMissingClassName(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticName = `MissingClassName_${token.start}`;
        const message = `Missing class name. Using synthetic name '${syntheticName}'`;

        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        return this.classsRecoveryResult(message, RecoveryAction.Continue);
    }

    /**
     * Handle missing function name
     */
    private handleMissingFunctionName(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticName = `MissingFunctionName_${token.start}`;
        const message = `Missing function name. Using synthetic name '${syntheticName}'`;

        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        return this.functionRecoveryResult(message, RecoveryAction.Continue);
    }

    /**
     * Handle missing enum name
     */
    private handleMissingEnumName(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticName = `MissingEnumName_${token.start}`;
        const message = `Missing enum name. Using synthetic name '${syntheticName}'`;

        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        return this.enumRecoveryResult(message, RecoveryAction.Continue);
    }

    /**
     * Handle missing variable name
     */
    private handleMissingVariableName(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticName = `missingVar_${token.start}`;
        const message = `Missing variable name. Using synthetic name '${syntheticName}'`;

        if (!this.shouldSuppressError(message)) {
            const pos = this.document.positionAt(token.start);
            this.reportWarning(message, pos);
        }

        return this.variableRecoveryResult(message, RecoveryAction.Continue);
    }

    /**
     * Handle missing class body
     */
    private handleMissingClassBody(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticToken = this.createSyntheticToken('{', TokenKind.Punctuation, token.start)
        const message = `Missing class body. Expected '{' after class name`;

        return this.classsRecoveryResult(message, RecoveryAction.InsertSynthetic, syntheticToken);
    }

    /**
     * Handle missing function body
     */
    private handleMissingFunctionBody(tokenStream: TokenStream, token: Token): RecoveryResult {
        // For functions, missing body might mean it's a declaration (proto/native)
        if (this.isProtoFunction(tokenStream)) {
            return {
                action: RecoveryAction.Continue,
                message: 'Proto/native function - no body expected',
                declarationType: 'function'
            };
        }

        const result = this.handleMissingPunctuation('{', token.start, 'function body');
        result.declarationType = 'function';
        return result;
    }

    /**
     * Handle missing enum body
     */
    private handleMissingEnumBody(tokenStream: TokenStream, token: Token): RecoveryResult {
        const result = this.handleMissingPunctuation('{', token.start, 'enum body');
        result.declarationType = 'enum';
        return result;
    }

    /**
     * Handle missing parameter list
     */
    private handleMissingParameterList(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticToken = this.createSyntheticToken('(', TokenKind.Punctuation, token.start);
        const message = `Missing parameter list. Expected '(' after function name`;

        return this.functionRecoveryResult(message, RecoveryAction.InsertSynthetic, syntheticToken);
    }

    /**
     * Handle malformed parameter list
     */
    private handleMalformedParameterList(tokenStream: TokenStream, _token: Token): RecoveryResult {
        // Skip to closing parenthesis or next declaration
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
            } else if (isDeclarationKeyword(current) && depth === 0) {
                // Hit new declaration, stop here
                break;
            }
            tokenStream.next();
        }

        const message = 'Recovered from malformed parameter list';

        return this.functionRecoveryResult(message, RecoveryAction.Continue);
    }

    /**
     * Handle missing semicolon
     */
    private handleMissingSemicolon(tokenStream: TokenStream, token: Token, context: string): RecoveryResult {
        if (this.shouldSuppressError('missing semicolon')) {
            return {
                action: RecoveryAction.Continue,
                message: `Lenient mode: missing semicolon in ${context}`,
                declarationType: this.getDeclarationType(context)
            };
        }

        const syntheticToken = this.createSyntheticToken(';', TokenKind.Punctuation, token.start);
        const message = `Missing semicolon in ${context}`;

        return {
            action: RecoveryAction.InsertSynthetic,
            message,
            syntheticToken,
            declarationType: this.getDeclarationType(context)
        };
    }

    /**
     * Handle invalid initializer
     */
    private handleInvalidInitializer(tokenStream: TokenStream, _token: Token): RecoveryResult {
        // Skip to semicolon or next declaration
        return this.skipToStatementEnd(tokenStream, 'variable initializer');
    }

    /**
     * Skip to next enum member
     */
    private skipToNextEnumMember(tokenStream: TokenStream, context?: string): RecoveryResult {
        const recoveryTokens = [',', '}'];

        const baseResult = this.skipToRecoveryPoint(
            tokenStream,
            recoveryTokens,
            [],
            context || 'enum member recovery'
        );

        return {
            ...baseResult,
            action: RecoveryAction.Continue,
            declarationType: 'enum'
        };
    }

    /**
     * Skip to end of statement (semicolon or declaration boundary)
     */
    private skipToStatementEnd(tokenStream: TokenStream, context: string): RecoveryResult {
        const recoveryTokens = [';', '}'];
        const recoveryKeywords = [TokenKind.KeywordDeclaration, TokenKind.KeywordModifier];

        const baseResult = this.skipToRecoveryPoint(
            tokenStream,
            recoveryTokens,
            recoveryKeywords,
            context
        );

        return {
            ...baseResult,
            action: baseResult.action === RecoveryAction.Continue ?
                RecoveryAction.Continue :
                RecoveryAction.ThrowError
        };
    }

    /**
     * Check if current context indicates a proto/native function
     */
    private isProtoFunction(tokenStream: TokenStream): boolean {
        // Look back in recent tokens for 'proto' or 'native' modifiers
        const recentTokens = tokenStream.getRecentTokens(5);

        for (const token of recentTokens) {
            if (token.value === 'proto' || token.value === 'native') {
                return true;
            }
            if (token.value === ';' || token.value === '}') {
                break; // Hit statement boundary
            }
        }

        return false;
    }

    /**
     * Extract declaration type from context string
     */
    private getDeclarationType(context: string): 'class' | 'function' | 'enum' | 'variable' | 'typedef' {
        if (context.includes('class')) return 'class';
        if (context.includes('function')) return 'function';
        if (context.includes('enum')) return 'enum';
        if (context.includes('variable')) return 'variable';
        if (context.includes('typedef')) return 'typedef';
        return 'variable'; // default
    }

    /**
     * Handle invalid inheritance syntax
     */
    private handleInvalidInheritance(tokenStream: TokenStream, _token: Token): RecoveryResult {
        const message = "Skipped invalid inheritance syntax";

        // Skip inheritance tokens until we find the class body or end
        while (!tokenStream.eof()) {
            const current = tokenStream.peek();
            if (current.value === '{' || current.value === ';') {
                break;
            }
            tokenStream.next();
        }

        return this.classsRecoveryResult(message, RecoveryAction.Continue);
    }

    /**
     * Handle missing parent class name in inheritance
     */
    private handleMissingParentClassName(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticName = `BaseClass${token.start}`;
        const syntheticToken = this.createSyntheticToken(syntheticName, TokenKind.Identifier, token.start);
        const message = `Generated synthetic parent class name`;

        return this.classsRecoveryResult(message, RecoveryAction.Continue, syntheticToken);
    }

    /**
     * Handle missing parameters by generating synthetic parameter list
     */
    private handleMissingParametersSynthetic(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticToken = this.createSyntheticToken('()', TokenKind.Punctuation, token.start);
        const message = `Generated synthetic parameter list`;

        return this.functionRecoveryResult(message, RecoveryAction.Continue, syntheticToken);
    }

    /**
     * Handle invalid parameter syntax by skipping
     */
    private handleInvalidParameterSyntax(tokenStream: TokenStream, _token: Token): RecoveryResult {
        // Skip to closing parenthesis or function body
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
            } else if (current.value === '{' && depth === 0) {
                break; // Found function body
            }
            tokenStream.next();
        }

        const message = `Skipped invalid parameter syntax`;

        return this.functionRecoveryResult(message, RecoveryAction.Continue);
    }

    /**
     * Handle missing enum name with synthetic generation
     */
    private handleMissingEnumNameSynthetic(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticName = `UnnamedEnum${token.start}`;
        const syntheticToken = this.createSyntheticToken(syntheticName, TokenKind.Identifier, token.start);
        const message = `Generated synthetic enum name`;

        return this.enumRecoveryResult(message, RecoveryAction.Continue, syntheticToken);
    }

    /**
     * Handle missing enum value with synthetic generation
     */
    private handleMissingEnumValueSynthetic(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticName = `EnumValue${token.start}`;
        const syntheticToken = this.createSyntheticToken(syntheticName, TokenKind.Identifier, token.start);
        const message = `Generated synthetic enum value`;

        return this.enumRecoveryResult(message, RecoveryAction.Continue, syntheticToken);
    }

    /**
     * Handle invalid enum syntax by skipping
     */
    private handleInvalidEnumSyntax(tokenStream: TokenStream, _token: Token): RecoveryResult {
        // Skip to next comma, closing brace, or end
        while (!tokenStream.eof()) {
            const current = tokenStream.peek();
            if (current.value === ',' || current.value === '}') {
                break;
            }
            tokenStream.next();
        }

        return this.enumRecoveryResult(`Skipped invalid enum syntax`, RecoveryAction.Continue);
    }

    /**
     * Handle missing variable name with synthetic generation
     */
    private handleMissingVariableNameSynthetic(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticName = `unnamed_var${token.start}`;
        const syntheticToken = this.createSyntheticToken(syntheticName, TokenKind.Identifier, token.start);

        return this.variableRecoveryResult(`Generated synthetic variable name`, RecoveryAction.Continue, syntheticToken);
    }

    /**
     * Handle missing semicolon with synthetic generation
     */
    private handleMissingSemicolonSynthetic(tokenStream: TokenStream, token: Token): RecoveryResult {
        const syntheticToken = this.createSyntheticToken(';', TokenKind.Punctuation, token.start);
        return this.variableRecoveryResult(`Generated synthetic semicolon`, RecoveryAction.Continue, syntheticToken);
    }

    /**
     * Handle invalid array syntax by fixing
     */
    private handleInvalidArraySyntax(tokenStream: TokenStream, _token: Token): RecoveryResult {
        // Skip to closing bracket and continue
        while (!tokenStream.eof()) {
            const current = tokenStream.peek();
            if (current.value === ']') {
                tokenStream.next(); // consume closing bracket
                break;
            }
            tokenStream.next();
        }

        return this.variableRecoveryResult(`Fixed array syntax with default size`, RecoveryAction.Continue);
    }

    private classsRecoveryResult(message: string, action: RecoveryAction, synteticToken?: Token): RecoveryResult {
        return {
            action,
            message,
            declarationType: 'class',
            syntheticToken: synteticToken
        };
    }

    private functionRecoveryResult(message: string, action: RecoveryAction, synteticToken?: Token): RecoveryResult {
        return {
            action,
            message,
            declarationType: 'function',
            syntheticToken: synteticToken
        };
    }

    private variableRecoveryResult(message: string, action: RecoveryAction, synteticToken?: Token): RecoveryResult {
        return {
            action,
            message,
            declarationType: 'variable',
            syntheticToken: synteticToken
        };
    }

    private enumRecoveryResult(message: string, action: RecoveryAction, synteticToken?: Token): RecoveryResult {
        return {
            action,
            message,
            declarationType: 'enum',
            syntheticToken: synteticToken
        };
    }
}



