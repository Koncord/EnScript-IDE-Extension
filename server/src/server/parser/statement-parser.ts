/**
 * Statement Parser with Proper AST Construction
 */

import { Token, TokenKind } from '../lexer/token';
import { TokenStream } from '../lexer/token-stream';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { ExpressionParser } from './expression-parser';
import { ParserConfig } from '../ast/config';
import { StatementRecoveryStrategy } from '../recovery/statement-recovery';
import { RecoveryAction } from '../recovery/recovery-actions';
import { ParseError } from '../ast/errors';
import {
    Statement,
    Expression,
    ExpressionStatement,
    BlockStatement,
    IfStatement,
    UnaryExpression,
    UnaryOperator,
    Identifier,
    WhileStatement,
    ForStatement,
    ForEachStatement,
    SwitchStatement,
    CaseStatement,
    ReturnStatement,
    BreakStatement,
    ContinueStatement,
    CallExpression,
    MemberExpression,
    BinaryExpression,
    AssignmentExpression,
    DeclarationStatement,
    VarDeclNode,
    TypeNode,
    ArrayTypeNode
} from '../ast/node-types';

export class StatementParser {
    private expressionParser: ExpressionParser;
    private recoveryStrategy: StatementRecoveryStrategy;

    constructor(
        private tokenStream: TokenStream,
        private document: TextDocument,
        private config: ParserConfig,
        private parseTypeNode: () => TypeNode, // Callback to parse types
        private parseVarDeclaration: () => VarDeclNode, // Callback to parse var declarations (no modifiers)
        private expectSemicolon: () => Token | null, // Callback to expect semicolons
        private reportError?: (message: string, line: number, character: number) => void // Callback to report errors
    ) {
        this.expressionParser = new ExpressionParser(tokenStream, document, undefined, this.config.ideMode || false);
        this.recoveryStrategy = new StatementRecoveryStrategy(document, reportError);
    }

    /**
     * Parse a statement
     */
    parseStatement(): Statement {
        const token = this.tokenStream.peek();

        // Handle control flow statements using KeywordControl type for better precision
        if (token.kind === TokenKind.KeywordControl) {
            switch (token.value) {
                case 'if':
                    return this.parseIfStatement();
                case 'while':
                    return this.parseWhileStatement();
                case 'for':
                    return this.parseForStatement();
                case 'foreach':
                    return this.parseForEachStatement();
                case 'switch':
                    return this.parseSwitchStatement();
                case 'return':
                    return this.parseReturnStatement();
                case 'break':
                    return this.parseBreakStatement();
                case 'continue':
                    return this.parseContinueStatement();
                default:
                    // Other control keywords might need different handling
                    break;
            }
        }

        // Handle other statement types by token value
        switch (token.value) {
            case '{':
                return this.parseBlockStatement();
            case 'case':
            case 'default':
                return this.parseCaseStatement();
            case 'else':
                // Orphaned else - this indicates an error in the previous if statement parsing
                const recovery = this.recoveryStrategy.handleUnexpectedToken(token, 'statement');
                if (recovery.action === RecoveryAction.ThrowError) {
                    throw new Error(recovery.message!);
                }
                // This should always throw, but just in case:
                throw new Error('Unexpected else token');
            default:
                // Check if it's a variable declaration
                if (this.looksLikeVariableDeclaration()) {
                    return this.parseDeclarationStatement();
                }

                // Check for common mistakes before falling back to expression parsing
                // But allow KeywordType tokens if they're followed by '.' (static method calls like Class.Method())
                if (token.kind === TokenKind.KeywordType) {
                    // Look ahead to see if this is a static member access
                    const saved = this.tokenStream.getPosition();
                    this.tokenStream.next(); // consume the type keyword
                    const nextToken = this.tokenStream.peek();
                    this.tokenStream.setPosition(saved); // restore position
                    
                    // If followed by '.', treat as expression (static method call)
                    if (nextToken.value !== '.') {
                        const recovery = this.recoveryStrategy.handleUnexpectedToken(token, 'statement');
                        if (recovery.action === RecoveryAction.ThrowError) {
                            throw new Error(recovery.message!);
                        }
                    }
                    // Otherwise, fall through to parse as expression
                } else if (token.kind === TokenKind.KeywordDeclaration ||
                    token.kind === TokenKind.KeywordModifier ||
                    token.kind === TokenKind.KeywordStorage) {
                    const recovery = this.recoveryStrategy.handleUnexpectedToken(token, 'statement');
                    if (recovery.action === RecoveryAction.ThrowError) {
                        throw new Error(recovery.message!);
                    }
                }

                // Default to expression statement
                return this.parseExpressionStatement();
        }
    }

    /**
     * Parse a block statement ({ ... })
     */
    parseBlockStatement(): BlockStatement {
        const startToken = this.expectToken('{');
        const startPos = this.document.positionAt(startToken.start);
        const body: Statement[] = [];

        let iterationCount = 0;
        let lastTokenPosition = -1;
        let samePositionCount = 0;

        while (this.tokenStream.peek().value !== '}' && !this.tokenStream.eof()) {
            iterationCount++;

            // Check for infinite loops and token stream progress
            const progress = this.checkParsingProgress(iterationCount, lastTokenPosition, samePositionCount, 'block statement parsing');
            lastTokenPosition = progress.position;
            samePositionCount = progress.sameCount;

            // Skip empty statements (semicolons)
            if (this.tokenStream.peek().value === ';') {
                this.tokenStream.next();
                continue;
            }

            try {
                const stmt = this.parseStatement();
                body.push(stmt);
            } catch (error) {
                // Enhanced error recovery for common patterns in core files
                const errorMsg = error instanceof Error ? error.message : String(error);
                const currentToken = this.tokenStream.peek();

                // Special handling for common expression patterns that fail in core files
                if (currentToken.kind === TokenKind.Identifier) {
                    // Manual look-ahead by saving position
                    const savedPos = this.tokenStream.getPosition();
                    this.tokenStream.next(); // consume identifier
                    const nextToken = this.tokenStream.peek();
                    this.tokenStream.setPosition(savedPos); // restore position

                    // Handle postfix increment/decrement: x++, y--
                    if (nextToken && (nextToken.value === '++' || nextToken.value === '--')) {
                        try {
                            // Create a simple expression statement for postfix operations
                            const identifierToken = this.tokenStream.next();
                            const operatorToken = this.tokenStream.next();

                            const expr: UnaryExpression = {
                                kind: 'UnaryExpression',
                                uri: this.document.uri,
                                start: this.document.positionAt(identifierToken.start),
                                end: this.document.positionAt(operatorToken.end),
                                operator: operatorToken.value as UnaryOperator,
                                prefix: false,
                                operand: {
                                    kind: 'Identifier',
                                    uri: this.document.uri,
                                    start: this.document.positionAt(identifierToken.start),
                                    end: this.document.positionAt(identifierToken.end),
                                    name: identifierToken.value
                                } as Identifier
                            };

                            const exprStmt: ExpressionStatement = {
                                kind: 'ExpressionStatement',
                                uri: this.document.uri,
                                start: expr.start,
                                end: expr.end,
                                expression: expr
                            };

                            body.push(exprStmt);
                            continue;
                        } catch {
                            // Fall back to standard recovery
                        }
                    }

                    // Handle simple assignment: x = value
                    if (nextToken && nextToken.value === '=') {
                        try {
                            // Skip the problematic assignment and continue
                            this.tokenStream.next(); // identifier
                            this.tokenStream.next(); // =

                            // Skip to next meaningful token or end of statement
                            while (!this.tokenStream.eof() &&
                                this.tokenStream.peek().value !== '}' &&
                                this.tokenStream.peek().value !== ';') {
                                this.tokenStream.next();
                            }
                            continue;
                        } catch {
                            // Fall back to standard recovery
                        }
                    }
                }

                // Standard error recovery: skip to next semicolon or brace
                const beforeRecoveryPos = this.tokenStream.getPosition();
                const recoveryResult = this.recoveryStrategy.skipToRecoveryPoint(
                    this.tokenStream, 
                    [';', '}'], 
                    undefined,
                    `block_statement: ${errorMsg}`
                );

                const afterRecoveryPos = this.tokenStream.getPosition();
                if (beforeRecoveryPos === afterRecoveryPos && !this.tokenStream.eof()) {
                    // Recovery didn't advance - force consume to prevent infinite loop
                    this.tokenStream.next();
                }
                
                // Handle recovery result - be more lenient in block parsing
                if (recoveryResult.action === RecoveryAction.ThrowError) {
                    // For block parsing, try to continue instead of breaking immediately
                    // Only break if we're truly stuck or at the end of the block
                    const currentToken = this.tokenStream.peek();
                    if (currentToken.value === '}' || this.tokenStream.eof()) {
                        // We've reached the end of the block or file - it's safe to exit
                        break;
                    }
                    // Otherwise, force advance and continue to prevent getting stuck
                    this.tokenStream.next();
                    continue;
                }
            }
        }

        // More resilient closing brace handling
        let endToken: Token;
        let endPos: Position;

        if (this.tokenStream.peek().value === '}') {
            endToken = this.expectToken('}');
            endPos = this.document.positionAt(endToken.end);
        } else if (this.tokenStream.eof()) {
            // Handle case where we've reached EOF but expect a closing brace
            // This can happen with parsing issues in postfix operators
            const lastToken = this.tokenStream.getRecentTokens(1)[0];
            if (lastToken) {
                endPos = this.document.positionAt(lastToken.end);
            } else {
                endPos = this.document.positionAt(this.document.getText().length);
            }

            // Create a synthetic closing brace token for recovery
            endToken = {
                kind: TokenKind.Operator,
                value: '}',
                start: this.document.getText().length,
                end: this.document.getText().length
            };
        } else {
            // Try the normal expectToken but catch the error for better handling
            try {
                endToken = this.expectToken('}');
                endPos = this.document.positionAt(endToken.end);
            } catch (error) {
                // If we can't find the closing brace, synthesize position information
                const currentToken = this.tokenStream.peek();
                endPos = this.document.positionAt(currentToken.start);
                endToken = {
                    kind: TokenKind.Operator,
                    value: '}',
                    start: currentToken.start,
                    end: currentToken.end
                };
                // Re-throw the error so it gets handled by upper levels
                throw error;
            }
        }

        return {
            kind: 'BlockStatement',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            body
        };
    }

    /**
     * Parse an if statement
     */
    parseIfStatement(): IfStatement {
        const startToken = this.expectToken('if');
        const startPos = this.document.positionAt(startToken.start);

        this.expectToken('(');
        const test = this.expressionParser.parseExpression();
        this.expectToken(')');

        const consequent = this.parseStatement();
        let alternate: Statement | undefined;
        let endPos = this.getStatementEnd(consequent);

        if (this.tokenStream.peek().value === 'else') {
            this.tokenStream.next(); // consume 'else'
            alternate = this.parseStatement();
            endPos = this.getStatementEnd(alternate);
        }

        return {
            kind: 'IfStatement',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            test,
            consequent,
            alternate
        };
    }

    /**
     * Parse a while statement
     */
    parseWhileStatement(): WhileStatement {
        const startToken = this.expectToken('while');
        const startPos = this.document.positionAt(startToken.start);

        this.expectToken('(');
        const test = this.expressionParser.parseExpression();
        this.expectToken(')');

        const body = this.parseStatement();
        const endPos = this.getStatementEnd(body);

        return {
            kind: 'WhileStatement',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            test,
            body
        };
    }

    /**
     * Parse a for statement
     */
    parseForStatement(): ForStatement {
        const startToken = this.expectToken('for');
        const startPos = this.document.positionAt(startToken.start);

        this.expectToken('(');

        // Parse init (can be variable declaration or expression)
        let init: VarDeclNode | Expression | undefined;
        if (this.tokenStream.peek().value !== ';') {
            if (this.looksLikeVariableDeclaration()) {
                // Parse first variable declaration
                init = this.parseVarDeclaration();

                // Handle additional comma-separated variables
                while (this.tokenStream.peek().value === ',') {
                    this.tokenStream.next(); // consume ','

                    // Parse additional variable (same type as the first one)
                    this.expectIdentifier();

                    // Check for initializer
                    if (this.tokenStream.peek().value === '=') {
                        this.tokenStream.next(); // consume '='
                        this.expressionParser.parseExpression(); // Parse but don't store (for now)
                    } else if (this.tokenStream.peek().value === '(') {
                        // Handle constructor call syntax
                        this.tokenStream.next(); // consume '('

                        while (this.tokenStream.peek().value !== ')' && !this.tokenStream.eof()) {
                            this.expressionParser.parseExpression();

                            if (this.tokenStream.peek().value === ',') {
                                this.tokenStream.next(); // consume ','
                            } else {
                                break;
                            }
                        }

                        this.expectToken(')');
                    }
                }
            } else {
                init = this.expressionParser.parseExpression();
            }
        }
        this.expectToken(';');

        // Parse test condition
        let test: Expression | undefined;
        if (this.tokenStream.peek().value !== ';') {
            test = this.expressionParser.parseExpression();
        }
        this.expectToken(';');

        // Parse update expression with improved error recovery for redundant semicolons
        let update: Expression | undefined;
        if (this.tokenStream.peek().value !== ')') {
            // Check for redundant semicolon (common error pattern: for(;;))
            if (this.tokenStream.peek().value === ';') {
                // Report diagnostic in strict mode, but continue parsing
                if (this.reportError) {
                    const token = this.tokenStream.peek();
                    const pos = this.document.positionAt(token.start);
                    this.reportError(
                        `Redundant semicolon in for loop. Expected update expression or closing parenthesis`,
                        pos.line,
                        pos.character
                    );
                }
                // Skip the redundant semicolon and continue
                this.tokenStream.next();
            } else {
                // Parse normal update expression
                try {
                    update = this.expressionParser.parseExpression();
                } catch (error) {
                    // Recovery: skip tokens until we find ')' or ';'
                    if (this.reportError) {
                        const token = this.tokenStream.peek();
                        const pos = this.document.positionAt(token.start);
                        this.reportError(
                            `Invalid update expression in for loop: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            pos.line,
                            pos.character
                        );
                    }
                    // Skip invalid tokens until we find a recovery point
                    while (!this.tokenStream.eof() && 
                           this.tokenStream.peek().value !== ')' && 
                           this.tokenStream.peek().value !== ';') {
                        this.tokenStream.next();
                    }
                }
            }
        }
        this.expectToken(')');

        // Parse body
        const body = this.parseStatement();
        const endPos = this.getStatementEnd(body);

        return {
            kind: 'ForStatement',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            init,
            test,
            update,
            body
        };
    }

    /**
     * Parse a foreach statement (EnScript specific) with comprehensive error recovery
     */
    parseForEachStatement(): ForEachStatement {
        const startToken = this.expectToken('foreach');
        const startPos = this.document.positionAt(startToken.start);

        this.expectToken('(');

        // Parse the variable declaration part manually for foreach
        // In EnScript, foreach syntax can be:
        // - foreach (type variable : iterable)
        // - foreach (type key, type value : iterable)
        const variables: VarDeclNode[] = [];

        // Parse first variable with error recovery
        if (this.looksLikeVariableDeclaration()) {
            const firstVar = this.parseForEachVariable('variable declaration');
            variables.push(firstVar);

            // Check if there's a comma for second variable (e.g., foreach (string key, auto value : map))
            if (this.tokenStream.peek().value === ',') {
                this.tokenStream.next(); // consume comma

                if (this.looksLikeVariableDeclaration()) {
                    const secondVar = this.parseForEachVariable('variable declaration after comma');
                    variables.push(secondVar);
                } else {
                    throw new Error('Expected variable declaration after comma in foreach statement');
                }
            }
        } else {
            throw new Error('Expected variable declaration in foreach statement');
        }

        // Expect the colon separator
        this.expectToken(':');

        // Parse the iterable expression with error recovery
        let iterable;
        try {
            iterable = this.expressionParser.parseExpression();
        } catch (error) {
            // Recovery: report error and create synthetic expression
            if (this.reportError) {
                const token = this.tokenStream.peek();
                const pos = this.document.positionAt(token.start);
                this.reportError(
                    `Invalid iterable expression in foreach: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    pos.line,
                    pos.character
                );
            }
            // Create synthetic identifier
            const token = this.tokenStream.peek();
            iterable = {
                kind: 'Identifier',
                uri: this.document.uri,
                start: this.document.positionAt(token.start),
                end: this.document.positionAt(token.end),
                name: 'unknownIterable'
            } as Identifier;
            // Skip tokens until we find closing parenthesis
            while (!this.tokenStream.eof() && this.tokenStream.peek().value !== ')') {
                this.tokenStream.next();
            }
        }

        this.expectToken(')');

        // Parse body
        const body = this.parseStatement();
        const endPos = this.getStatementEnd(body);

        // Return as ForEachStatement with proper semantics
        return {
            kind: 'ForEachStatement',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            variables,
            iterable,
            body
        };
    }

    /**
     * Parse a return statement
     */
    parseReturnStatement(): ReturnStatement {
        const startToken = this.expectToken('return');
        const startPos = this.document.positionAt(startToken.start);

        let argument: Expression | undefined;
        let endPos = this.document.positionAt(startToken.end);

        // Check if there's an expression to return
        const nextToken = this.tokenStream.peek();
        if (nextToken.value !== ';') {
            // Check for obvious statement-ending tokens that shouldn't be parsed as expressions
            // Note: We don't include '{' here because it could be an array literal: return {a, b, c};
            if (nextToken.value === '}' ||
                ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
                    'break', 'continue', 'return', 'goto'].includes(nextToken.value) ||
                this.tokenStream.eof()) {
                // Missing semicolon - don't try to parse as expression
                // The missing semicolon error will be handled by the expectSemicolon call below
            } else {
                try {
                    argument = this.expressionParser.parseExpression();
                    endPos = this.getExpressionEnd(argument);
                } catch (error) {
                    // Expression parsing failed - this is likely a bug in the expression parser
                    // For now, let's report the error but still try to continue parsing
                    if (this.reportError) {
                        const token = this.tokenStream.peek();
                        const position = this.document.positionAt(token.start);
                        this.reportError(
                            `Failed to parse return expression: ${error instanceof Error ? error.message : String(error)}`,
                            position.line + 1,
                            position.character + 1
                        );
                    }
                    // Continue without argument and let semicolon check handle the error
                }
            }
        }

        // Expect semicolon
        const semiToken = this.expectSemicolon();
        if (semiToken) {
            endPos = this.document.positionAt(semiToken.end);
        }

        return {
            kind: 'ReturnStatement',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            argument
        };
    }

    /**
     * Parse a break statement
     */
    parseBreakStatement(): BreakStatement {
        return this.parseSimpleControlStatement('break', 'BreakStatement') as BreakStatement;
    }

    /**
     * Parse a continue statement
     */
    parseContinueStatement(): ContinueStatement {
        return this.parseSimpleControlStatement('continue', 'ContinueStatement') as ContinueStatement;
    }

    /**
     * Parse a declaration statement (variable declarations inside blocks)
     */
    parseDeclarationStatement(): DeclarationStatement {
        const startPos = this.document.positionAt(this.tokenStream.peek().start);

        // First parse any modifiers (ref, const, etc.)
        const modifiers: string[] = [];
        while (this.isModifier(this.tokenStream.peek())) {
            modifiers.push(this.tokenStream.next().value);
        }

        // Parse comma-separated variable declarations
        const declarations = this.parseVariableDeclarationsWithSemicolon(modifiers, []);

        // Store the first declaration as the primary declaration
        const firstDeclaration = declarations[0];
        let endPos = firstDeclaration.end;

        // Update end position to include all declarations if there are multiple
        if (declarations.length > 1) {
            endPos = declarations[declarations.length - 1].end;
        }

        return {
            kind: 'DeclarationStatement',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            declaration: firstDeclaration,
            declarations: declarations.length > 1 ? declarations : undefined
        };
    }

    /**
     * Parse an expression statement
     */
    parseExpressionStatement(): ExpressionStatement {
        const expression = this.expressionParser.parseExpression();
        let endPos = this.getExpressionEnd(expression);

        // Expect semicolon with error recovery
        try {
            const semiToken = this.expectSemicolon();
            if (semiToken) {
                endPos = this.document.positionAt(semiToken.end);
            }
        } catch {
            // Enhanced error recovery - check if semicolon is actually present
            // This handles cases where complex generic expressions affect token stream position
            let foundSemicolon = false;

            // Look ahead more tokens to see if there's a semicolon nearby
            // This accounts for potential token stream position issues after complex generic parsing
            const savedPosition = this.tokenStream.getPosition();
            try {
                // Look ahead but ONLY skip tokens that could be part of type recovery
                // Don't consume tokens from the next statement
                for (let i = 0; i < 3; i++) { // Reduced from 10 to 3 - more conservative
                    const checkToken = this.tokenStream.peek();
                    
                    if (checkToken.value === ';') {
                        // Found the semicolon - consume it and continue
                        this.tokenStream.next();
                        endPos = this.document.positionAt(checkToken.end);
                        foundSemicolon = true;
                        break;
                    }
                    
                    // Stop if we hit a structural boundary or what looks like a new statement
                    if (checkToken.value === '}' || checkToken.value === '{' ||
                        this.tokenStream.eof()) {
                        // Hit a structural boundary - stop looking
                        break;
                    }
                    
                    // If we see an identifier (not immediately after our expression),
                    // it's likely the start of a new statement - stop looking
                    if (i > 0 && /^[a-zA-Z_]/.test(checkToken.value)) {
                        break;
                    }
                    
                    this.tokenStream.next();
                }
            } catch {
                // If lookahead fails, restore position
            }

            if (!foundSemicolon) {
                // Restore position if we didn't find a semicolon
                this.tokenStream.setPosition(savedPosition);

                // Only report the error if we're confident it's actually missing
                // Avoid false positives for complex generic method calls and failed complex type parsing
                if (this.reportError && !this.containsGenericMethodCall(expression) && !this.isLikelyFragmentParsing(expression)) {
                    // Report error at the end of the expression, not at the next token
                    const errorPos = expression.end;
                    this.reportError(
                        `Missing semicolon after expression statement`,
                        errorPos.line + 1,
                        errorPos.character
                    );
                }
            }
            // Don't throw the error - continue parsing
        }

        return {
            kind: 'ExpressionStatement',
            uri: this.document.uri,
            start: expression.start,
            end: endPos,
            expression
        };
    }

    /**
     * Parse multiple statements (for function bodies, etc.)
     */
    parseStatements(): Statement[] {
        const statements: Statement[] = [];

        while (!this.tokenStream.eof() && this.tokenStream.peek().value !== '}') {
            // Skip empty statements (semicolons)
            if (this.tokenStream.peek().value === ';') {
                this.tokenStream.next();
                continue;
            }

            try {
                const stmt = this.parseStatement();
                statements.push(stmt);
            } catch (error) {
                // Re-throw ParseError so it can be caught by the main Parser and added to parseErrors
                if (error instanceof ParseError) {
                    throw error;
                }
                
                // For other errors, do error recovery: skip to next semicolon or brace
                this.skipToRecoveryPoint();
            }
        }

        return statements;
    }

    // ============================================================================
    // HELPER METHODS
    // ============================================================================

    /**
     * Helper to parse simple control statements (break/continue) that follow the same pattern
     */
    private parseSimpleControlStatement(keyword: string, kind: 'BreakStatement' | 'ContinueStatement'): BreakStatement | ContinueStatement {
        const startToken = this.expectToken(keyword);
        let endPos = this.document.positionAt(startToken.end);

        // Expect semicolon
        const semiToken = this.expectSemicolon();
        if (semiToken) {
            endPos = this.document.positionAt(semiToken.end);
        }

        return {
            kind,
            uri: this.document.uri,
            start: this.document.positionAt(startToken.start),
            end: endPos
        };
    }

    /**
     * Helper to parse a single variable in a foreach statement with error recovery
     */
    private parseForEachVariable(context: string): VarDeclNode {
        const typeToken = this.tokenStream.peek();
        
        // Parse type with error recovery
        let type: TypeNode;
        try {
            type = this.parseTypeNode();
        } catch (error) {
            // Recovery: report error and create synthetic type
            if (this.reportError) {
                const pos = this.document.positionAt(typeToken.start);
                this.reportError(
                    `Invalid type in foreach ${context}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    pos.line,
                    pos.character
                );
            }
            // Create synthetic type node and skip to recovery point
            type = {
                kind: 'TypeReference' as const,
                uri: this.document.uri,
                start: this.document.positionAt(typeToken.start),
                end: this.document.positionAt(typeToken.end),
                name: 'auto' // fallback to auto type
            };
            // Skip tokens until we find an identifier or colon
            while (!this.tokenStream.eof() && 
                   this.tokenStream.peek().kind !== TokenKind.Identifier &&
                   this.tokenStream.peek().value !== ':') {
                this.tokenStream.next();
            }
        }

        // Skip any stray > tokens (e.g., from typos like "Type>> variable")
        // This only happens with malformed code, not with valid nested generics
        while (this.tokenStream.peek().value === '>') {
            const strayToken = this.tokenStream.peek();
            const pos = this.document.positionAt(strayToken.start);
            if (this.reportError) {
                this.reportError(
                    'Unexpected ">" token.',
                    pos.line,
                    pos.character
                );
            }
            this.tokenStream.next(); // consume stray >
        }

        // Parse variable name
        const nameToken = this.tokenStream.peek();
        if (nameToken.kind !== TokenKind.Identifier) {
            const recovery = this.recoveryStrategy.handleExpectedIdentifier(nameToken, context);
            if (recovery.action === RecoveryAction.ThrowError) {
                throw new Error(recovery.message!);
            }
        }
        this.tokenStream.next(); // consume identifier

        // Create VarDeclNode
        return {
            kind: 'VarDecl',
            uri: this.document.uri,
            start: this.document.positionAt(typeToken.start),
            end: this.document.positionAt(nameToken.end),
            type,
            name: nameToken.value,
            nameStart: this.document.positionAt(nameToken.start),
            nameEnd: this.document.positionAt(nameToken.end),
            modifiers: [],
            annotations: [],
            initializer: undefined
        };
    }

    /**
     * Helper to check for infinite loops and token stream progress
     * Returns true if parsing should continue, throws if stuck
     */
    private checkParsingProgress(iterationCount: number, lastTokenPosition: number, samePositionCount: number, context: string): { position: number; sameCount: number } {
        // Infinite loop detection
        if (iterationCount > 1000) {
            const recovery = this.recoveryStrategy.handleInfiniteLoopDetection(iterationCount, context);
            if (recovery.action === RecoveryAction.ThrowError) {
                throw new Error(recovery.message!);
            }
        }

        const currentTokenPosition = this.tokenStream.getPosition();
        
        // Check if token position is advancing
        if (currentTokenPosition === lastTokenPosition) {
            samePositionCount++;
            if (samePositionCount > 2) {
                const recovery = this.recoveryStrategy.handleTokenStreamStuck(context);
                if (recovery.action === RecoveryAction.ThrowError) {
                    throw new Error(recovery.message!);
                }
            }
        } else {
            samePositionCount = 0;
        }

        return { position: currentTokenPosition, sameCount: samePositionCount };
    }

    /**
     * Check if the current token sequence looks like a variable declaration
     */
    private looksLikeVariableDeclaration(): boolean {
        const saved = this.tokenStream.getPosition();

        try {
            // Skip modifiers (static, const, etc.)
            while (this.isModifier(this.tokenStream.peek())) {
                this.tokenStream.next();
            }

            // Check for type identifier
            const token = this.tokenStream.peek();
            if (token.kind !== TokenKind.Identifier &&
                token.kind !== TokenKind.KeywordType) {
                return false;
            }
            this.tokenStream.next();

            // Check if this is a static method call (e.g., Class.Method(...))
            // If we see a dot after the type name, this is NOT a variable declaration
            if (this.tokenStream.peek().value === '.') {
                return false;
            }

            // Skip generic type arguments if present
            if (this.tokenStream.peek().value === '<') {
                this.skipGenericArguments();
            }

            // Skip any stray > tokens (e.g., from >>> in malformed generics)
            // This can happen with array<ref Param3<string, string, int>>>
            while (this.tokenStream.peek().value === '>') {
                this.tokenStream.next();
            }

            // Skip array dimensions if present
            while (this.tokenStream.peek().value === '[') {
                this.skipArrayDimension();
            }

            // Must be followed by identifier (variable name)
            const nameToken = this.tokenStream.peek();
            return nameToken.kind === TokenKind.Identifier;

        } catch {
            return false;
        } finally {
            this.tokenStream.setPosition(saved);
        }
    }

    /**
     * Check if a token is a modifier
     */
    private isModifier(token: Token): boolean {
        // Use lexer token classification - the lexer already properly categorizes modifiers
        return token.kind === TokenKind.KeywordModifier || 
               token.kind === TokenKind.KeywordStorage;
    }

    /**
     * Skip generic type arguments <T, U, V>
     * 
     * Handles missing '>' by detecting when we've likely left the generic context
     */
    private skipGenericArguments(): void {
        if (this.tokenStream.peek().value === '<') {
            this.tokenStream.next(); // consume '<'
            let depth = 1;

            while (depth > 0 && !this.tokenStream.eof()) {
                const token = this.tokenStream.peek();
                
                if (token.value === '<') {
                    this.tokenStream.next();
                    depth++;
                } else if (token.value === '>') {
                    this.tokenStream.next();
                    depth--;
                } else if (token.value === '>>') {
                    this.tokenStream.next();
                    // Handle '>>' as two separate '>' tokens for nested generics
                    depth -= 2;
                } else {
                    // Check if this token suggests we've exited the generic arguments (missing '>')
                    // This happens with: array<int myVar; or array<ref Param2<string, int myData;
                    const isLikelyVariableName = token.kind === TokenKind.Identifier;

                    if (depth >= 1 && isLikelyVariableName) {
                        // Save position to peek ahead
                        const saved = this.tokenStream.getPosition();
                        this.tokenStream.next(); // consume potential variable name
                        const afterName = this.tokenStream.peek();
                        this.tokenStream.setPosition(saved); // restore

                        // If pattern matches variable declaration, assume missing '>'(s)
                        if (afterName.value === ';' || afterName.value === '=' || 
                            afterName.value === ',' || afterName.value === ')' ||
                            afterName.value === '[') {
                            // This is likely the variable name, not a generic argument
                            // Exit with depth > 0 to signal missing '>'
                            // For nested generics like array<ref Param2<string, int myData
                            // we're missing TWO '>' tokens but we'll exit and let recovery handle it
                            break;
                        }
                    }

                    // Normal token inside generics, consume it
                    this.tokenStream.next();
                }
            }
        }
    }

    /**
     * Skip array dimension [size]
     */
    private skipArrayDimension(): void {
        if (this.tokenStream.peek().value === '[') {
            this.tokenStream.next(); // consume '['

            while (this.tokenStream.peek().value !== ']' && !this.tokenStream.eof()) {
                this.tokenStream.next();
            }

            if (this.tokenStream.peek().value === ']') {
                this.tokenStream.next(); // consume ']'
            }
        }
    }

    /**
     * Parse switch statement
     */
    parseSwitchStatement(): SwitchStatement {
        const startToken = this.expectToken('switch');
        const startPos = this.document.positionAt(startToken.start);

        this.expectToken('(');
        const discriminant = this.expressionParser.parseExpression();
        this.expectToken(')');

        this.expectToken('{');

        const cases: CaseStatement[] = [];
        let switchIterations = 0;
        let lastTokenPosition = -1;
        let samePositionCount = 0;

        while (this.tokenStream.peek().value !== '}' && !this.tokenStream.eof()) {
            switchIterations++;

            // Check for infinite loops and token stream progress
            const progress = this.checkParsingProgress(switchIterations, lastTokenPosition, samePositionCount, 'switch statement parsing');
            lastTokenPosition = progress.position;
            samePositionCount = progress.sameCount;

            const token = this.tokenStream.peek();

            if (token.value === 'case' || token.value === 'default') {
                const caseStmt = this.parseCaseStatement();
                cases.push(caseStmt);
            } else if (token.value === 'break' || token.value === 'continue') {
                // Handle break/continue statements that appear outside case blocks
                // This is common in C-style switch statements where break is at the same indentation as case
                try {
                    const stmt = this.parseStatement();
                    // Try to attach this to the last case if it exists
                    if (cases.length > 0) {
                        const lastCase = cases[cases.length - 1];
                        lastCase.consequent.push(stmt);
                    }
                    // If no cases exist, this is likely a malformed switch - skip it
                } catch {
                    this.skipToRecoveryPoint();
                }
            } else {
                // Skip unexpected tokens or try to parse as statement
                this.skipToRecoveryPoint();
            }
        }

        const endToken = this.expectToken('}');
        const endPos = this.document.positionAt(endToken.end);

        return {
            kind: 'SwitchStatement',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            discriminant,
            cases
        };
    }

    /**
     * Parse case statement (case X: or default:)
     */
    parseCaseStatement(): CaseStatement {
        const token = this.tokenStream.peek();
        const startPos = this.document.positionAt(token.start);

        let test: Expression | undefined;

        if (token.value === 'case') {
            this.tokenStream.next(); // consume 'case'
            test = this.expressionParser.parseExpression();
        } else if (token.value === 'default') {
            this.tokenStream.next(); // consume 'default'
            // test remains undefined for default case
        } else {
            // Provide specific error messages based on token type
            let errorMessage = `Expected 'case' or 'default' in switch statement, got '${token.value}'`;
            if (token.kind === TokenKind.KeywordControl) {
                errorMessage += `. Control flow keyword '${token.value}' cannot be used here - switch statements only accept 'case' and 'default' labels.`;
            } else if (token.kind === TokenKind.KeywordType || token.kind === TokenKind.KeywordDeclaration) {
                errorMessage += `. ${token.kind === TokenKind.KeywordType ? 'Type' : 'Declaration'} keywords cannot be used as case labels.`;
            }
            throw new Error(errorMessage);
        }

        this.expectToken(':');

        // Parse statements until we hit another case, default, or closing brace
        const consequent: Statement[] = [];
        let caseIterations = 0;
        let lastTokenPosition = -1;
        let samePositionCount = 0;

        while (!this.tokenStream.eof()) {
            caseIterations++;
            
            // Check for infinite loops and token stream progress
            const progress = this.checkParsingProgress(caseIterations, lastTokenPosition, samePositionCount, 'case statement parsing');
            lastTokenPosition = progress.position;
            samePositionCount = progress.sameCount;
            
            const nextToken = this.tokenStream.peek();

            // Stop at another case/default or end of switch
            if (nextToken.value === 'case' || nextToken.value === 'default' || nextToken.value === '}') {
                break;
            }

            // Skip empty statements
            if (nextToken.value === ';') {
                this.tokenStream.next();
                continue;
            }

            // Special handling for break/continue statements that appear at the same indentation level as case
            // This handles the common C-style pattern where break is at the same level as case
            if (nextToken.value === 'break' || nextToken.value === 'continue') {
                try {
                    const stmt = this.parseStatement();
                    consequent.push(stmt);
                    // After parsing break/continue, we've likely reached the end of this case
                    break;
                } catch {
                    this.skipToRecoveryPoint();
                    break;
                }
            }

            try {
                const stmt = this.parseStatement();
                consequent.push(stmt);
            } catch {
                // Error recovery
                this.skipToRecoveryPoint();
                break;
            }
        }

        // End position is the last statement or the colon
        let endPos = this.document.positionAt(token.end);
        if (consequent.length > 0) {
            endPos = consequent[consequent.length - 1].end;
        }

        return {
            kind: 'CaseStatement',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            test,
            consequent
        };
    }

    /**
     * Skip to a recovery point for error handling
     */
    private skipToRecoveryPoint(context?: string): void {
        const result = this.recoveryStrategy.skipToStatementRecoveryPoint(this.tokenStream, context);
        
        if (result.action === RecoveryAction.ThrowError) {
            throw new Error(result.message || 'Recovery failed');
        }
    }

    /**
     * Expect a specific token value and consume it
     */
    private expectToken(expected: string): Token {
        const token = this.tokenStream.next();
        if (token.value !== expected) {
            const recovery = this.recoveryStrategy.handleExpectedToken(this.tokenStream, expected, token);
            if (recovery.action === RecoveryAction.ThrowError) {
                throw new Error(recovery.message!);
            } else if (recovery.action === RecoveryAction.InsertSynthetic && recovery.syntheticToken) {
                return recovery.syntheticToken;
            }
        }
        return token;
    }

    /**
     * Get the end position of a statement
     */
    private getStatementEnd(stmt: Statement): Position {
        return stmt.end;
    }

    /**
     * Get the end position of an expression
     */
    private getExpressionEnd(expr: Expression): Position {
        return expr.end;
    }

    /**
     * Parse comma-separated variable declarations with proper semicolon handling
     * Example: int a, b, c;
     */
    private parseVariableDeclarationsWithSemicolon(modifiers: string[] = [], annotations: string[][] = []): VarDeclNode[] {
        const declarations: VarDeclNode[] = [];

        // Parse type
        const type = this.parseTypeNode();

        // Skip any stray > tokens (e.g., from malformed generic declarations like Type>>>)
        // We'll report them via reportError callback if available, otherwise just skip silently
        while (this.tokenStream.peek().value === '>') {
            const strayToken = this.tokenStream.peek();
            const pos = this.document.positionAt(strayToken.start);
            if (this.reportError) {
                this.reportError(
                    'Unexpected ">" token in variable declaration.',
                    pos.line,
                    pos.character
                );
            }
            this.tokenStream.next(); // consume stray >
        }

        // Parse first variable
        const firstNameToken = this.expectIdentifier();
        declarations.push(this.createVariableDeclaration(modifiers, annotations, type, firstNameToken));

        // Parse additional comma-separated variables
        while (this.tokenStream.peek().value === ',') {
            this.tokenStream.next(); // consume ','

            const nameToken = this.expectIdentifier();
            declarations.push(this.createVariableDeclaration(modifiers, annotations, type, nameToken));
        }

        // Expect semicolon after all variables with error recovery
        try {
            const semiToken = this.expectSemicolon();
            if (semiToken) {
                // Update end positions of all declarations to include the semicolon
                const semiEnd = this.document.positionAt(semiToken.end);
                declarations.forEach(decl => decl.end = semiEnd);
            }
        } catch {
            // Handle missing semicolon gracefully in statement context
            if (this.reportError) {
                const lastDeclaration = declarations[declarations.length - 1];
                // Report error at the end of the last declaration
                const errorPos = lastDeclaration.end;
                this.reportError(
                    `Missing semicolon after variable declaration '${lastDeclaration.name}'`,
                    errorPos.line + 1,
                    errorPos.character
                );
            }
            // Continue parsing - don't throw the error
        }

        return declarations;
    }

    /**
     * Create a variable declaration node (helper method)
     */
    private createVariableDeclaration(modifiers: string[], annotations: string[][], type: TypeNode, nameToken: Token): VarDeclNode {
        const nameStart = this.document.positionAt(nameToken.start);
        const nameEnd = this.document.positionAt(nameToken.end);

        let finalType = type;
        let initializer: Expression | undefined;
        let endPos = nameEnd;

        // Check for array dimensions after variable name (e.g., "varName[4]")
        while (this.tokenStream.peek().value === '[') {
            this.tokenStream.next(); // consume '['

            // Parse array size if present
            let arraySize: Expression | undefined;
            if (this.tokenStream.peek().value !== ']') {
                arraySize = this.expressionParser.parseExpression();
            }

            this.expectToken(']');

            // Create array type node
            finalType = {
                kind: 'ArrayType',
                uri: this.document.uri,
                start: type.start,
                end: this.document.positionAt(this.tokenStream.peek().start),
                elementType: finalType,
                size: arraySize
            } as ArrayTypeNode;
        }

        // Check for initializer - either assignment or constructor call
        if (this.tokenStream.peek().value === '=') {
            this.tokenStream.next(); // consume '='
            initializer = this.expressionParser.parseExpression();
            endPos = initializer.end;
        } else if (this.tokenStream.peek().value === '(') {
            // Constructor call syntax: ClassName varName(param1, param2);
            this.tokenStream.next(); // consume '('

            const args: Expression[] = [];
            while (this.tokenStream.peek().value !== ')' && !this.tokenStream.eof()) {
                args.push(this.expressionParser.parseExpression());

                if (this.tokenStream.peek().value === ',') {
                    this.tokenStream.next(); // consume ','
                } else {
                    break;
                }
            }

            const endToken = this.expectToken(')');
            endPos = this.document.positionAt(endToken.end);

            // Create a call expression as the initializer
            initializer = {
                kind: 'CallExpression',
                uri: this.document.uri,
                start: nameStart, // Start from the variable name
                end: endPos,
                callee: {
                    kind: 'Identifier',
                    uri: this.document.uri,
                    start: nameStart,
                    end: nameEnd,
                    name: nameToken.value
                },
                calleeStart: nameStart,
                calleeEnd: nameEnd,
                arguments: args
            } as CallExpression;
        }

        return {
            kind: 'VarDecl',
            uri: this.document.uri,
            start: nameStart,
            end: endPos,
            name: nameToken.value,
            nameStart,
            nameEnd,
            modifiers,
            annotations,
            type: finalType,
            initializer
        };
    }

    /**
     * Expect an identifier token
     */
    private expectIdentifier(): Token {
        const token = this.tokenStream.peek();
        if (token.kind !== TokenKind.Identifier) {
            const recovery = this.recoveryStrategy.handleExpectedIdentifier(token);
            if (recovery.action === RecoveryAction.ThrowError) {
                throw new Error(recovery.message!);
            }
        }
        return this.tokenStream.next();
    }

    /**
     * Check if an expression contains a generic method call that might cause token stream issues
     */
    private containsGenericMethodCall(expression: Expression): boolean {
        if (!expression) return false;

        // Check if this is a call expression with generic type arguments
        if (expression.kind === 'CallExpression') {
            const callExpr = expression as CallExpression;

            // Look for patterns like SomeClass<Type>.Method() or generic method calls
            if (callExpr.callee?.kind === 'MemberExpression') {
                const memberExpr = callExpr.callee as MemberExpression;
                // Check if the object is a generic type reference (often appears as CallExpression with type args)
                if (memberExpr.object?.kind === 'CallExpression') {
                    return true; // Likely a generic method call like JsonFileLoader<ref Type>.Method()
                }
            }
        }

        // Check if this is a member access on a generic type
        if (expression.kind === 'MemberExpression') {
            const memberExpr = expression as MemberExpression;
            return this.containsGenericMethodCall(memberExpr.object);
        }

        // Check other expression types that might contain generic calls
        if (expression.kind === 'UnaryExpression') {
            const unaryExpr = expression as UnaryExpression;
            return this.containsGenericMethodCall(unaryExpr.operand);
        }

        if (expression.kind === 'BinaryExpression') {
            const binaryExpr = expression as BinaryExpression;
            return this.containsGenericMethodCall(binaryExpr.left) ||
                this.containsGenericMethodCall(binaryExpr.right);
        }

        return false;
    }

    /**
     * Check if an expression is likely a fragment from failed complex type parsing
     */
    private isLikelyFragmentParsing(expression: Expression): boolean {
        if (!expression) return false;

        // Check for assignment expressions that might actually be variable declarations
        // This happens when complex generic type declarations are mis-parsed as expressions
        if (expression.kind === 'AssignmentExpression') {
            const assignExpr = expression as AssignmentExpression;
            
            // Check if the left side looks like it could be part of a variable declaration
            // that was incorrectly parsed due to complex generic types with nested modifiers
            if (assignExpr.left && assignExpr.left.kind === 'MemberExpression') {
                // If this pattern appears in the statement context and involves member access,
                // it's likely that a complex type declaration like "ref map<int, ref T> var = ..."
                // was mis-parsed, where the parser got confused by nested "ref" keywords
                return true;
            }
        }

        // Check if this is a standalone identifier or binary expression that might be a fragment from failed parsing
        if (expression.kind === 'Identifier' || expression.kind === 'BinaryExpression') {
            // Handle both identifier and binary expression fragments
            const isIdentifier = expression.kind === 'Identifier';
            const identifier = isIdentifier ? expression as Identifier : null;

            // Only check built-in primitive types that are likely to be fragments (for identifiers only)
            if (isIdentifier && identifier) {
                const builtinTypeFragments = new Set(['int', 'float', 'string', 'bool']);

                if (builtinTypeFragments.has(identifier.name)) {
                    return true; // Always treat built-in type fragment identifiers as likely parsing failures
                }
            }

            // Check if this identifier appears to be a fragment from a failed if condition
            // This happens when complex logical expressions in if statements fail to parse correctly
            const savedPos = this.tokenStream.getPosition();

            try {
                // Look behind and ahead for patterns that suggest this is part of a failed if condition
                let hasIfConditionPattern = false;
                let tokenCount = 0;

                // Look ahead for block statement patterns that suggest this should have been part of an if condition
                while (tokenCount < 10 && !this.tokenStream.eof()) {
                    const token = this.tokenStream.peek();

                    // If we see a block statement immediately following this identifier,
                    // it's likely this identifier was meant to be part of an if condition
                    if (token.value === '{') {
                        hasIfConditionPattern = true;
                        break;
                    }

                    // If we hit a semicolon or other structural boundary, this is probably a real statement
                    if (token.value === ';' || token.value === '}') {
                        break;
                    }

                    this.tokenStream.next();
                    tokenCount++;
                }

                if (hasIfConditionPattern) {
                    return true;
                }

                // For any other identifier, check if it appears in a context that suggests failed generic parsing
                let hasComplexGenericPattern = false;
                tokenCount = 0;

                // Reset position for generic pattern check
                this.tokenStream.setPosition(savedPos);

                // Look ahead for patterns that suggest complex generic type parsing
                while (tokenCount < 15 && !this.tokenStream.eof()) {
                    const token = this.tokenStream.peek();

                    // Look for generic type patterns - focus on structural elements, not specific types
                    if (token.value === '<' || token.value === '>' || token.value === 'new') {
                        hasComplexGenericPattern = true;
                        break;
                    }

                    // If we hit structural boundaries, stop looking
                    if (token.value === ';' || token.value === '{' || token.value === '}' ||
                        token.value === '(' || token.value === ')') {
                        break;
                    }

                    this.tokenStream.next();
                    tokenCount++;
                }

                return hasComplexGenericPattern;
            } catch {
                return false;
            } finally {
                this.tokenStream.setPosition(savedPos);
            }
        }

        return false;
    }
}
