/**
 *  Parser Core with Comprehensive AST Support
 */

import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import { Token, TokenKind } from '../lexer/token';
import { TokenStream } from '../lexer/token-stream';
import { ParserConfig } from '../ast/config';
import { ParseError, ParseWarning } from '../ast/errors';
import { ExpressionParser } from './expression-parser';
import { StatementParser } from './statement-parser';
import { lexWithPreprocessor } from '../lexer/preprocessor-lexer';
import { Logger } from '../../util/logger';

import { isModifier } from '../util/utils';
import { VariableDeclarationCollector } from '../ast/VariableDeclarationCollector';

import { RecoveryResult } from '../recovery/recovery-actions';
import { DeclarationRecoveryStrategy } from '../recovery/declaration-recovery';
import { TypeRecoveryStrategy } from '../recovery/type-recovery';
import { PreprocessorRecoveryStrategy } from '../recovery/preprocessor-recovery';

// Import new AST node types
import {
    FileNode,
    Declaration,
    Statement,
    Expression,
    TypeNode,
    ClassDeclNode,
    EnumDeclNode,
    EnumMemberDeclNode,
    FunctionDeclNode,
    MethodDeclNode,
    VarDeclNode,
    TypedefDeclNode,
    ParameterDeclNode,
    GenericParameterNode,
    BlockStatement,
    DeclarationStatement,
    TypeReferenceNode,
    ExpressionStatement,
    CallExpression
} from '../ast/node-types';

/**
 * Preprocessor condition types
 */
type PreprocessorCondition = {
    type: 'ifdef' | 'ifndef' | 'if';
    symbol: string;
    isTrue: boolean;
};

export class Parser {
    private tokenStream: TokenStream;
    private document: TextDocument;
    private config: ParserConfig;
    private preprocessorStack: PreprocessorCondition[] = [];
    private definedSymbols = new Set<string>();
    private parseErrors: ParseError[] = [];
    private currentClassName: string | null = null; // Track the class being parsed for constructor/destructor detection

    // Sub-parsers
    private expressionParser: ExpressionParser;
    private statementParser: StatementParser;

    // Recovery strategies
    private declarationRecovery: DeclarationRecoveryStrategy;
    private typeRecovery: TypeRecoveryStrategy;
    private preprocessorRecovery: PreprocessorRecoveryStrategy;

    constructor(document: TextDocument, tokens: Token[], config: ParserConfig) {
        this.document = document;
        this.tokenStream = new TokenStream(tokens);
        this.config = config;

        // Initialize defined symbols from configuration
        this.definedSymbols = new Set(config.preprocessorDefinitions);

        // Enable preprocessor respect mode to handle conditionals
        this.tokenStream.setPreprocessorRespect(true);

        // Initialize sub-parsers
        this.expressionParser = new ExpressionParser(
            this.tokenStream,
            this.document,
            (message: string, line: number, character: number) => this.addWarningDiagnostic(message, line, character),
            this.config.ideMode || false
        );
        this.statementParser = new StatementParser(
            this.tokenStream,
            this.document,
            this.config,
            () => this.parseType(),
            () => this.parseVariableDeclarationWithoutSemicolon([], []),
            () => this.expectSemicolon(),
            (message: string, line: number, character: number) => this.addParseError(message, line, character)
        );

        // Initialize recovery strategies
        const warningCallback = (message: string, line: number, character: number) => this.addWarningDiagnostic(message, line, character);
        const errorCallback = (message: string, line: number, character: number) => this.addParseError(message, line, character);
        
        this.declarationRecovery = new DeclarationRecoveryStrategy(document, undefined, warningCallback, errorCallback);
        this.typeRecovery = new TypeRecoveryStrategy(document, undefined, warningCallback, errorCallback);
        this.preprocessorRecovery = new PreprocessorRecoveryStrategy(document, undefined, warningCallback, errorCallback);
    }

    /**
     * Create a Parser with preprocessor-aware lexing
     */
    static createWithPreprocessor(document: TextDocument, sourceCode: string, config: ParserConfig): Parser {
        const tokens = lexWithPreprocessor(sourceCode, {
            definedSymbols: config.preprocessorDefinitions,
            includePreprocessorTokens: false
        });

        return new Parser(document, tokens, config);
    }

    /**
     * Get parsing errors collected during parsing
     */
    getParseErrors(): ParseError[] {
        return [...this.parseErrors];
    }

    /**
     * Get 1-indexed line and character from a token offset (for error reporting)
     */
    private getErrorPosition(tokenOffset: number): { line: number; character: number } {
        const pos = this.document.positionAt(tokenOffset);
        return {
            line: pos.line + 1,
            character: pos.character + 1
        };
    }

    /**
     * Add a warning diagnostic (for recoverable issues)
     */
    private addWarningDiagnostic(message: string, line: number, character: number): void {
        const warning = new ParseWarning(
            this.document.uri,
            line,
            character,
            message
        );
        this.parseErrors.push(warning);
    }

    /**
     * Add a parse error diagnostic
     */
    private addParseError(message: string, line: number, character: number): void {
        const error = new ParseError(
            this.document.uri,
            line,
            character,
            message
        );

        // Only add the error if it shouldn't be suppressed
        if (!this.shouldSuppressError(error)) {
            this.parseErrors.push(error);
        }
    }

    /**
     * Parse the main file structure
     */
    parse(): FileNode {
        // Add global timeout protection
        const parseStartTime = Date.now();
        const MAX_PARSE_TIME = 10000; // 10 seconds max

        const file: FileNode = {
            kind: 'File',
            uri: this.document.uri,
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 }, // Will be updated at the end
            body: [],
            version: this.document.version
        };

        // Main parsing loop with infinite loop detection
        let lastTokenPosition = -1;
        let sameTokenCount = 0;
        let iterationCount = 0;

        while (!this.tokenStream.eof()) {
            // Global timeout check
            const currentTime = Date.now();
            if (currentTime - parseStartTime > MAX_PARSE_TIME) {
                console.error(`GLOBAL TIMEOUT: Parse took longer than ${MAX_PARSE_TIME}ms, aborting`);
                break;
            }

            iterationCount++;

            // Infinite loop detection
            const currentTokenPosition = this.tokenStream.peekRaw().start;
            const currentTokenValue = this.tokenStream.peekRaw().value;

            if (currentTokenPosition === lastTokenPosition) {
                sameTokenCount++;
                if (sameTokenCount > 3) {
                    // Main loop infinite loop detected - break out
                    const loopError = new ParseError(
                        this.document.uri,
                        this.document.positionAt(currentTokenPosition).line + 1,
                        this.document.positionAt(currentTokenPosition).character + 1,
                        `Token stream not advancing in block statement parsing. ` +
                        `Stuck at position ${currentTokenPosition} with token "${currentTokenValue}". ` +
                        `Iteration count: ${iterationCount}, same token count: ${sameTokenCount}`
                    );
                    this.parseErrors.push(loopError);



                    break;
                }
            } else {
                sameTokenCount = 0;
                lastTokenPosition = currentTokenPosition;
            }

            // Handle preprocessor directives
            const currentToken = this.tokenStream.peekRaw();
            if (currentToken.kind === TokenKind.Preproc) {
                this.handlePreprocessorDirective();
                continue;
            }

            // Skip parsing if we're in a false conditional block
            if (!this.isInActiveBlock()) {
                const nextToken = this.tokenStream.peekRaw();
                if (nextToken.kind === TokenKind.Preproc) {
                    this.handlePreprocessorDirective();
                } else {
                    this.tokenStream.next();
                }
                continue;
            }

            // Skip semicolons
            if (this.tokenStream.peek().value === ';') {
                this.tokenStream.next();
                continue;
            }

            // Handle stray closing braces
            if (this.tokenStream.peek().value === '}') {
                if (this.config.lenientSemicolons) {
                    // Engine files: silently skip stray braces
                    this.tokenStream.next();
                    continue;
                } else {
                    // User files: report as syntax error
                    const token = this.tokenStream.peek();
                    const { line, character } = this.getErrorPosition(token.start);
                    const error = new ParseError(
                        this.document.uri,
                        line,
                        character,
                        `Unexpected closing brace '${token.value}' - not part of any declaration`
                    );
                    this.parseErrors.push(error);
                    this.tokenStream.next(); // consume the brace to avoid infinite loop
                    continue;
                }
            }

            try {
                const declarations = this.parseDeclaration();
                file.body.push(...declarations);
            } catch (error) {
                if (this.config.errorRecovery && error instanceof ParseError) {
                    if (!this.shouldSuppressError(error)) {
                        this.parseErrors.push(error);
                    }

                    // Try to preserve partial parsing results
                    const partialDeclarations = this.attemptPartialRecovery(error);
                    if (partialDeclarations.length > 0) {
                        file.body.push(...partialDeclarations);
                    }

                    this.recoverFromError('main_parse_loop', `parsing declaration: ${error.message}`);
                    continue;
                } else {
                    throw error;
                }
            }
        }

        // Update file end position
        if (file.body.length > 0) {
            file.end = file.body[file.body.length - 1].end;
        }

        // Check for empty file - indicates catastrophic parsing failure
        // Only flag as empty if the file seems to contain declaration-like content but failed to parse
        if (file.body.length === 0 && this.shouldFlagAsEmptyFile()) {
            if (!this.tokenStream.eof()) {
                // File has content but parser couldn't recover anything meaningful
                const warning = new ParseWarning(
                    this.document.uri,
                    1,
                    1,
                    `Catastrophic parsing failure: No declarations could be parsed from non-empty file. ` +
                    `This indicates severe syntax errors that prevented any recovery. ` +
                    `Parser found ${this.parseErrors.length} error(s) but could not extract meaningful AST content.`
                );
                this.parseErrors.push(warning);
            } else {
                // File has content but is completely empty after parsing
                const warning = new ParseWarning(
                    this.document.uri,
                    1,
                    1,
                    `Empty file result: File contains text but produced no AST declarations. ` +
                    `This may indicate unsupported syntax or parser limitations.`
                );
                this.parseErrors.push(warning);
            }
        }

        if (this.config.debug) {
            this.logParseResults(file);
        }

        return file;
    }

    /**
     * Determine if an empty file should be flagged as a parsing failure
     * Files containing only preprocessor directives, comments, or documentation should not be flagged
     */
    private shouldFlagAsEmptyFile(): boolean {
        const content = this.document.getText().trim();

        // Empty files are valid
        if (content.length === 0) {
            return false;
        }

        // Remove all comments (both // and /* */ style)
        let contentWithoutComments = content
            .replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* */ comments
            .replace(/\/\/.*$/gm, ''); // Remove // comments

        // Check if the entire content is wrapped in a single preprocessor conditional
        // This is common for template files, documentation files, etc.
        const preprocessorWrapped = this.isEntireFileInPreprocessorConditional(contentWithoutComments);
        if (preprocessorWrapped) {
            return false; // Don't flag files that are entirely wrapped in #ifdef/#endif
        }

        // Remove all preprocessor directives
        contentWithoutComments = contentWithoutComments
            .replace(/^\s*#.*$/gm, ''); // Remove lines starting with #

        // Remove whitespace
        contentWithoutComments = contentWithoutComments.trim();

        // If there's still substantial content after removing comments and preprocessor directives,
        // then the file should have produced declarations
        return contentWithoutComments.length > 0;
    }

    /**
     * Check if the entire file content is wrapped in a single preprocessor conditional
     */
    private isEntireFileInPreprocessorConditional(content: string): boolean {
        const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        if (lines.length < 2) {
            return false;
        }

        // Check if first non-empty line is #ifdef, #ifndef, or #if
        const firstLine = lines[0];
        const lastLine = lines[lines.length - 1];

        const startsWithConditional = /^#(ifdef|ifndef|if)\b/.test(firstLine);
        const endsWithEndif = /^#endif\b/.test(lastLine);

        return startsWithConditional && endsWithEndif;
    }

    /**
     * Parse a top-level declaration
     * Now uses specific keyword types for better detection
     */
    private parseDeclaration(): Declaration[] {
        // Capture the start position BEFORE parsing annotations/modifiers
        const declStartPos = this.document.positionAt(this.tokenStream.peek().start);
        
        // Parse in strict order: annotations first, then modifiers
        const annotations = this.parseAnnotations();
        const modifiers = this.parseModifiers();
        const token = this.tokenStream.peek();

        // Use specific keyword types for precise declaration detection
        if (token.kind === TokenKind.KeywordDeclaration) {
            switch (token.value) {
                case 'class':
                    return [this.parseClassDeclaration(modifiers, annotations, declStartPos)];
                case 'enum':
                    return [this.parseEnumDeclaration(modifiers, annotations, declStartPos)];
                case 'typedef':
                    return [this.parseTypedefDeclaration(modifiers, annotations, declStartPos)];
                default:
                    // Shouldn't happen with our categorization, but provide helpful error
                    throw new Error(`Declaration keyword '${token.value}' is recognized but not yet implemented in parser. Supported declarations: 'class', 'enum', 'typedef'.`);
            }
        } else {
            // Check if it's a function or variable declaration
            if (this.looksLikeFunctionDeclaration()) {
                return [this.parseFunctionDeclaration(modifiers, annotations, declStartPos)];
            } else {
                return this.parseVariableDeclarations(modifiers, annotations, declStartPos);
            }
        }
    }

    /**
     * Parse class declaration
     */
    private parseClassDeclaration(modifiers: string[], annotations: string[][], declStartPos: Position): ClassDeclNode {
        const _startToken = this.expectToken('class');
        const startPos = declStartPos; // Use the position that includes modifiers

        const nameToken = this.expectIdentifier('class-name');
        const nameStart = this.document.positionAt(nameToken.start);
        const nameEnd = this.document.positionAt(nameToken.end);

        // Parse optional generic parameters
        let genericParameters: GenericParameterNode[] | undefined;
        if (this.tokenStream.peek().value === '<') {
            genericParameters = this.parseGenericParameters();
        }

        // Parse optional base class
        let baseClass: TypeNode | undefined;
        if (this.tokenStream.peek().value === 'extends' || this.tokenStream.peek().value === ':') {
            this.tokenStream.next(); // consume 'extends' or ':'
            baseClass = this.parseType();
        }

        // Set current class name for constructor/destructor detection
        const previousClassName = this.currentClassName;
        this.currentClassName = nameToken.value;

        // Parse class body
        const body = this.parseClassBody();
        const members = this.extractMembersFromBody(body);

        // Restore previous class name (for nested classes)
        this.currentClassName = previousClassName;

        return {
            kind: 'ClassDecl',
            uri: this.document.uri,
            start: startPos,
            end: body.end,
            name: nameToken.value,
            nameStart,
            nameEnd,
            modifiers,
            annotations,
            genericParameters,
            baseClass,
            members,
            body
        };
    }

    /**
     * Parse enum declaration
     */
    private parseEnumDeclaration(modifiers: string[], annotations: string[][], declStartPos: Position): EnumDeclNode {
        const _startToken = this.expectToken('enum');
        const startPos = declStartPos; // Use the position that includes modifiers

        const nameToken = this.expectIdentifier('enum-name');
        const nameStart = this.document.positionAt(nameToken.start);
        const nameEnd = this.document.positionAt(nameToken.end);

        // Parse optional base type
        let baseType: TypeNode | undefined;
        if (this.tokenStream.peek().value === ':') {
            this.tokenStream.next(); // consume ':'
            baseType = this.parseType();
        }

        // Parse enum body
        this.expectToken('{');
        const members = this.parseEnumMembers();
        const endToken = this.expectToken('}');

        return {
            kind: 'EnumDecl',
            uri: this.document.uri,
            start: startPos,
            end: this.document.positionAt(endToken.end),
            name: nameToken.value,
            nameStart,
            nameEnd,
            modifiers,
            annotations,
            baseType,
            members
        };
    }

    /**
     * Parse function declaration
     */
    private parseFunctionDeclaration(modifiers: string[], annotations: string[][], declStartPos: Position): FunctionDeclNode {
        const startPos = declStartPos; // Use the position that includes modifiers

        // Parse return type
        const returnType = this.parseType();

        // Parse function name
        const nameToken = this.expectIdentifier();
        const nameStart = this.document.positionAt(nameToken.start);
        const nameEnd = this.document.positionAt(nameToken.end);

        // Parse optional generic parameters
        let genericParameters: GenericParameterNode[] | undefined;
        if (this.tokenStream.peek().value === '<') {
            genericParameters = this.parseGenericParameters();
        }

        // Parse parameters
        this.expectToken('(');
        const parameters = this.parseParameterList();
        this.expectToken(')');

        // Parse optional function body
        let body: BlockStatement | undefined;
        let endPos = nameEnd; // Initialize with nameEnd as fallback

        // Extract local variables from function body
        let locals: VarDeclNode[] = [];

        if (this.tokenStream.peek().value === '{') {
            if (this.config.skipFunctionBodies) {
                // Skip the entire function body when in external file mode
                this.skipToMatchingBrace();
                endPos = this.document.positionAt(this.tokenStream.getPosition());
            } else {
                body = this.statementParser.parseBlockStatement() as BlockStatement;
                endPos = body.end;
                
                // Use visitor to collect all variable declarations from the function body
                const collector = new VariableDeclarationCollector();
                locals = collector.visit(body);
            }
        } else {
            // Function declaration without body (e.g., in header)
            const semiToken = this.tokenStream.peek();
            if (semiToken.value === ';') {
                this.tokenStream.next(); // consume ';'
                endPos = this.document.positionAt(semiToken.end);
            } else {
                const semi = this.expectSemicolon();
                if (semi) {
                    endPos = this.document.positionAt(semi.end);
                }
                // If semi is null (lenient mode), endPos remains at nameEnd
            }
        }

        return {
            kind: 'FunctionDecl',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            name: nameToken.value,
            nameStart,
            nameEnd,
            modifiers,
            annotations,
            parameters,
            returnType,
            locals,
            body,
            genericParameters
        };
    }

    /**
     * Parse multiple variable declarations (comma-separated) for top-level
     * Example: int a, b, c;
     */
    private parseVariableDeclarations(modifiers: string[] = [], annotations: string[][] = [], declStartPos: Position): VarDeclNode[] {
        const declarations: VarDeclNode[] = [];

        // Parse type
        const type = this.parseType();

        // Parse first variable (use declStartPos for the first one)
        const firstNameToken = this.expectIdentifier();
        declarations.push(this.createVariableDeclaration(modifiers, annotations, type, firstNameToken, declStartPos));

        // Parse additional comma-separated variables
        while (this.tokenStream.peek().value === ',') {
            this.tokenStream.next(); // consume ','

            const nameToken = this.expectIdentifier();
            // For subsequent variables in the comma list, start from the type position
            declarations.push(this.createVariableDeclaration(modifiers, annotations, type, nameToken, type.start));
        }

        // Capture semicolon position and update all declarations to include it
        const semiToken = this.tokenStream.peek();
        if (semiToken.value === ';') {
            const semiEndPos = this.document.positionAt(semiToken.end);
            this.expectSemicolon();
            // Update all declarations to include the semicolon
            for (const decl of declarations) {
                decl.end = semiEndPos;
            }
        } else {
            this.expectSemicolon();
        }

        return declarations;
    }

    /**
     * Create a variable or field declaration (unified method)
     * Handles array dimensions and initializers (assignment or constructor call)
     */
    private createVariableDeclaration(modifiers: string[], annotations: string[][], type: TypeNode, nameToken: Token, declStartPos?: Position): VarDeclNode {
        const nameStart = this.document.positionAt(nameToken.start);
        const nameEnd = this.document.positionAt(nameToken.end);

        let finalType = type;
        let initializer: Expression | undefined;
        let endPos = nameEnd;

        // Check for array dimensions after variable name (e.g., "varName[4]")
        while (this.tokenStream.peek().value === '[') {
            this.tokenStream.next(); // consume '['

            let size: Expression | undefined;
            if (this.tokenStream.peek().value !== ']') {
                size = this.expressionParser.parseExpression();
            }

            const endToken = this.expectToken(']');
            endPos = this.document.positionAt(endToken.end);

            // Wrap the current type in an ArrayType
            finalType = {
                kind: 'ArrayType',
                uri: this.document.uri,
                start: finalType.start,
                end: endPos,
                elementType: finalType,
                size
            };
        }

        // Check for initializer - either assignment or constructor call
        if (this.tokenStream.peek().value === '=') {
            this.tokenStream.next(); // consume '='
            initializer = this.expressionParser.parseExpression();
            endPos = initializer?.end || endPos;
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
            start: declStartPos || finalType.start, // Use declStartPos if provided (includes modifiers)
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
     * Parse variable declaration - single variable for backward compatibility
     */
    parseVariableDeclaration(modifiers: string[] = [], annotations: string[][] = []): VarDeclNode {
        const declStartPos = this.document.positionAt(this.tokenStream.peek().start);
        const declarations = this.parseVariableDeclarations(modifiers, annotations, declStartPos);
        return declarations[0]; // Return first declaration for compatibility
    }

    /**
     * Parse variable declaration without expecting a semicolon (for use in for loops)
     */
    parseVariableDeclarationWithoutSemicolon(modifiers: string[] = [], annotations: string[][] = []): VarDeclNode {
        // Parse type
        const type = this.parseType();

        // Parse variable name  
        const nameToken = this.expectIdentifier();
        // For this case, start from type position since we're already past any modifiers
        return this.createVariableDeclaration(modifiers, annotations, type, nameToken, type.start);
    }

    /**
     * Parse typedef declaration
     */
    private parseTypedefDeclaration(modifiers: string[], annotations: string[][], declStartPos: Position): TypedefDeclNode {
        const _startToken = this.expectToken('typedef');
        const startPos = declStartPos; // Use the position that includes modifiers

        // Parse the old type
        const type = this.parseType();

        // Parse new type name
        const nameToken = this.expectIdentifier('typedef-name');
        const nameStart = this.document.positionAt(nameToken.start);
        const nameEnd = this.document.positionAt(nameToken.end);

        // Capture semicolon position if present
        let endPos = nameEnd;
        const semiToken = this.tokenStream.peek();
        if (semiToken.value === ';') {
            this.tokenStream.next(); // consume ';'
            endPos = this.document.positionAt(semiToken.end);
        }

        return {
            kind: 'TypedefDecl',
            uri: this.document.uri,
            start: startPos, // Use the position that includes modifiers
            end: endPos, // Include semicolon if present
            name: nameToken.value,
            nameStart,
            nameEnd,
            modifiers,
            annotations,
            type
        };
    }

    /**
     * Parse type reference
     */
    parseType(): TypeNode {
        const startToken = this.tokenStream.peek();
        const startPos = this.document.positionAt(startToken.start);

        // Handle storage modifiers like 'ref', 'autoptr', 'const' at the beginning of type
        // Note: 'static' should NOT be consumed here - it's a declaration modifier, not a type modifier
        const modifiers: string[] = [];
        while (this.tokenStream.peek().kind === TokenKind.KeywordStorage &&
            ['ref', 'reference', 'const', 'volatile', 'notnull', 'autoptr', 'out', 'inout', 'owned'].includes(this.tokenStream.peek().value)) {
            modifiers.push(this.tokenStream.next().value);
        }

        // Handle 'auto' keyword as a special case for type inference
        if (this.tokenStream.peek().kind === TokenKind.KeywordType && this.tokenStream.peek().value === 'auto') {
            const autoToken = this.tokenStream.next(); // consume 'auto'
            // Note: AutoType doesn't support modifiers in the type system
            // If there are modifiers with auto, we might need a different approach
            return {
                kind: 'AutoType',
                uri: this.document.uri,
                start: startPos,
                end: this.document.positionAt(autoToken.end)
            };
        }

        // Handle primitive type keywords directly
        if (this.tokenStream.peek().kind === TokenKind.KeywordType) {
            const typeToken = this.tokenStream.next(); // consume the type keyword
            let type: TypeNode = {
                kind: 'TypeReference',
                uri: this.document.uri,
                start: startPos,
                end: this.document.positionAt(typeToken.end),
                name: typeToken.value,
                modifiers: modifiers.length > 0 ? modifiers : undefined
            };
            
            // Parse array dimensions for primitive types
            while (this.tokenStream.peek().value === '[') {
                this.tokenStream.next(); // consume '['

                let size: Expression | undefined;
                if (this.tokenStream.peek().value !== ']') {
                    size = this.expressionParser.parseExpression();
                }

                const endToken = this.expectToken(']');

                type = {
                    kind: 'ArrayType',
                    uri: this.document.uri,
                    start: startPos,
                    end: this.document.positionAt(endToken.end),
                    elementType: type,
                    size
                };
            }
            
            return type;
        }

        // Parse base type name (identifier)
        const nameToken = this.expectIdentifier();
        let type: TypeNode = {
            kind: 'TypeReference',
            uri: this.document.uri,
            start: startPos,
            end: this.document.positionAt(nameToken.end),
            name: nameToken.value,
            modifiers: modifiers.length > 0 ? modifiers : undefined
        };

        // Parse optional generic arguments
        if (this.tokenStream.peek().value === '<') {
            const typeArgs = this.parseTypeArguments();
            type = {
                kind: 'GenericType',
                uri: this.document.uri,
                start: startPos,
                end: type.end, // Will be updated after parsing
                baseType: type,
                typeArguments: typeArgs
            };
        }

        // Parse array dimensions
        while (this.tokenStream.peek().value === '[') {
            this.tokenStream.next(); // consume '['

            let size: Expression | undefined;
            if (this.tokenStream.peek().value !== ']') {
                size = this.expressionParser.parseExpression();
            }

            const endToken = this.expectToken(']');

            type = {
                kind: 'ArrayType',
                uri: this.document.uri,
                start: startPos,
                end: this.document.positionAt(endToken.end),
                elementType: type,
                size
            };
        }

        return type;
    }

    // ============================================================================
    // HELPER METHODS
    // ============================================================================

    private parseModifiers(): string[] {
        const modifiers: string[] = [];

        // First, collect consecutive modifiers at the beginning
        while (isModifier(this.tokenStream.peek())) {
            modifiers.push(this.tokenStream.next().value);
        }

        // Now look ahead to see if there are more modifiers after storage keywords
        // This handles patterns like "private ref static Type"
        const currentPos = this.tokenStream.getPosition();
        let foundMoreModifiers = false;
        
        // Skip over storage keywords
        while (this.tokenStream.peek().kind === TokenKind.KeywordStorage) {
            this.tokenStream.next();
        }
        
        // Check if there are more modifiers after the storage keywords
        if (this.tokenStream.peek().kind === TokenKind.KeywordModifier) {
            foundMoreModifiers = true;
        }
        
        // Reset to the position after initial modifiers
        this.tokenStream.setPosition(currentPos);
        
        // If we found more modifiers, we need to consume them
        if (foundMoreModifiers) {
            // Skip past storage keywords and collect the additional modifiers
            while (this.tokenStream.peek().kind === TokenKind.KeywordStorage) {
                this.tokenStream.next();
            }
            
            // Collect the remaining modifiers
            while (isModifier(this.tokenStream.peek())) {
                modifiers.push(this.tokenStream.next().value);
            }
        }

        return modifiers;
    }






    private parseAnnotations(): string[][] {
        const annotations: string[][] = [];

        // Parse EnScript attributes: [AttributeName("param1", "param2", ...)]
        while (this.tokenStream.peek().value === '[') {
            const annotation = this.parseAnnotation();
            if (annotation) {
                annotations.push(annotation);
            }

            // Check for erroneous semicolon after attribute
            if (this.tokenStream.peek().value === ';') {
                const semicolonToken = this.tokenStream.peek();
                const pos = this.document.positionAt(semicolonToken.start);

                // Add style warning for unnecessary semicolon after attribute (if not suppressed)
                if (!this.config.suppressStylisticWarnings) {
                    this.addWarningDiagnostic(
                        'Unnecessary semicolon after attribute declaration. Attributes should not end with semicolons.',
                        pos.line,
                        pos.character
                    );
                }

                // Always consume the erroneous semicolon and continue
                this.tokenStream.next();
            }
        }

        return annotations;
    }

    private parseAnnotation(): string[] | null {
        if (this.tokenStream.peek().value !== '[') {
            return null;
        }

        this.tokenStream.next(); // consume '['

        const annotation: string[] = [];

        // Parse attribute name
        const nameToken = this.expectIdentifier();
        annotation.push(nameToken.value);

        // Parse optional parameter list
        if (this.tokenStream.peek().value === '(') {
            this.tokenStream.next(); // consume '('

            while (this.tokenStream.peek().value !== ')' && !this.tokenStream.eof()) {
                const token = this.tokenStream.peek();

                if (token.kind === TokenKind.String) {
                    // String parameter
                    annotation.push(token.value);
                    this.tokenStream.next();
                } else if (token.kind === TokenKind.Number) {
                    // Number parameter
                    annotation.push(token.value);
                    this.tokenStream.next();
                } else if (token.kind === TokenKind.Identifier) {
                    // Identifier parameter
                    annotation.push(token.value);
                    this.tokenStream.next();
                } else if (token.value === '{') {
                    // Array parameter like {"ScriptEditor"}
                    const arrayParam = this.parseArrayLiteralInAnnotation();
                    annotation.push(arrayParam);
                } else if (token.value === ',') {
                    // Skip commas
                    this.tokenStream.next();
                    continue;
                } else {
                    // Unknown token, try to consume it
                    annotation.push(token.value);
                    this.tokenStream.next();
                }
            }

            this.expectToken(')');
        }

        this.expectToken(']');

        return annotation;
    }

    private parseArrayLiteralInAnnotation(): string {
        let result = '{';
        this.tokenStream.next(); // consume '{'

        while (this.tokenStream.peek().value !== '}' && !this.tokenStream.eof()) {
            const token = this.tokenStream.peek();
            result += token.value;
            this.tokenStream.next();
        }

        if (this.tokenStream.peek().value === '}') {
            result += '}';
            this.tokenStream.next();
        }

        return result;
    }

    private parseGenericParameters(): GenericParameterNode[] {
        const params: GenericParameterNode[] = [];

        this.expectToken('<');

        while (this.tokenStream.peek().value !== '>') {
            const startPos = this.document.positionAt(this.tokenStream.peek().start);

            // Check for "Class" keyword
            let isClass = false;
            if (this.tokenStream.peek().value === 'Class') {
                isClass = true;
                this.tokenStream.next(); // consume 'Class'
            }

            const paramToken = this.expectIdentifier();

            params.push({
                kind: 'GenericParameter',
                uri: this.document.uri,
                start: startPos,
                end: this.document.positionAt(paramToken.end),
                name: paramToken.value,
                isClass
            });

            if (this.tokenStream.peek().value === ',') {
                this.tokenStream.next(); // consume ','
            } else {
                break;
            }
        }

        this.expectToken('>');
        return params;
    }

    private parseTypeArguments(): TypeNode[] {
        const args: TypeNode[] = [];

        this.expectToken('<');

        while (this.tokenStream.peek().value !== '>') {
            try {
                // Handle modifiers in type arguments (like "ref string")
                args.push(this.parseTypeInGeneric());
            } catch (error) {
                // If parsing a type argument fails, record the error and try to recover
                if (error instanceof ParseError) {
                    if (!this.shouldSuppressError(error)) {
                        this.parseErrors.push(error);
                    }
                }
                
                // Skip to next comma or closing bracket
                while (!this.tokenStream.eof() &&
                    this.tokenStream.peek().value !== ',' &&
                    this.tokenStream.peek().value !== '>') {
                    this.tokenStream.next();
                }

                // If we hit a comma, consume it and continue with next argument
                if (this.tokenStream.peek().value === ',') {
                    this.tokenStream.next();
                    continue;
                }

                // If we hit closing bracket or EOF, break out
                break;
            }

            if (this.tokenStream.peek().value === ',') {
                this.tokenStream.next(); // consume ','
            } else {
                break;
            }
        }

        this.expectToken('>');
        return args;
    }

    private parseTypeInGeneric(): TypeNode {
        const startToken = this.tokenStream.peek();
        const startPos = this.document.positionAt(startToken.start);

        // Handle modifier keywords like 'ref' in generic type arguments
        const modifiers: string[] = [];
        while (this.tokenStream.peek().kind === TokenKind.KeywordStorage &&
            ['ref', 'owned'].includes(this.tokenStream.peek().value)) {
            modifiers.push(this.tokenStream.next().value);
        }

        // Handle primitive type keywords directly
        if (this.tokenStream.peek().kind === TokenKind.KeywordType) {
            const typeToken = this.tokenStream.next();
            return {
                kind: 'TypeReference',
                uri: this.document.uri,
                start: startPos,
                end: this.document.positionAt(typeToken.end),
                name: typeToken.value,
                modifiers
            };
        }

        // Parse base type name (identifier)
        const nameToken = this.expectIdentifier();
        let type: TypeNode = {
            kind: 'TypeReference',
            uri: this.document.uri,
            start: startPos,
            end: this.document.positionAt(nameToken.end),
            name: nameToken.value,
            modifiers // Add modifiers to the type reference
        };

        // Parse generic arguments if present
        if (this.tokenStream.peek().value === '<') {
            const typeArgs = this.parseTypeArguments();
            // Update end position to after the closing '>'
            const currentToken = this.tokenStream.getRecentTokens(1)[0];
            const endPos = currentToken ? this.document.positionAt(currentToken.end) : type.end;

            type = {
                kind: 'GenericType',
                uri: this.document.uri,
                start: startPos,
                end: endPos,
                baseType: type,
                typeArguments: typeArgs
            };
        }

        // Parse array dimensions (same as in parseType)
        while (this.tokenStream.peek().value === '[') {
            this.tokenStream.next(); // consume '['

            let size: Expression | undefined;
            if (this.tokenStream.peek().value !== ']') {
                size = this.expressionParser.parseExpression();
            }

            const endToken = this.expectToken(']');

            type = {
                kind: 'ArrayType',
                uri: this.document.uri,
                start: startPos,
                end: this.document.positionAt(endToken.end),
                elementType: type,
                size
            };
        }

        return type;
    }

    private parseClassBody(): BlockStatement {
        const startToken = this.expectToken('{');
        const startPos = this.document.positionAt(startToken.start);
        const bodyStatements: Statement[] = [];

        // Parse class members until we hit the closing brace
        let lastMemberPosition = -1;
        let sameMemberCount = 0;

        while (this.tokenStream.peek().value !== '}' && !this.tokenStream.eof()) {
            // Infinite loop detection for class body - made more lenient
            const currentPosition = this.tokenStream.peek().start;
            if (currentPosition === lastMemberPosition) {
                sameMemberCount++;
                if (sameMemberCount > 10) { // Increased threshold from 3 to 10
                    // True infinite loop detected - try recovery instead of breaking
                    if (this.config.debug) {
                        Logger.warn(`Infinite loop detected in class body parsing at position ${currentPosition}`);
                    }
                    
                    // Skip to next potential member start or closing brace
                    this.skipToNextMember();
                    sameMemberCount = 0; // Reset counter after recovery
                    continue;
                }
            } else {
                sameMemberCount = 0;
                lastMemberPosition = currentPosition;
            }

            // Skip empty statements
            if (this.tokenStream.peek().value === ';') {
                this.tokenStream.next();
                continue;
            }

            // Parse a class member and wrap it in a DeclarationStatement
            try {
                const memberDeclarations = this.parseClassMemberDeclaration();
                for (const member of memberDeclarations) {
                    const declarationStatement: DeclarationStatement = {
                        kind: 'DeclarationStatement',
                        uri: this.document.uri,
                        start: member.start,
                        end: member.end,
                        declaration: member
                    };
                    bodyStatements.push(declarationStatement);
                }
            } catch (error) {
                // Enhanced error recovery for class members
                if (this.config.errorRecovery) {
                    // Always report the error first
                    if (!this.shouldSuppressError(error as ParseError)) {
                        this.parseErrors.push(error as ParseError);
                    }
                    
                    // Try to recover by creating a minimal placeholder member and skipping

                    
                    // In IDE mode, be more conservative with recovery
                    if (this.config.ideMode) {
                        // For IDE mode, try a more gentle recovery approach
                        // Skip only until we find a semicolon, closing brace, or what looks like a new member
                        while (!this.tokenStream.eof()) {
                            const token = this.tokenStream.peek();
                            
                            // Stop at closing brace (end of class)
                            if (token.value === '}') {
                                break;
                            }
                            
                            // Stop at semicolon (likely end of problematic member)
                            if (token.value === ';') {
                                this.tokenStream.next(); // consume the semicolon
                                break;
                            }
                            
                            // Stop if we see what looks like the start of a new member declaration
                            if ((token.kind === TokenKind.Identifier || token.kind === TokenKind.KeywordType) && 
                                this.looksLikeNewMemberStart()) {
                                break;
                            }
                            
                            this.tokenStream.next();
                        }
                    } else {
                        // More aggressive recovery - skip the problematic content
                        this.skipToNextMember();
                    }
                    
                    // Continue parsing the next member
                    continue;
                } else {
                    // Error recovery disabled - re-throw
                    throw error;
                }
            }
        }

        const endToken = this.expectToken('}');
        const endPos = this.document.positionAt(endToken.end);

        return {
            kind: 'BlockStatement',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            body: bodyStatements
        };
    }

    private parseClassMemberDeclaration(): Declaration[] {
        // Capture the start position BEFORE parsing annotations/modifiers
        const declStartPos = this.document.positionAt(this.tokenStream.peek().start);
        
        // Parse in strict order: annotations first, then modifiers
        const annotations = this.parseAnnotations();
        const modifiers = this.parseModifiers();
        const type = this.parseType();
        const nameToken = this.expectIdentifier();

        // Check if this is a method (has parameters)
        if (this.tokenStream.peek().value === '(') {
            return [this.parseMethodDeclaration(modifiers, annotations, type, nameToken, declStartPos)];
        } else {
            // This is a field declaration - handle comma-separated variables
            return this.parseFieldDeclarations(modifiers, annotations, type, nameToken, declStartPos);
        }
    }

    /**
     * Check if current position looks like the start of a new class member
     */
    private looksLikeNewMemberStart(): boolean {
        // Look ahead to see if this looks like a member declaration
        const saved = this.tokenStream.getPosition();
        
        try {
            // Skip any modifiers
            while (this.tokenStream.peek().kind === TokenKind.Identifier) {
                const token = this.tokenStream.peek();
                if (['protected', 'private', 'static', 'final', 'virtual'].includes(token.value)) {
                    this.tokenStream.next();
                } else {
                    break;
                }
            }
            
            // Check for type keywords or identifiers that suggest a member declaration
            const token = this.tokenStream.peek();
            const looksLikeMember = (
                token.kind === TokenKind.KeywordType ||
                (token.kind === TokenKind.Identifier && this.isValidTypeName(token.value)) ||
                ['void', 'int', 'float', 'string', 'bool', 'auto'].includes(token.value)
            );
            
            return looksLikeMember;
        } finally {
            this.tokenStream.setPosition(saved);
        }
    }

    /**
     * Check if a name looks like a valid type name
     */
    private isValidTypeName(name: string): boolean {
        // Types typically start with uppercase or are known primitive/builtin types
        return /^[A-Z][a-zA-Z0-9_]*$/.test(name) || 
               ['ref', 'array', 'map'].includes(name.toLowerCase());
    }

    private skipToNextMember(): void {
        // Skip tokens until we find a potential start of next member or closing brace
        // Use balanced brace counting to avoid skipping past the end of method bodies
        let braceDepth = 0;
        
        while (!this.tokenStream.eof()) {
            const token = this.tokenStream.peek();
            
            // Track brace depth to handle nested blocks properly
            if (token.value === '{') {
                braceDepth++;
                this.tokenStream.next();
            } else if (token.value === '}') {
                if (braceDepth > 0) {
                    braceDepth--;
                    this.tokenStream.next();
                    // If we've balanced out all braces, we've reached the end of the current member
                    if (braceDepth === 0) {
                        break;
                    }
                } else {
                    // We've hit a closing brace at the class level - stop here
                    break;
                }
            } else if (token.value === ';' && braceDepth === 0) {
                // Semicolon at class level - likely end of member declaration
                this.tokenStream.next();
                break;
            } else {
                this.tokenStream.next();
            }
        }
    }



    private getCurrentClassName(): string | null {
        return this.currentClassName;
    }

    /**
     * Parse method body with error recovery and optional semicolon handling
     * Returns the parsed body and the end position
     */
    private parseMethodBodyWithRecovery(methodType: string): { body: BlockStatement | undefined; endPos: Position } {
        let body: BlockStatement | undefined;
        let endPos: Position = this.document.positionAt(this.tokenStream.peek().start); // Initialize with current position as fallback

        if (this.tokenStream.peek().value === '{') {
            try {
                body = this.statementParser.parseBlockStatement() as BlockStatement;
                endPos = body.end;
            } catch (error) {
                if (this.config.errorRecovery && error instanceof ParseError) {
                    // For parsing errors in method bodies, try to recover gracefully
                    if (this.config.lenientSemicolons && this.shouldSuppressError(error)) {
                        // Create a minimal empty body and skip to recovery point
                        const startPos = this.document.positionAt(this.tokenStream.peek().start);
                        
                        // Skip to the matching closing brace using balanced brace counting
                        this.skipToMatchingClosingBrace();

                        // Find the end position - should be at the closing brace now
                        const currentToken = this.tokenStream.peek();
                        if (currentToken.value === '}') {
                            // Consume the closing brace
                            const closingBrace = this.tokenStream.next();
                            endPos = this.document.positionAt(closingBrace.end);
                        } else {
                            endPos = this.document.positionAt(currentToken.start);
                        }

                        body = {
                            kind: 'BlockStatement',
                            uri: this.document.uri,
                            start: startPos,
                            end: endPos,
                            body: []
                        } as BlockStatement;
                    } else {
                        throw error;
                    }
                } else {
                    throw error;
                }
            }

            // Handle optional semicolon after method body block for lenient parsing
            if (this.tokenStream.peek().value === ';') {
                if (this.config.lenientSemicolons) {
                    // For core/engine files: silently consume the semicolon
                    const semiToken = this.tokenStream.next();
                    endPos = this.document.positionAt(semiToken.end);
                } else {
                    // For user files: report as warning but still consume
                    const semiToken = this.tokenStream.peek();
                    const error = new ParseError(
                        this.document.uri,
                        this.document.positionAt(semiToken.start).line + 1,
                        this.document.positionAt(semiToken.start).character + 1,
                        `Unnecessary semicolon after ${methodType} body - remove the ';' after '}'`
                    );
                    this.parseErrors.push(error);
                    const consumedSemi = this.tokenStream.next(); // consume it anyway to continue parsing
                    endPos = this.document.positionAt(consumedSemi.end);
                }
            }
        } else {
            const semiToken = this.tokenStream.peek();
            if (semiToken.value === ';') {
                this.tokenStream.next();
                endPos = this.document.positionAt(semiToken.end);
            } else {
                const semi = this.expectSemicolon();
                if (semi) {
                    endPos = this.document.positionAt(semi.end);
                }
                // If semi is null (lenient mode), endPos remains at the initialized fallback value
            }
        }

        return { body, endPos };
    }

    private parseConstructorDeclaration(modifiers: string[], annotations: string[][], declStartPos?: Position): MethodDeclNode {
        const nameToken = this.tokenStream.next(); // consume constructor name
        const nameStart = this.document.positionAt(nameToken.start);
        const nameEnd = this.document.positionAt(nameToken.end);

        const parameters = this.parseParameterList();
        const { body, endPos } = this.parseMethodBodyWithRecovery('constructor');

        return {
            kind: 'MethodDecl',
            uri: this.document.uri,
            start: declStartPos || nameStart, // Use declStartPos if provided
            end: endPos,
            name: nameToken.value,
            nameStart,
            nameEnd,
            modifiers,
            annotations,
            returnType: {
                kind: 'TypeReference',
                uri: this.document.uri,
                start: nameStart,
                end: nameEnd,
                name: 'void'
            },
            parameters,
            body,
            isConstructor: true
        };
    }

    private parseDestructorDeclaration(modifiers: string[], annotations: string[][], declStartPos?: Position): MethodDeclNode {
        const tildeStart = this.document.positionAt(this.tokenStream.peek().start); // Position of ~
        this.expectToken('~'); // consume ~
        const nameToken = this.expectIdentifier();
        const nameStart = this.document.positionAt(nameToken.start);
        const nameEnd = this.document.positionAt(nameToken.end);

        const parameters = this.parseParameterList();
        const { body, endPos } = this.parseMethodBodyWithRecovery('destructor');

        return {
            kind: 'MethodDecl',
            uri: this.document.uri,
            start: declStartPos || tildeStart, // Use declStartPos if provided, otherwise tilde position
            end: endPos,
            name: `~${nameToken.value}`,
            nameStart,
            nameEnd,
            modifiers,
            annotations,
            returnType: {
                kind: 'TypeReference',
                uri: this.document.uri,
                start: nameStart,
                end: nameEnd,
                name: 'void'
            },
            parameters,
            body,
            isDestructor: true
        };
    }

    private parseMethodDeclaration(modifiers: string[], annotations: string[][], returnType: TypeNode, nameToken: Token, declStartPos?: Position): MethodDeclNode {
        const nameStart = this.document.positionAt(nameToken.start);
        const nameEnd = this.document.positionAt(nameToken.end);
        this.expectToken('('); // Expect opening parenthesis
        const parameters = this.parseParameterList();
        this.expectToken(')'); // Expect closing parenthesis

        // Extract local variables from method body
        let locals: VarDeclNode[] = [];
        let body: BlockStatement | undefined;
        let endPos: Position = nameEnd; // Initialize with nameEnd as fallback
        const nextToken = this.tokenStream.peek();
        if (nextToken.value === '{') {
            // Save the position of the opening brace for recovery
            const openBracePosition = this.tokenStream.getPosition();
            

            
            try {
                body = this.statementParser.parseBlockStatement() as BlockStatement;
                endPos = body.end;
                
                // Validation: check if method body parsing left us in an unexpected position
                const nextToken = this.tokenStream.peek();
                
                // If we encounter control flow keywords after method body parsing,
                // it indicates that parseBlockStatement didn't consume the full method body
                if (nextToken.kind === TokenKind.KeywordControl && 
                    ['if', 'for', 'while', 'break', 'continue'].includes(nextToken.value)) {
                    throw new Error(`Incomplete method body parsing for '${nameToken.value}' - found control flow statement`);
                }
                
                // Use visitor to collect all variable declarations from the method body
                const collector = new VariableDeclarationCollector();
                locals = collector.visit(body);
            } catch (error) {
                // Enhanced error recovery for method body parsing - catch ALL errors, not just ParseError

                
                // Always report the error if it's a ParseError
                if (error instanceof ParseError && !this.shouldSuppressError(error)) {
                    this.parseErrors.push(error);
                }
                
                // Create a minimal empty body and skip to recovery point
                const startPos = this.document.positionAt(nextToken.start);
                
                // Reset to the opening brace position and skip to matching closing brace
                this.tokenStream.setPosition(openBracePosition);
                this.tokenStream.next(); // Move past the opening brace
                

                
                // Skip to the matching closing brace using balanced counting
                this.skipToMatchingClosingBrace();

                // Find the end position - should be at the closing brace now
                const currentToken = this.tokenStream.peek();
                

                
                if (currentToken.value === '}') {
                    // Consume the closing brace
                    const closingBrace = this.tokenStream.next();
                    endPos = this.document.positionAt(closingBrace.end);
                    

                } else {
                    endPos = this.document.positionAt(currentToken.start);
                    

                }

                body = {
                    kind: 'BlockStatement',
                    uri: this.document.uri,
                    start: startPos,
                    end: endPos,
                    body: []
                } as BlockStatement;
                
                // For non-ParseError exceptions, create a generic error report
                if (!(error instanceof ParseError)) {
                    const genericError = new ParseError(
                        this.document.uri,
                        this.document.positionAt(nextToken.start).line + 1,
                        this.document.positionAt(nextToken.start).character + 1,
                        `Method body parsing failed: ${error instanceof Error ? error.message : String(error)}`
                    );
                    if (!this.shouldSuppressError(genericError)) {
                        this.parseErrors.push(genericError);
                    }
                }
            }

            // Handle semicolon after method body block 
            // This supports patterns like: void method(){code}; (common in EnScript)
            const afterBodyToken = this.tokenStream.peek();
            if (afterBodyToken.value === ';') {
                if (this.config.lenientSemicolons) {
                    // For core/engine files: silently consume the semicolon
                    const semiToken = this.tokenStream.next();
                    endPos = this.document.positionAt(semiToken.end);
                } else {
                    // For user files: report as warning but still consume (unless suppressed)
                    const semiToken = this.tokenStream.peek();
                    if (!this.config.suppressStylisticWarnings) {
                        const error = new ParseError(
                            this.document.uri,
                            this.document.positionAt(semiToken.start).line + 1,
                            this.document.positionAt(semiToken.start).character + 1,
                            `Unnecessary semicolon after method body - remove the ';' after '}'`
                        );
                        this.parseErrors.push(error);
                    }
                    const consumedSemi = this.tokenStream.next(); // consume it anyway to continue parsing
                    endPos = this.document.positionAt(consumedSemi.end);
                }
            } else {
                // For both lenient and strict parsing: method bodies should NOT have semicolons
                // This is correct EnScript syntax: void method() { /* body */ }
                // Only method declarations without bodies need semicolons: void method();
                // Just use the current position (end of method body) - this is correct
            }
        } else {
            const semiToken = this.tokenStream.peek();
            if (semiToken.value === ';') {
                this.tokenStream.next();
                endPos = this.document.positionAt(semiToken.end);
            } else {
                const semi = this.expectSemicolon();
                if (semi) {
                    endPos = this.document.positionAt(semi.end);
                }
                // If semi is null (lenient mode), endPos remains at nameEnd
            }
        }

        // Check if this is a constructor or destructor based on the method name
        const isConstructor = nameToken.value === this.getCurrentClassName();
        const isDestructor = nameToken.value.startsWith('~');

        // destructor cannot have parameters
        if (isDestructor) {
            if (parameters.length > 0) {
                const error = new ParseError(
                    this.document.uri,
                    nameStart.line + 1,
                    nameStart.character + 1,
                    `Destructor '${nameToken.value}' cannot have parameters`
                );
                this.parseErrors.push(error);
            }
        }

        if ((isConstructor || isDestructor)) {
                // returnType node kind must be TypeReference with name 'void'
                if (returnType.kind !== 'TypeReference' || returnType.name !== 'void') {
                const error = new ParseError(
                    this.document.uri,
                    nameStart.line + 1,
                    nameStart.character + 1,
                    `${isConstructor ? 'Constructor' : 'Destructor'} '${nameToken.value}' must have return type 'void'`
                );
                this.parseErrors.push(error);
            }
        }

        return {
            kind: 'MethodDecl',
            uri: this.document.uri,
            start: declStartPos || returnType.start, // Use declStartPos if provided (includes modifiers)
            end: endPos,
            name: nameToken.value,
            nameStart,
            nameEnd,
            modifiers,
            annotations,
            returnType,
            parameters,
            body,
            locals,
            isConstructor,
            isDestructor
        };
    }

    /**
     * Parse multiple field declarations (comma-separated)
     * Example: protected float m_PosX, m_PosY;
     */
    private parseFieldDeclarations(modifiers: string[], annotations: string[][], type: TypeNode, firstNameToken: Token, declStartPos?: Position): VarDeclNode[] {
        const declarations: VarDeclNode[] = [];

        // Parse the first variable (use declStartPos for the first one)
        declarations.push(this.createFieldDeclaration(modifiers, annotations, type, firstNameToken, declStartPos));

        // Parse additional comma-separated variables
        while (this.tokenStream.peek().value === ',') {
            this.tokenStream.next(); // consume ','

            const nameToken = this.expectIdentifier();
            // For subsequent fields in the comma list, start from the type position
            declarations.push(this.createFieldDeclaration(modifiers, annotations, type, nameToken, type.start));
        }

        // Capture semicolon position and update all declarations to include it
        const semiToken = this.tokenStream.peek();
        if (semiToken.value === ';') {
            const semiEndPos = this.document.positionAt(semiToken.end);
            this.expectSemicolonWithRecovery();
            // Update all declarations to include the semicolon
            for (const decl of declarations) {
                decl.end = semiEndPos;
            }
        } else {
            // Enhanced semicolon handling with better error recovery
            this.expectSemicolonWithRecovery();
        }

        return declarations;
    }

    /**
     * Create a field declaration (delegates to createVariableDeclaration)
     */
    private createFieldDeclaration(modifiers: string[], annotations: string[][], type: TypeNode, nameToken: Token, declStartPos?: Position): VarDeclNode {
        return this.createVariableDeclaration(modifiers, annotations, type, nameToken, declStartPos);
    }

    private extractMembersFromBody(body: BlockStatement): Declaration[] {
        const members: Declaration[] = [];

        for (const stmt of body.body) {
            if (stmt.kind === 'DeclarationStatement') {
                members.push((stmt as DeclarationStatement).declaration);
            } else if (stmt.kind === 'ExpressionStatement') {
                // Some class members might be parsed as expression statements
                // Try to convert them to declarations if possible
                const expr = (stmt as ExpressionStatement).expression;
                if (expr && expr.kind === 'CallExpression') {
                    // Could be a method call or constructor - skip for now
                    continue;
                }
            }
            // Add other statement types that could represent class members
        }

        return members;
    }

    private parseEnumMembers(): EnumMemberDeclNode[] {
        const members: EnumMemberDeclNode[] = [];

        while (this.tokenStream.peek().value !== '}' && !this.tokenStream.eof()) {
            const nameToken = this.expectIdentifier();
            const nameStart = this.document.positionAt(nameToken.start);
            const nameEnd = this.document.positionAt(nameToken.end);

            let value: Expression | undefined;
            let endPos = nameEnd;

            if (this.tokenStream.peek().value === '=') {
                this.tokenStream.next(); // consume '='
                value = this.expressionParser.parseExpression();
                endPos = value?.end || endPos;
            }

            members.push({
                kind: 'EnumMemberDecl',
                uri: this.document.uri,
                start: nameStart,
                end: endPos,
                name: nameToken.value,
                nameStart,
                nameEnd,
                modifiers: [],
                annotations: [],
                value
            });

            // Handle comma separator with leniency for engine files
            const nextToken = this.tokenStream.peek();
            if (nextToken.value === ',') {
                this.tokenStream.next(); // consume ','
            } else if (nextToken.value === '}') {
                // End of enum - this is expected
                break;
            } else if (nextToken.kind === TokenKind.Identifier) {
                // Missing comma but next token is an identifier (likely another enum member)
                // For engine files (lenient), don't show diagnostics at all
                if (!this.config.lenientSemicolons) {
                    // Workspace file - show diagnostic for missing comma
                    const error = new ParseError(
                        this.document.uri,
                        this.document.positionAt(nextToken.start).line + 1,
                        this.document.positionAt(nextToken.start).character + 1,
                        `Expected ',' or '}' in enum, got '${nextToken.value}'`
                    );
                    this.parseErrors.push(error);
                }
                // For engine files, just continue silently without adding any diagnostic

                // Continue parsing the next enum member
                continue;
            } else {
                // Unexpected token - break to avoid infinite loop
                break;
            }
        }

        return members;
    }

    private parseParameterList(): ParameterDeclNode[] {
        const params: ParameterDeclNode[] = [];

        // Check for empty parameter list
        if (this.tokenStream.peek().value === ')') {
            return params;
        }

        let paramCount = 0;
        while (this.tokenStream.peek().value !== ')' && !this.tokenStream.eof()) {
            paramCount++;

            const startPos = this.document.positionAt(this.tokenStream.peek().start);

            // Parse parameter modifiers with enhanced error recovery
            const parameterModifiers: string[] = [];
            const validParameterModifiers = ['out', 'inout', 'notnull', 'ref', 'const', 'owned', 'local'];

            while (isModifier(this.tokenStream.peek()) && 
                   validParameterModifiers.includes(this.tokenStream.peek().value)) {
                parameterModifiers.push(this.tokenStream.next().value);
            }
            
            // Handle any invalid modifiers
            if (isModifier(this.tokenStream.peek()) && 
                !validParameterModifiers.includes(this.tokenStream.peek().value)) {
                const modifierToken = this.tokenStream.peek();
                // Found a modifier, but not valid for parameters
                const error = new ParseError(
                    this.document.uri,
                    this.document.positionAt(modifierToken.start).line + 1,
                    this.document.positionAt(modifierToken.start).character + 1,
                    `Invalid parameter modifier '${modifierToken.value}'. Valid modifiers are: ${validParameterModifiers.join(', ')}`
                );
                this.parseErrors.push(error);
                this.tokenStream.next(); // consume the invalid modifier
            }

            // Parse parameter type with error recovery
            let type: TypeNode;
            try {
                type = this.parseType();
            } catch (error) {
                if (error instanceof ParseError) {
                    // Add contextual information for type parsing errors in parameters
                    const contextualError = new ParseError(
                        this.document.uri,
                        error.line,
                        error.column,
                        `Error parsing parameter type: ${error.message}. Expected a valid type name.`
                    );
                    this.parseErrors.push(contextualError);

                    // Create a dummy type to continue parsing
                    type = {
                        kind: 'TypeReference',
                        uri: this.document.uri,
                        start: this.document.positionAt(this.tokenStream.peek().start),
                        end: this.document.positionAt(this.tokenStream.peek().end),
                        name: 'unknown'
                    };
                } else {
                    throw error;
                }
            }

            // Parse parameter name with better error messages
            let nameToken: Token;
            try {
                nameToken = this.expectIdentifier();
            } catch (error) {
                if (error instanceof ParseError) {
                    // Provide better context for parameter name errors
                    const contextualError = new ParseError(
                        this.document.uri,
                        error.line,
                        error.column,
                        `Expected parameter name after type '${type.kind === 'TypeReference' ? (type as TypeReferenceNode).name : 'unknown'}'. Got '${this.tokenStream.peek().value}' instead.`
                    );
                    this.parseErrors.push(contextualError);

                    // Create a dummy name to continue parsing
                    nameToken = {
                        kind: TokenKind.Identifier,
                        value: `param${paramCount}`,
                        start: this.tokenStream.peek().start,
                        end: this.tokenStream.peek().end
                    };
                } else {
                    throw error;
                }
            }
            const nameStart = this.document.positionAt(nameToken.start);
            let nameEnd = this.document.positionAt(nameToken.end);

            // Handle array dimensions after parameter name: paramName[] or paramName[4][2]
            while (this.tokenStream.peek().value === '[') {
                this.tokenStream.next(); // consume '['

                let size: Expression | undefined;
                if (this.tokenStream.peek().value !== ']') {
                    size = this.expressionParser.parseExpression();
                }

                const endToken = this.expectToken(']');
                nameEnd = this.document.positionAt(endToken.end);

                // Create array type wrapper (nested for multidimensional arrays)
                type = {
                    kind: 'ArrayType',
                    uri: this.document.uri,
                    start: type.start,
                    end: this.document.positionAt(endToken.end),
                    elementType: type,
                    size
                };
            }

            // Parse optional default value
            let defaultValue: Expression | undefined;
            let endPos = nameEnd;

            if (this.tokenStream.peek().value === '=') {
                this.tokenStream.next(); // consume '='
                defaultValue = this.expressionParser.parseExpression();
                endPos = defaultValue?.end || endPos;
            }

            params.push({
                kind: 'ParameterDecl',
                uri: this.document.uri,
                start: startPos,
                end: endPos,
                name: nameToken.value,
                nameStart,
                nameEnd,
                modifiers: parameterModifiers,
                annotations: [],
                type,
                defaultValue
            });

            if (this.tokenStream.peek().value === ',') {
                this.tokenStream.next(); // consume ','
            } else {
                break;
            }
        }

        return params;
    }

    private looksLikeFunctionDeclaration(): boolean {
        const saved = this.tokenStream.getPosition();

        try {
            // Skip modifiers
            while (isModifier(this.tokenStream.peek())) {
                this.tokenStream.next();
            }

            // Parse potential return type (including type modifiers like volatile, const)
            // Skip type modifiers first
            while (this.tokenStream.peek().kind === TokenKind.KeywordStorage &&
                ['ref', 'reference', 'const', 'volatile', 'notnull', 'autoptr', 'out', 'inout', 'owned'].includes(this.tokenStream.peek().value)) {
                this.tokenStream.next();
            }
            
            const nextToken = this.tokenStream.peek();
            if (nextToken.kind === TokenKind.Identifier || nextToken.kind === TokenKind.KeywordType) {
                this.tokenStream.next();

                // Skip generic args if present
                if (this.tokenStream.peek().value === '<') {
                    this.skipGenericArguments();
                }

                // Skip array dimensions if present  
                while (this.tokenStream.peek().value === '[') {
                    this.skipArrayDimension();
                }
            }

            // Must be followed by identifier (function name)
            if (this.tokenStream.peek().kind !== TokenKind.Identifier) {
                return false;
            }
            this.tokenStream.next();

            // Skip generic parameters if present
            if (this.tokenStream.peek().value === '<') {
                this.skipGenericArguments();
            }

            // Must be followed by '(' for parameters
            return this.tokenStream.peek().value === '(';

        } catch {
            return false;
        } finally {
            this.tokenStream.setPosition(saved);
        }
    }

    private skipGenericArguments(): void {
        if (this.tokenStream.peek().value === '<') {
            this.tokenStream.next(); // consume '<'
            let depth = 1;

            while (depth > 0 && !this.tokenStream.eof()) {
                const token = this.tokenStream.next();
                if (token.value === '<') depth++;
                else if (token.value === '>') depth--;
            }
        }
    }

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

    private handlePreprocessorDirective(): void {
        // Same implementation as in original parser
        const token = this.tokenStream.nextRaw();
        const directive = token.value.trim();

        if (directive.startsWith('#ifdef ')) {
            const symbol = directive.substring(7).trim();
            const isTrue = this.definedSymbols.has(symbol);
            this.preprocessorStack.push({ type: 'ifdef', symbol, isTrue });
        } else if (directive.startsWith('#ifndef ')) {
            const symbol = directive.substring(8).trim();
            const isTrue = !this.definedSymbols.has(symbol);
            this.preprocessorStack.push({ type: 'ifndef', symbol, isTrue });
        } else if (directive === '#else') {
            if (this.preprocessorStack.length > 0) {
                const current = this.preprocessorStack[this.preprocessorStack.length - 1];
                current.isTrue = !current.isTrue;
            }
        } else if (directive === '#endif') {
            if (this.preprocessorStack.length > 0) {
                this.preprocessorStack.pop();
            }
        } else if (directive.startsWith('#define ')) {
            const symbol = directive.substring(8).trim().split(' ')[0];
            this.definedSymbols.add(symbol);
        } else if (directive.startsWith('#undef ')) {
            const symbol = directive.substring(7).trim();
            this.definedSymbols.delete(symbol);
        }
    }

    private isInActiveBlock(): boolean {
        return this.preprocessorStack.every(condition => condition.isTrue);
    }

    private shouldSuppressError(error: ParseError): boolean {
        if (!this.config.lenientSemicolons) {
            return false;
        }

        const message = error.message.toLowerCase();

        // Suppress semicolon-related errors
        if (message.includes('semicolon') ||
            message.includes('expected \';\'') ||
            (message.includes('expected') && message.includes('\';\''))) {
            return true;
        }

        // Suppress comma-related errors
        if (message.includes('comma') ||
            message.includes('expected \',\'') ||
            (message.includes('expected') && message.includes('\',\''))) {
            return true;
        }

        // Suppress brace-related errors
        if (message.includes('expected \'}\'') ||
            (message.includes('expected') && message.includes('\'}\''))) {
            return true;
        }

        // Suppress "Expected identifier" errors for common keywords that appear in valid syntax positions
        // This handles cases like if-else statements in switch cases where the parser gets confused about context
        if (message.includes('expected identifier')) {
            // Check if the error is about common keywords that are valid in their context
            if (message.includes('got \'else\'') ||
                message.includes('got \'break\'') ||
                message.includes('got \'continue\'') ||
                message.includes('got \'case\'') ||
                message.includes('got \'default\'') ||
                message.includes('got \'if\'') ||
                message.includes('got \'while\'') ||
                message.includes('got \'for\'') ||
                message.includes('got \'switch\'') ||
                message.includes('got \'return\'')) {
                return true;
            }

            // Also suppress identifier errors for operators that might appear in valid expression contexts
            if (message.includes('got \'=\'') ||
                message.includes('got \'++\'') ||
                message.includes('got \'--\'') ||
                message.includes('got \'+\'') ||
                message.includes('got \'-\'') ||
                message.includes('got \'*\'') ||
                message.includes('got \'/\'') ||
                message.includes('got \'(\'') ||
                message.includes('got \')\'') ||
                message.includes('got \'[\'') ||
                message.includes('got \']\'') ||
                message.includes('got \'.\'') ||
                message.includes('got \':\'')) {
                return true;
            }
        }

        return false;
    }

    private recoverFromError(strategy?: string, errorContext?: string): void {
        // Delegate to appropriate recovery strategy based on context
        const errorMessage = errorContext || 'parsing error';
        
        if (strategy?.includes('declaration') || strategy?.includes('variable') || strategy?.includes('function')) {
            // Use declaration recovery strategy
            const result = this.declarationRecovery.handleVariableDeclarationError(this.tokenStream, errorMessage);
            this.applyDeclarationRecoveryResult(result);
        } else if (strategy?.includes('type')) {
            // Use type recovery strategy  
            const result = this.typeRecovery.handleBasicTypeError(this.tokenStream, errorMessage);
            this.applyTypeRecoveryResult(result);
        } else if (strategy?.includes('preprocessor') || strategy?.includes('define') || strategy?.includes('include')) {
            // Use preprocessor recovery strategy
            const result = this.preprocessorRecovery.handleConditionalDirectiveError(this.tokenStream, errorMessage, 'ifdef');
            this.applyPreprocessorRecoveryResult(result);
        } else {
            // Fallback to generic recovery using base strategy through declaration recovery
            const recoveryTokens = [';', '}', '{'];
            const recoveryKeywords = [TokenKind.KeywordDeclaration, TokenKind.KeywordType];
            const result = this.declarationRecovery.skipToRecoveryPoint(this.tokenStream, recoveryTokens, recoveryKeywords, strategy);
            this.applyBaseRecoveryResult(result);
        }
    }

    /**
     * Apply the result from a declaration recovery strategy
     */
    private applyDeclarationRecoveryResult(result: RecoveryResult): void {
        if (result.syntheticToken) {
            this.tokenStream.insertToken(result.syntheticToken);
        }
        
        if (result.recoveredPosition !== undefined) {
            this.tokenStream.setPosition(result.recoveredPosition);
        }
    }

    /**
     * Apply the result from a type recovery strategy
     */
    private applyTypeRecoveryResult(result: RecoveryResult): void {
        if (result.syntheticToken) {
            this.tokenStream.insertToken(result.syntheticToken);
        }
        
        if (result.recoveredPosition !== undefined) {
            this.tokenStream.setPosition(result.recoveredPosition);
        }
    }

    /**
     * Apply the result from a preprocessor recovery strategy
     */
    private applyPreprocessorRecoveryResult(result: RecoveryResult): void {
        if (result.syntheticToken) {
            this.tokenStream.insertToken(result.syntheticToken);
        }
        
        if (result.recoveredPosition !== undefined) {
            this.tokenStream.setPosition(result.recoveredPosition);
        }
    }

    /**
     * Apply the result from a base recovery strategy
     */
    private applyBaseRecoveryResult(result: RecoveryResult): void {
        if (result.recoveredPosition !== undefined) {
            this.tokenStream.setPosition(result.recoveredPosition);
        }
    }

    /**
     * Skip to the matching closing brace
     * Uses balanced brace counting to ensure we find the correct closing brace
     * @param alreadyInside - If true, assumes we're already inside (braceCount starts at 1)
     * @param moveBackToClosingBrace - If true, positions at the closing brace instead of after it
     */
    private skipToMatchingClosingBrace(alreadyInside: boolean = true, moveBackToClosingBrace: boolean = true): void {
        let braceCount = alreadyInside ? 1 : 0;
        
        // If not already inside, consume the opening brace if present
        if (!alreadyInside && this.tokenStream.peek().value === '{') {
            this.tokenStream.next();
            braceCount = 1;
        }
        
        while (!this.tokenStream.eof() && braceCount > 0) {
            const token = this.tokenStream.next();
            
            if (token.value === '{') {
                braceCount++;
            } else if (token.value === '}') {
                braceCount--;
            }
        }
        
        // Move back one position so we're positioned at the closing brace (not after it)
        if (moveBackToClosingBrace && !this.tokenStream.eof()) {
            this.tokenStream.setPosition(this.tokenStream.getPosition() - 1);
        }
    }

    /**
     * Attempt to recover partial declarations when parsing fails using recovery strategies
     */
    private attemptPartialRecovery(error: ParseError): Declaration[] {
        const recovered: Declaration[] = [];

        try {
            // Look backward in the token stream to identify the context
            const originalPos = this.tokenStream.getPosition();
            
            // In IDE mode, try to extract the failed class name from the parsing context
            let ideRecoveryDone = false;
            if (this.config.ideMode && error.message.includes("Expected '}'")) {
                const failedClassName = this.extractFailedClassName();
                if (failedClassName) {
                    const partialClass = this.createPartialClassByName(failedClassName);
                    if (partialClass) {
                        recovered.push(partialClass);
                        ideRecoveryDone = true;
                        
                        // Advance to end to prevent re-parsing the same content
                        while (!this.tokenStream.eof()) {
                            this.tokenStream.next();
                        }
                    }
                }
            }
            
            // Standard backward search for other cases (skip if IDE recovery already succeeded)
            if (!ideRecoveryDone) {
                const searchPos = Math.max(0, originalPos - 20); // Increased search range
                
                // Scan backwards to identify what kind of declaration we were parsing
                for (let pos = originalPos - 1; pos >= searchPos; pos--) {
                this.tokenStream.setPosition(pos);
                const token = this.tokenStream.peek();

                // Attempt class declaration recovery
                if (token.value === 'class') {
                    // In IDE mode, try to create a partial class declaration
                    if (this.config.ideMode) {
                        const partialClass = this.parsePartialClassDeclaration();
                        if (partialClass) {
                            recovered.push(partialClass);
                            
                            // Try to advance past the problematic content
                            this.tokenStream.setPosition(originalPos);
                            // Skip to end of class or file
                            while (!this.tokenStream.eof()) {
                                const nextToken = this.tokenStream.peek();
                                if (nextToken.value === '}' && this.tokenStream.getPosition() > originalPos) {
                                    this.tokenStream.next(); // consume the closing brace
                                    break;
                                }
                                this.tokenStream.next();
                            }
                            break;
                        }
                    }
                    
                    const result = this.declarationRecovery.handleClassDeclarationError(
                        this.tokenStream, 
                        error.message, 
                        'partial_recovery'
                    );
                    
                    this.applyDeclarationRecoveryResult(result);
                    break;
                }

                // Attempt function declaration recovery  
                if (token.value === 'function' || token.kind === TokenKind.KeywordType) {
                    const result = this.declarationRecovery.handleFunctionDeclarationError(
                        this.tokenStream,
                        error.message,
                        'partial_recovery'
                    );
                    
                    this.applyDeclarationRecoveryResult(result);
                    break;
                }

                // Attempt enum declaration recovery
                if (token.value === 'enum') {
                    const result = this.declarationRecovery.handleEnumDeclarationError(
                        this.tokenStream,
                        error.message,
                        'partial_recovery'
                    );
                    
                    this.applyDeclarationRecoveryResult(result);
                    break;
                }
                }
            }

            // Restore position
            this.tokenStream.setPosition(originalPos);
        } catch {
            // Partial recovery failed - restore position
            this.tokenStream.setPosition(this.tokenStream.getPosition());
        }

        return recovered;
    }

    /**
     * Try to extract the name of the class that failed to parse from the parsing context
     */
    private extractFailedClassName(): string | null {
        // Look at the most recent tokens to find a class declaration pattern
        const recentTokens = this.tokenStream.getRecentTokens(50); // Look at last 50 tokens
        
        // Find the most recent "class ClassName" pattern
        for (let i = recentTokens.length - 1; i >= 1; i--) {
            if (recentTokens[i - 1]?.value === 'class' && 
                recentTokens[i]?.kind === TokenKind.Identifier) {
                return recentTokens[i].value;
            }
        }
        
        return null;
    }

    /**
     * Create a partial class declaration with a specific name
     */
    private createPartialClassByName(className: string): ClassDeclNode | null {
        // Create a minimal class declaration
        const position = this.document.positionAt(0);
        
        return {
            kind: 'ClassDecl',
            uri: this.document.uri,
            start: position,
            end: position,
            name: className,
            nameStart: position,
            nameEnd: position,
            modifiers: [],
            annotations: [],
            genericParameters: undefined,
            baseClass: undefined,
            members: [], // Empty members array
            body: {
                kind: 'BlockStatement',
                uri: this.document.uri,
                start: position,
                end: position,
                body: []
            }
        };
    }

    /**
     * Parse a partial class declaration with minimal validation
     */
    private parsePartialClassDeclaration(): ClassDeclNode | null {
        try {
            const startToken = this.expectToken('class');
            const startPos = this.document.positionAt(startToken.start);

            const nameToken = this.expectIdentifier();
            const nameStart = this.document.positionAt(nameToken.start);
            const nameEnd = this.document.positionAt(nameToken.end);

            // Skip optional generic parameters safely
            if (this.tokenStream.peek().value === '<') {
                // Find matching '>'
                let bracketCount = 0;
                while (!this.tokenStream.eof()) {
                    const token = this.tokenStream.peek();
                    if (token.value === '<') bracketCount++;
                    else if (token.value === '>') bracketCount--;
                    this.tokenStream.next();
                    if (bracketCount === 0) break;
                }
            }

            // Skip optional base class safely
            if (this.tokenStream.peek().value === 'extends' || this.tokenStream.peek().value === ':') {
                this.tokenStream.next(); // consume 'extends' or ':'
                // Skip to opening brace
                while (!this.tokenStream.eof() && this.tokenStream.peek().value !== '{') {
                    this.tokenStream.next();
                }
            }

            // Create minimal class with empty body
            const endPos = nameEnd;

            return {
                kind: 'ClassDecl',
                uri: this.document.uri,
                start: startPos,
                end: endPos,
                name: nameToken.value,
                nameStart,
                nameEnd,
                modifiers: [],
                annotations: [],
                genericParameters: undefined,
                baseClass: undefined,
                body: { kind: 'BlockStatement', uri: this.document.uri, start: endPos, end: endPos, body: [] },
                members: []
            };
        } catch {
            return null;
        }
    }

    private expectToken(value: string): Token {
        const token = this.tokenStream.peek();

        // Special handling for '>>' when expecting '>' (for nested generic types)
        if (value === '>' && token.value === '>>') {
            // Split '>>' into two '>' tokens
            const originalToken = this.tokenStream.next(); // consume the '>>' token

            // Create the first '>' token we're returning
            const firstGTToken: Token = {
                kind: originalToken.kind,
                value: '>',
                start: originalToken.start,
                end: originalToken.start + 1 // First character of '>>'
            };

            // Create the second '>' token to inject back into the stream
            const secondGTToken: Token = {
                kind: originalToken.kind,
                value: '>',
                start: originalToken.start + 1, // Second character of '>>'
                end: originalToken.end
            };

            // Insert the second '>' token back into the stream at the current position
            // This effectively splits the '>>' token into two separate '>' tokens
            this.tokenStream.insertToken(secondGTToken);

            return firstGTToken;
        }

        if (token.value !== value) {
            throw new ParseError(
                this.document.uri,
                this.document.positionAt(token.start).line + 1,
                this.document.positionAt(token.start).character + 1,
                `Expected '${value}', got '${token.value}'`
            );
        }
        return this.tokenStream.next();
    }

    private expectIdentifier(context?: 'class-name' | 'enum-name' | 'typedef-name' | 'parameter' | 'variable' | 'default'): Token {
        const token = this.tokenStream.next();

        // Allow destructor names like ~Foo
        if (token.kind === TokenKind.Operator && token.value === '~' &&
            this.tokenStream.peek().kind === TokenKind.Identifier) {
            const idToken = this.tokenStream.next();
            return {
                kind: TokenKind.Identifier,
                value: '~' + idToken.value,
                start: token.start,
                end: idToken.end
            };
        }

        if (token.kind !== TokenKind.Identifier) {
            // Only class declarations can use type keywords as names (e.g., "class int {}")
            if (context === 'class-name' && token.kind === TokenKind.KeywordType) {
                return token; // Allow "class int {}", "class string {}", etc.
            }

            let errorMessage = `Expected identifier, got '${token.value}'`;
            const suggestions: string[] = [];

            // Provide specific suggestions based on keyword type
            switch (token.kind) {
                case TokenKind.KeywordType:
                    errorMessage = `Expected identifier, got type keyword '${token.value}'. Type keywords cannot be used as identifiers`;
                    if (context === 'class-name') {
                        errorMessage += ` (Note: Only class names can use type keywords, e.g., 'class ${token.value} {}')`;
                    }
                    suggestions.push(`Use a different name (e.g., 'my${token.value}', '${token.value}Value')`);
                    break;
                case TokenKind.KeywordDeclaration:
                    errorMessage = `Expected identifier, got declaration keyword '${token.value}'. This keyword is used to start ${token.value === 'class' ? 'class' : token.value === 'enum' ? 'enum' : 'type'} declarations`;
                    if (context === 'enum-name' && token.value === 'class') {
                        errorMessage += ` (Note: EnScript does not allow 'enum class {}' - use 'enum IdentifierName {}' instead)`;
                    } else if (context === 'typedef-name' && token.value === 'class') {
                        errorMessage += ` (Note: EnScript does not allow 'typedef SomeType class' - use 'typedef SomeType IdentifierName' instead)`;
                    }
                    suggestions.push('Use a different name for the identifier');
                    break;
                case TokenKind.KeywordModifier:
                    errorMessage = `Expected identifier, got modifier '${token.value}'. Modifiers should appear before type declarations`;
                    suggestions.push('Check if this modifier is in the right position');
                    break;
                case TokenKind.KeywordControl:
                    errorMessage = `Expected identifier, got control flow keyword '${token.value}'. This keyword is used for ${token.value === 'if' ? 'conditionals' : token.value === 'for' ? 'loops' : 'control flow'}`;
                    suggestions.push(`Use a different name (e.g., '${token.value}Value', 'handle${token.value.charAt(0).toUpperCase() + token.value.slice(1)}')`);
                    break;
                case TokenKind.KeywordStorage:
                    errorMessage = `Expected identifier, got storage keyword '${token.value}'. This keyword modifies variable declarations`;
                    suggestions.push('Use a different name for the identifier');
                    break;

                case TokenKind.Number:
                    errorMessage += `. Identifiers cannot start with numbers`;
                    suggestions.push(`Use a letter or underscore first (e.g., 'value${token.value}', '_${token.value}')`);
                    break;
                case TokenKind.Punctuation:
                    if (token.value === '{' || token.value === '}') {
                        errorMessage += `. This might indicate a missing semicolon or unclosed block`;
                        suggestions.push('Check for missing semicolons in previous statements');
                        suggestions.push('Verify all code blocks are properly closed');
                    } else if (token.value === '(' || token.value === ')') {
                        errorMessage += `. Check for missing or extra parentheses`;
                        suggestions.push('Verify method call or expression syntax');
                    }
                    break;
                default:
                    suggestions.push('Ensure proper parameter or variable declaration syntax');
                    break;
            }

            const error = new ParseError(
                this.document.uri,
                this.document.positionAt(token.start).line + 1,
                this.document.positionAt(token.start).character + 1,
                errorMessage
            );

            // Add suggestions to the error message if we have any
            if (suggestions.length > 0) {
                error.message += `\nSuggestions: ${suggestions.join('; ')}`;
            }

            throw error;
        }

        return token;
    }

    /**
     * Expect a semicolon, but respect lenientSemicolons config for error handling
     */
    private expectSemicolon(): Token | null {
        const token = this.tokenStream.peek();
        if (token.value === ';') {
            return this.tokenStream.next();
        }

        // Create the error
        const error = new ParseError(
            this.document.uri,
            this.document.positionAt(token.start).line + 1,
            this.document.positionAt(token.start).character + 1,
            `Expected ';', got '${token.value}'`
        );
        // Check if we should suppress this error
        if (this.shouldSuppressError(error)) {
            // For engine files (lenient), don't add diagnostic at all
            // BUT we must still continue parsing - don't expect the semicolon
            // This prevents infinite loops by not requiring the semicolon to advance
            return null; // Semicolon not found but suppressed
        }
        // Not suppressed, throw the error
        throw error;
    }

    /**
     * Expect a semicolon with enhanced error recovery for class member parsing
     */
    private expectSemicolonWithRecovery(): Token | null {
        const token = this.tokenStream.peek();
        if (token.value === ';') {
            return this.tokenStream.next();
        }

        // Missing semicolon - check what follows to improve recovery
        const nextToken = this.tokenStream.peek();

        // Check if the next token looks like the start of another class member
        const looksLikeNextMember = (
            // Type keywords that could start a field: int, float, string, bool, etc.
            (nextToken.kind === TokenKind.Identifier) ||
            // Modifiers
            isModifier(nextToken) ||
            // Closing brace (end of class)
            nextToken.value === '}' ||
            // Destructor
            nextToken.value === '~'
        );

        // Create the error
        const line = this.document.positionAt(nextToken.start).line + 1;
        const character = this.document.positionAt(nextToken.start).character + 1;
        const error = new ParseError(
            this.document.uri,
            line,
            character,
            `Expected ';' after field declaration, got '${nextToken.value}'`
        );

        if (this.shouldSuppressError(error)) {
            // In lenient mode, just continue without the semicolon
            return null;
        }

        if (looksLikeNextMember) {
            // The next token looks like another class member or end of class
            // This suggests we just have a missing semicolon, not a structural issue
            // Add the error but continue parsing instead of throwing
            this.parseErrors.push(error);
            return null;
        } else {
            // The next token doesn't look like a class member - this might be a structural issue
            throw error;
        }
    }

    private logParseResults(file: FileNode): void {
        Logger.info(`Parsed file with ${file.body.length} top-level declarations`);
        for (const decl of file.body) {
            Logger.debug(`  - ${decl.kind}: ${decl.name}`);
        }
    }

    /**
     * Skip to the matching closing brace for function body skipping
     */
    private skipToMatchingBrace(): void {
        this.skipToMatchingClosingBrace(false, false);
    }
}

