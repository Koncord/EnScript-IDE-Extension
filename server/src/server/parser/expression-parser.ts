/**
 * Improved Expression Parser with Proper Recursive Descent
 */

import { Token, TokenKind } from '../lexer/token';
import { typeKeywords } from '../lexer/rules';
import { TokenStream } from '../lexer/token-stream';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver';
import {
    Expression,
    BinaryExpression,
    UnaryExpression,
    AssignmentExpression,
    CallExpression,
    MemberExpression,
    ArrayAccessExpression,
    CastExpression,
    NewExpression,
    ConditionalExpression,
    Identifier,
    Literal,
    ArrayLiteralExpression,
    ThisExpression,
    SuperExpression,
    TypeNode,
    BinaryOperator,
    UnaryOperator,
    AssignmentOperator,
    LiteralType
} from '../ast/node-types';
import { ParseError } from '../ast/errors';
import { ExpressionRecoveryStrategy } from '../recovery/expression-recovery';
import { RecoveryAction } from '../recovery/recovery-actions';

/**
 * Operator precedence levels (higher number = higher precedence)
 */
const enum Precedence {
    ASSIGNMENT = 1,     // =, +=, -=, etc.
    CONDITIONAL = 2,    // ?:
    LOGICAL_OR = 3,     // ||
    LOGICAL_AND = 4,    // &&
    BITWISE_OR = 5,     // |
    BITWISE_XOR = 6,    // ^
    BITWISE_AND = 7,    // &
    EQUALITY = 8,       // ==, !=
    RELATIONAL = 9,     // <, >, <=, >=
    SHIFT = 10,         // <<, >>
    ADDITIVE = 11,      // +, -
    MULTIPLICATIVE = 12, // *, /, %
    UNARY = 13,         // +, -, !, ~, ++, --, &, *
    POSTFIX = 14,       // ++, --, [], (), .
    PRIMARY = 15        // literals, identifiers, parentheses
}

/**
 * Operator information for precedence parsing
 */
interface OperatorInfo {
    precedence: Precedence;
    rightAssociative?: boolean;
}

const ASSIGNMENT_OPERATORS: Record<string, OperatorInfo> = {
    '=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true },
    '+=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true },
    '-=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true },
    '*=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true },
    '/=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true },
    '%=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true },
    '&=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true },
    '|=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true },
    '^=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true },
    '<<=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true },
    '>>=': { precedence: Precedence.ASSIGNMENT, rightAssociative: true }
};

const UNARY_OPERATORS = new Set([
    '+', '-', '!', '~', '++', '--', '&', '*'
]);

export class ExpressionParser {
    private recoveryStrategy: ExpressionRecoveryStrategy;

    constructor(
        private tokenStream: TokenStream,
        private document: TextDocument,
        private onWarning?: (message: string, line: number, character: number) => void,
        private ideMode: boolean = false
    ) {
        this.recoveryStrategy = new ExpressionRecoveryStrategy(document, onWarning);
    }

    /**
     * Parse an expression with operator precedence
     */
    parseExpression(): Expression {
        return this.parseConditional();
    }

    /**
     * Parse conditional (ternary) expression: condition ? trueExpr : falseExpr
     */
    private parseConditional(): Expression {
        let expr = this.parseAssignment();

        if (this.tokenStream.peek().value === '?') {
            this.tokenStream.next(); // consume '?'
            const consequent = this.parseAssignment();
            this.expectToken(':');
            const alternate = this.parseConditional();

            expr = this.createConditionalExpression(expr, consequent, alternate);
        }

        return expr;
    }

    /**
     * Parse assignment expressions with right associativity
     */
    private parseAssignment(): Expression {
        let expr = this.parseLogicalOr();

        const token = this.tokenStream.peek();
        if (this.isAssignmentOperator(token.value)) {
            const operator = this.tokenStream.next().value as AssignmentOperator;
            const right = this.parseAssignment(); // Right associative

            expr = this.createAssignmentExpression(operator, expr, right);
        }

        return expr;
    }

    /**
     * Parse logical OR expressions
     */
    private parseLogicalOr(): Expression {
        return this.parseLogicalBinaryExpression(
            () => this.parseLogicalAnd(),
            ['||']
        );
    }

    /**
     * Parse logical AND expressions
     */
    private parseLogicalAnd(): Expression {
        return this.parseLogicalBinaryExpression(
            () => this.parseBitwiseOr(),
            ['&&']
        );
    }

    /**
     * Parse bitwise OR expressions
     */
    private parseBitwiseOr(): Expression {
        return this.parseLogicalBinaryExpression(
            () => this.parseBitwiseXor(),
            ['|']
        );
    }

    /**
     * Parse bitwise XOR expressions
     */
    private parseBitwiseXor(): Expression {
        return this.parseLogicalBinaryExpression(
            () => this.parseBitwiseAnd(),
            ['^']
        );
    }

    /**
     * Parse bitwise AND expressions
     */
    private parseBitwiseAnd(): Expression {
        return this.parseLogicalBinaryExpression(
            () => this.parseEquality(),
            ['&']
        );
    }

    /**
     * Parse equality expressions
     */
    private parseEquality(): Expression {
        return this.parseLogicalBinaryExpression(
            () => this.parseRelational(),
            ['==', '!=']
        );
    }

    /**
     * Parse relational expressions
     */
    private parseRelational(): Expression {
        return this.parseLogicalBinaryExpression(
            () => this.parseShift(),
            ['<', '>', '<=', '>=']
        );
    }

    /**
     * Parse shift expressions
     */
    private parseShift(): Expression {
        return this.parseLogicalBinaryExpression(
            () => this.parseAdditive(),
            ['<<', '>>']
        );
    }

    /**
     * Parse additive expressions
     */
    private parseAdditive(): Expression {
        return this.parseLogicalBinaryExpression(
            () => this.parseMultiplicative(),
            ['+', '-']
        );
    }

    /**
     * Parse multiplicative expressions
     */
    private parseMultiplicative(): Expression {
        return this.parseLogicalBinaryExpression(
            () => this.parseUnary(),
            ['*', '/', '%']
        );
    }

    /**
     * Parse unary expressions
     */
    private parseUnary(): Expression {
        const token = this.tokenStream.peek();

        if (this.isUnaryOperator(token.value) || this.isKeywordUnaryOperator(token)) {
            const operator = this.tokenStream.next().value as UnaryOperator;
            const operand = this.parseUnary(); // Right associative

            return this.createUnaryExpression(operator, operand, true);
        }

        return this.parsePostfix();
    }

    /**
     * Parse postfix expressions (calls, member access, array access, etc.)
     */
    private parsePostfix(): Expression {
        let expr = this.parsePrimary();

        while (true) {
            const token = this.tokenStream.peek();

            if (token.value === '(') {
                // Function call
                expr = this.parseCallExpression(expr);
            } else if (token.value === '[') {
                // Array access
                expr = this.parseArrayAccessExpression(expr);
            } else if (token.value === '.' || token.value === '->') {
                // Member access
                expr = this.parseMemberExpression(expr);
            } else if (token.value === '++' || token.value === '--') {
                // Postfix increment/decrement
                const operatorToken = this.tokenStream.next(); // consume and store the token
                const operator = operatorToken.value as UnaryOperator;
                expr = this.createPostfixUnaryExpression(operator, expr, operatorToken);
            } else {
                break;
            }
        }

        return expr;
    }

    /**
     * Parse primary expressions (identifiers, literals, parentheses, etc.)
     */
    private parsePrimary(): Expression {
        const token = this.tokenStream.peek();

        // Cast expressions (check before parenthesized expressions)
        if (this.looksLikeCast()) {
            return this.parseCastExpression();
        }

        // Parenthesized expression
        if (token.value === '(') {
            this.tokenStream.next(); // consume '('
            const expr = this.parseExpression();
            this.expectToken(')');
            return expr;
        }

        // New expressions
        if (token.value === 'new') {
            return this.parseNewExpression();
        }

        // this keyword
        if (token.value === 'this') {
            return this.parseThisExpression();
        }

        // super keyword
        if (token.value === 'super') {
            return this.parseSuperExpression();
        }

        // Literals
        if (this.isLiteral(token)) {
            return this.parseLiteral();
        }

        // Array literals using {..} syntax
        if (token.value === '{') {
            return this.parseArrayLiteral();
        }

        // Identifiers (potentially with generic types)
        if (token.kind === TokenKind.Identifier) {
            const identifier = this.parseIdentifier();

            // Check if this identifier is followed by generic type arguments
            if (this.tokenStream.peek().value === '<' && this.isGenericTypeStart()) {
                return this.parseGenericTypeReference(identifier);
            }

            return identifier;
        }

        // Handle type keywords - can be used for static member access or as standalone values (typename casting)
        if (token.kind === TokenKind.KeywordType) {
            // In EnScript, types can be implicitly cast to 'typename' and used as expression values
            // This supports both static member access (e.g., string.Empty) and type comparisons (e.g., == int)
            const typeAsIdentifier: Identifier = {
                kind: 'Identifier',
                uri: this.document.uri,
                start: this.document.positionAt(token.start),
                end: this.document.positionAt(token.end),
                name: token.value
            };
            this.tokenStream.next(); // consume the type keyword
            return typeAsIdentifier;
        }

        // Provide specific error messages based on keyword type using recovery strategy
        const errorMessage = this.recoveryStrategy.generateExpressionContextError(token);
        const errPos = this.document.positionAt(token.start);
        throw new ParseError(
            this.document.uri,
            errPos.line + 1,
            errPos.character + 1,
            errorMessage
        );
    }

    /**
     * Helper method for parsing left-associative binary expressions
     */
    private parseLogicalBinaryExpression(
        parseNext: () => Expression,
        operators: string[]
    ): Expression {
        let left = parseNext();

        while (operators.includes(this.tokenStream.peek().value)) {
            const operator = this.tokenStream.next().value as BinaryOperator;
            const right = parseNext();
            left = this.createBinaryExpression(operator, left, right);
        }

        return left;
    }

    /**
     * Parse function call expression
     */
    private parseCallExpression(callee: Expression): CallExpression {
        const startPos = this.getNodeStart(callee);
        this.expectToken('(');

        const args: Expression[] = [];
        while (this.tokenStream.peek().value !== ')') {
            args.push(this.parseExpression());

            if (this.tokenStream.peek().value === ',') {
                this.tokenStream.next(); // consume ','
            } else {
                break;
            }
        }

        const endToken = this.expectToken(')');

        return {
            kind: 'CallExpression',
            uri: this.document.uri,
            start: startPos,
            end: this.document.positionAt(endToken.end),
            callee,
            arguments: args,
            calleeStart: this.getNodeStart(callee),
            calleeEnd: this.getNodeEnd(callee)
        };
    }

    /**
     * Parse member access expression
     */
    private parseMemberExpression(object: Expression): MemberExpression {
        const startPos = this.getNodeStart(object);
        this.tokenStream.next(); // consume '.' or '->'
        
        // IDE Mode: Handle incomplete member access (e.g., "player." at end of file)
        if (this.ideMode) {
            const nextToken = this.tokenStream.peek();
            
            // Check if we're at EOF, newline, or other non-identifier token
            if (this.tokenStream.eof() || 
                nextToken.kind !== TokenKind.Identifier ||
                nextToken.value === '}' || 
                nextToken.value === ';') {
                
                return this.createMemberExpressionWithSyntheticProperty(object, startPos);
            }
        }
        
        // Normal parsing - try to parse identifier
        try {
            const property = this.parseIdentifier();
            
            return this.createMemberExpression(object, startPos, property);
        } catch (error) {
            // Fallback recovery for IDE mode if identifier parsing fails
            if (this.ideMode) {
                return this.createMemberExpressionWithSyntheticProperty(object, startPos);
            }
            
            // Re-throw error for non-IDE mode
            throw error;
        }
    }

    /**
     * Parse array access expression
     */
    private parseArrayAccessExpression(object: Expression): ArrayAccessExpression {
        const startPos = this.getNodeStart(object);
        this.expectToken('[');
        const index = this.parseExpression();
        const endToken = this.expectToken(']');

        return {
            kind: 'ArrayAccessExpression',
            uri: this.document.uri,
            start: startPos,
            end: this.document.positionAt(endToken.end),
            object,
            index
        };
    }

    /**
     * Parse cast expression: (type)expression
     */
    private parseCastExpression(): CastExpression {
        const startToken = this.expectToken('(');
        const startPos = this.document.positionAt(startToken.start);

        // Parse the type inside the parentheses
        const typeToken = this.tokenStream.next();
        if (typeToken.kind !== TokenKind.Identifier && typeToken.kind !== TokenKind.KeywordType) {
            const recovery = this.recoveryStrategy.handleInvalidCastType(typeToken);
            if (recovery.action === RecoveryAction.ThrowError) {
                const pos = this.document.positionAt(typeToken.start);
                throw new ParseError(this.document.uri, pos.line + 1, pos.character + 1, recovery.message!);
            }
        }

        // Create type node
        const type: TypeNode = {
            kind: 'TypeReference',
            name: typeToken.value,
            uri: this.document.uri,
            start: this.document.positionAt(typeToken.start),
            end: this.document.positionAt(typeToken.end)
        };

        // Expect closing parenthesis
        this.expectToken(')');

        // Parse the expression being cast
        const expression = this.parseUnary(); // Use parseUnary to get correct precedence

        return {
            kind: 'CastExpression',
            uri: this.document.uri,
            start: startPos,
            end: this.getNodeEnd(expression),
            type,
            expression,
            style: 'c-style'
        };
    }

    /**
     * Parse new expression
     */
    private parseNewExpression(): NewExpression {
        const startToken = this.expectToken('new');

        // Parse the type after 'new' (e.g., map<Widget, string>)
        // For now, we'll parse the basic identifier and handle generics simply
        const typeIdentifier = this.parseIdentifier();
        let endPos = typeIdentifier.end;

        // Handle generic type parameters like <Widget, string>
        let genericTypes: TypeNode[] | undefined;
        if (this.tokenStream.peek().value === '<') {
            genericTypes = this.parseGenericTypeArguments();
            // The parseGenericTypeArguments method already consumed the '>' token
            // We need to track the end position from the last generic argument
            if (genericTypes.length > 0) {
                const lastGeneric = genericTypes[genericTypes.length - 1];
                endPos = lastGeneric.end;
            }
        }

        const type: TypeNode = {
            kind: 'TypeReference',
            name: typeIdentifier.name,
            uri: this.document.uri,
            start: typeIdentifier.start,
            end: endPos,
            typeArguments: genericTypes && genericTypes.length > 0 ? genericTypes : undefined
        };

        let args: Expression[] | undefined;
        let arraySize: Expression | undefined;

        // Check for constructor arguments or array size
        if (this.tokenStream.peek().value === '(') {
            this.tokenStream.next(); // consume '('
            args = [];

            while (this.tokenStream.peek().value !== ')') {
                args.push(this.parseExpression());

                if (this.tokenStream.peek().value === ',') {
                    this.tokenStream.next(); // consume ','
                } else {
                    break;
                }
            }

            const endToken = this.expectToken(')');
            endPos = this.document.positionAt(endToken.end);
        } else if (this.tokenStream.peek().value === '[') {
            this.tokenStream.next(); // consume '['
            arraySize = this.parseExpression();
            const endToken = this.expectToken(']');
            endPos = this.document.positionAt(endToken.end);
        }

        return {
            kind: 'NewExpression',
            uri: this.document.uri,
            start: this.document.positionAt(startToken.start),
            end: endPos,
            type,
            arguments: args,
            arraySize
        };
    }

    /**
     * Parse this expression
     */
    private parseThisExpression(): ThisExpression {
        return this.parseKeywordExpression('this', 'ThisExpression') as ThisExpression;
    }

    /**
     * Parse super expression
     */
    private parseSuperExpression(): SuperExpression {
        return this.parseKeywordExpression('super', 'SuperExpression') as SuperExpression;
    }

    /**
     * Parse identifier with enhanced error reporting
     */
    private parseIdentifier(): Identifier {
        const token = this.tokenStream.next();

        if (token.kind !== TokenKind.Identifier) {
            const errorMessage = this.recoveryStrategy.generateIdentifierError(token);
            const pos = this.document.positionAt(token.start);
            throw new ParseError(
                this.document.uri,
                pos.line + 1,
                pos.character + 1,
                errorMessage
            );
        }

        return {
            kind: 'Identifier',
            uri: this.document.uri,
            start: this.document.positionAt(token.start),
            end: this.document.positionAt(token.end),
            name: token.value
        };
    }

    /**
     * Check if the current '<' token starts a generic type (not a comparison)
     */
    private isGenericTypeStart(): boolean {
        // Look ahead to see if this looks like generic type syntax
        const savedPosition = this.tokenStream.getPosition();

        try {
            this.tokenStream.next(); // consume '<'

            // Look for identifier or basic type name
            const nextToken = this.tokenStream.peek();

            if (nextToken.kind === TokenKind.Identifier ||
                nextToken.kind === TokenKind.KeywordType ||
                nextToken.kind === TokenKind.KeywordStorage) {

                // Advance past the potential type name
                this.tokenStream.next();

                // Look at what comes after the type name
                const followingToken = this.tokenStream.peek();

                // Generic types are followed by ',' (for multiple types) or '>' (end of generics)
                // Comparisons are followed by other operators, parentheses, literals, etc.
                if (followingToken.value === ',' || followingToken.value === '>') {
                    return true;
                }

                // If followed by '(' it could be a function call in a comparison: index < Count()
                // This is NOT a generic type
                if (followingToken.value === '(') {
                    return false;
                }

                // If followed by operators like +, -, *, /, etc., it's likely a comparison
                if (['+', '-', '*', '/', '%', '==', '!=', '<=', '>=', '&&', '||', '&', '|', '^'].includes(followingToken.value)) {
                    return false;
                }
            }

            return false;
        } finally {
            // Always restore position
            this.tokenStream.setPosition(savedPosition);
        }
    }

    /**
     * Parse generic type reference (Identifier<Type1, Type2, ...>)
     */
    private parseGenericTypeReference(baseIdentifier: Identifier): Expression {
        const startPos = baseIdentifier.start;

        // Consume '<'
        this.tokenStream.next();

        const typeArguments: Identifier[] = [];

        while (this.tokenStream.peek().value !== '>') {
            // Parse type argument
            const typeToken = this.tokenStream.peek();

            if (typeToken.kind === TokenKind.Identifier ||
                typeToken.kind === TokenKind.KeywordType ||
                typeToken.kind === TokenKind.KeywordStorage) {

                this.tokenStream.next();
                typeArguments.push({
                    kind: 'Identifier',
                    name: typeToken.value,
                    uri: this.document.uri,
                    start: this.document.positionAt(typeToken.start),
                    end: this.document.positionAt(typeToken.end)
                });
            } else {
                const recovery = this.recoveryStrategy.handleGenericTypeError('type name', typeToken);
                if (recovery.action === RecoveryAction.ThrowError) {
                    const pos = this.document.positionAt(typeToken.start);
                    throw new ParseError(this.document.uri, pos.line + 1, pos.character + 1, recovery.message!);
                }
            }

            // Handle comma separator
            if (this.tokenStream.peek().value === ',') {
                this.tokenStream.next(); // consume ','
            } else if (this.tokenStream.peek().value !== '>') {
                const nextToken = this.tokenStream.peek();
                const recovery = this.recoveryStrategy.handleGenericTypeError("',' or '>'", nextToken);
                if (recovery.action === RecoveryAction.ThrowError) {
                    const pos = this.document.positionAt(nextToken.start);
                    throw new ParseError(this.document.uri, pos.line + 1, pos.character + 1, recovery.message!);
                }
            }
        }

        // Consume '>'
        const closeToken = this.expectToken('>');
        const endPos = this.document.positionAt(closeToken.end);

        // Return as a generic type expression (using CallExpression structure)
        const result: CallExpression = {
            kind: 'CallExpression',
            uri: this.document.uri,
            start: startPos,
            end: endPos,
            callee: baseIdentifier,
            calleeStart: baseIdentifier.start,
            calleeEnd: baseIdentifier.end,
            arguments: typeArguments
        };
        return result;
    }

    /**
     * Parse literal value
     */
    private parseLiteral(): Literal {
        const token = this.tokenStream.next();

        let value: string | number | boolean | null;
        let literalType: LiteralType;

        switch (token.kind) {
            case TokenKind.Number:
                value = parseFloat(token.value);
                literalType = token.value.includes('.') ? 'float' : 'int';
                break;
            case TokenKind.String:
                value = token.value.slice(1, -1); // Remove quotes
                literalType = 'string';
                break;
            case TokenKind.KeywordLiteral:
                if (token.value === 'true') {
                    value = true;
                    literalType = 'bool';
                } else if (token.value === 'false') {
                    value = false;
                    literalType = 'bool';
                } else if (token.value === 'null' || token.value === 'NULL') {
                    value = null;
                    literalType = 'null';
                } else {
                    const recovery = this.recoveryStrategy.handleUnexpectedLiteral(token);
                    if (recovery.action === RecoveryAction.ThrowError) {
                        const pos = this.document.positionAt(token.start);
                        throw new ParseError(this.document.uri, pos.line + 1, pos.character + 1, recovery.message!);
                    }
                    // Fallback values if recovery doesn't throw
                    value = null;
                    literalType = 'null';
                }
                break;
            case TokenKind.Identifier:
                // Handle identifiers used as literals (e.g., function references)
                value = token.value;
                literalType = 'func';
                break;
            default:
                const recovery = this.recoveryStrategy.handleUnexpectedLiteral(token);
                if (recovery.action === RecoveryAction.ThrowError) {
                    const pos = this.document.positionAt(token.start);
                    throw new ParseError(this.document.uri, pos.line + 1, pos.character + 1, recovery.message!);
                }
                // Fallback values if recovery doesn't throw
                value = null;
                literalType = 'null';
        }

        return {
            kind: 'Literal',
            uri: this.document.uri,
            start: this.document.positionAt(token.start),
            end: this.document.positionAt(token.end),
            value,
            raw: token.value,
            literalType
        };
    }

    // ============================================================================
    // HELPER METHODS
    // ============================================================================

    private createBinaryExpression(operator: BinaryOperator, left: Expression, right: Expression): BinaryExpression {
        return {
            kind: 'BinaryExpression',
            uri: this.document.uri,
            start: this.getNodeStart(left),
            end: this.getNodeEnd(right),
            operator,
            left,
            right
        };
    }

    private createUnaryExpression(operator: UnaryOperator, operand: Expression, prefix: boolean): UnaryExpression {
        return {
            kind: 'UnaryExpression',
            uri: this.document.uri,
            start: prefix ? this.document.positionAt(this.tokenStream.peek().start) : this.getNodeStart(operand),
            end: prefix ? this.getNodeEnd(operand) : this.document.positionAt(this.tokenStream.peek().end),
            operator,
            operand,
            prefix
        };
    }

    private createPostfixUnaryExpression(operator: UnaryOperator, operand: Expression, operatorToken: Token): UnaryExpression {
        return {
            kind: 'UnaryExpression',
            uri: this.document.uri,
            start: this.getNodeStart(operand),
            end: this.document.positionAt(operatorToken.end), // Use the actual operator token's end position
            operator,
            operand,
            prefix: false
        };
    }

    private createAssignmentExpression(operator: AssignmentOperator, left: Expression, right: Expression): AssignmentExpression {
        return {
            kind: 'AssignmentExpression',
            uri: this.document.uri,
            start: this.getNodeStart(left),
            end: this.getNodeEnd(right),
            operator,
            left,
            right
        };
    }

    private createConditionalExpression(test: Expression, consequent: Expression, alternate: Expression): ConditionalExpression {
        return {
            kind: 'ConditionalExpression',
            uri: this.document.uri,
            start: this.getNodeStart(test),
            end: this.getNodeEnd(alternate),
            test,
            consequent,
            alternate
        };
    }

    private createMemberExpression(object: Expression, startPos: Position, property: Identifier): MemberExpression {
        return {
            kind: 'MemberExpression',
            uri: this.document.uri,
            start: startPos,
            end: this.getNodeEnd(property),
            object,
            property,
            computed: false,
            optional: false,
            memberStart: this.getNodeStart(property),
            memberEnd: this.getNodeEnd(property)
        };
    }

    private createMemberExpressionWithSyntheticProperty(object: Expression, startPos: Position): MemberExpression {
        const currentToken = this.tokenStream.peek();
        const syntheticProperty: Identifier = {
            kind: 'Identifier',
            uri: this.document.uri,
            start: this.document.positionAt(currentToken.start),
            end: this.document.positionAt(currentToken.start),
            name: '__COMPLETION_PLACEHOLDER__'
        };
        
        return this.createMemberExpression(object, startPos, syntheticProperty);
    }

    private parseKeywordExpression(keyword: string, kind: 'ThisExpression' | 'SuperExpression'): ThisExpression | SuperExpression {
        const token = this.expectToken(keyword);

        return {
            kind,
            uri: this.document.uri,
            start: this.document.positionAt(token.start),
            end: this.document.positionAt(token.end)
        };
    }

    private isAssignmentOperator(op: string): boolean {
        return op in ASSIGNMENT_OPERATORS;
    }

    private isUnaryOperator(op: string): boolean {
        return UNARY_OPERATORS.has(op);
    }

    private isKeywordUnaryOperator(token: Token): boolean {
        return token.kind === TokenKind.KeywordControl && 
               (token.value === 'delete' || token.value === 'thread');
    }

    private isLiteral(token: Token): boolean {
        return token.kind === TokenKind.Number ||
            token.kind === TokenKind.String ||
            token.kind === TokenKind.KeywordLiteral;
    }

    private looksLikeCast(): boolean {
        // Check for C-style cast: (type)expression
        if (this.tokenStream.peek().value !== '(') {
            return false;
        }

        // Save current position for backtracking
        const saved = this.tokenStream.getPosition();

        try {
            this.tokenStream.next(); // consume '('

            // Check if the next token looks like a type name
            const token = this.tokenStream.peek();

            // Must be an identifier or type keyword (potential type name)
            if (token.kind !== TokenKind.Identifier && token.kind !== TokenKind.KeywordType) {
                return false;
            }

            // Check if it's a known primitive type or could be a type
            const typeName = token.value;

            // Could be a primitive type or a user-defined type (we'll be liberal here)
            const couldBeType = typeKeywords.has(typeName) || /^[A-Z]/.test(typeName) || typeName.includes('_');

            if (!couldBeType) {
                return false;
            }

            this.tokenStream.next(); // consume type name

            // Check for closing parenthesis
            if (this.tokenStream.peek().value !== ')') {
                return false;
            }

            this.tokenStream.next(); // consume ')'

            // Check if what follows could be an expression
            const nextToken = this.tokenStream.peek();

            // It should be followed by something that can start an expression
            const canStartExpression = (
                nextToken.kind === TokenKind.Identifier ||
                nextToken.kind === TokenKind.Number ||
                nextToken.kind === TokenKind.String ||
                nextToken.value === '(' ||
                nextToken.value === '{' ||
                nextToken.value === 'new' ||
                nextToken.value === 'this' ||
                nextToken.value === 'super' ||
                UNARY_OPERATORS.has(nextToken.value)
            );

            return canStartExpression;

        } catch {
            return false;
        } finally {
            // Restore position
            this.tokenStream.setPosition(saved);
        }
    }

    private expectToken(expected: string): Token {
        const token = this.tokenStream.next();

        if (token.value !== expected) {
            const recovery = this.recoveryStrategy.handleExpectedToken(expected, token);
            
            if (recovery.action === RecoveryAction.InsertSynthetic && recovery.syntheticToken) {
                // Handle synthetic token insertion
                this.tokenStream.insertToken(recovery.syntheticToken);
                
                // Return the first token
                return {
                    kind: TokenKind.Operator,
                    value: expected,
                    start: token.start,
                    end: token.start + 1
                };
            } else if (recovery.action === RecoveryAction.SplitToken && recovery.syntheticToken) {
                // Handle >> token splitting for nested generics
                this.tokenStream.insertToken(recovery.syntheticToken);
                
                // Return the first '>' token
                return {
                    kind: TokenKind.Operator,
                    value: '>',
                    start: token.start,
                    end: token.start + 1
                };
            } else if (recovery.action === RecoveryAction.ThrowError) {
                const pos = this.document.positionAt(token.start);
                throw new ParseError(this.document.uri, pos.line + 1, pos.character + 1, recovery.message!);
            }
        }
        
        return token;
    }

    private getNodeStart(node: Expression): Position {
        return node.start;
    }

    private getNodeEnd(node: Expression): Position {
        return node.end;
    }

    /**
     * Parse array literal using {element1, element2, ...} syntax (EnScript style)
     */
    private parseArrayLiteral(): ArrayLiteralExpression {
        const startToken = this.expectToken('{');
        const elements: Expression[] = [];

        // Handle empty array
        if (this.tokenStream.peek().value === '}') {
            const endToken = this.tokenStream.next();
            return {
                kind: 'ArrayLiteralExpression',
                uri: this.document.uri,
                start: this.document.positionAt(startToken.start),
                end: this.document.positionAt(endToken.end),
                elements
            };
        }

        // Parse elements
        while (this.tokenStream.peek().value !== '}') {
            elements.push(this.parseExpression());

            const nextToken = this.tokenStream.peek();
            if (nextToken.value === ',') {
                this.tokenStream.next(); // consume comma
                // Allow trailing comma
                if (this.tokenStream.peek().value === '}') {
                    break;
                }
            } else if (nextToken.value === '}') {
                // End of array, break out
                break;
            } else {
                // Use recovery strategy to handle array element separation
                const recovery = this.recoveryStrategy.validateArrayElementSeparation(nextToken);
                
                if (recovery.action === RecoveryAction.WarnAndContinue) {
                    // Continue parsing as if comma was present
                    continue;
                } else if (recovery.action === RecoveryAction.Skip) {
                    // Unexpected token, break out
                    break;
                } else {
                    // Other recovery actions or continue
                    break;
                }
            }
        }

        const endToken = this.expectToken('}');

        return {
            kind: 'ArrayLiteralExpression',
            uri: this.document.uri,
            start: this.document.positionAt(startToken.start),
            end: this.document.positionAt(endToken.end),
            elements
        };
    }

    /**
     * Parse a single generic type argument with modifiers and nested generics support
     */
    private parseGenericTypeArgument(): TypeNode {
        // Handle modifier keywords - only 'ref' is allowed in generic type arguments
        const modifiers: string[] = [];
        while ((this.tokenStream.peek().kind === TokenKind.KeywordStorage ||
                this.tokenStream.peek().kind === TokenKind.KeywordModifier) &&
            ['ref'].includes(this.tokenStream.peek().value)) {
            modifiers.push(this.tokenStream.next().value);
        }

        // Parse type name - handle both identifiers and type keywords
        let typeName: string;
        let typeStart: Position;
        let typeEnd: Position;
        
        const currentToken = this.tokenStream.peek();
        if (currentToken.kind === TokenKind.KeywordType) {
            // Handle type keywords like 'string', 'int', etc.
            const typeToken = this.tokenStream.next();
            typeName = typeToken.value;
            typeStart = this.document.positionAt(typeToken.start);
            typeEnd = this.document.positionAt(typeToken.end);
        } else {
            // Handle regular identifiers
            const genericTypeIdentifier = this.parseIdentifier();
            typeName = genericTypeIdentifier.name;
            typeStart = genericTypeIdentifier.start;
            typeEnd = genericTypeIdentifier.end;
        }

        const typeRef: TypeNode = {
            kind: 'TypeReference',
            name: typeName,
            uri: this.document.uri,
            start: typeStart,
            end: typeEnd,
            modifiers: modifiers.length > 0 ? modifiers : undefined
        };

        // Handle nested generic types recursively
        if (this.tokenStream.peek().value === '<') {
            typeRef.typeArguments = this.parseGenericTypeArguments();
        }

        // Handle array dimensions
        let finalTypeRef: TypeNode = typeRef;
        while (this.tokenStream.peek().value === '[') {
            this.tokenStream.next(); // consume '['

            let size: Expression | undefined;
            if (this.tokenStream.peek().value !== ']') {
                size = this.parseExpression();
            }

            const endToken = this.expectToken(']');

            finalTypeRef = {
                kind: 'ArrayType',
                uri: this.document.uri,
                start: typeRef.start,
                end: this.document.positionAt(endToken.end),
                elementType: finalTypeRef,
                size
            } as TypeNode;
        }

        return finalTypeRef;
    }

    /**
     * Parse generic type arguments: <Type1, Type2, ...>
     */
    private parseGenericTypeArguments(): TypeNode[] {
        this.tokenStream.next(); // consume '<'
        const typeArgs: TypeNode[] = [];

        while (this.tokenStream.peek().value !== '>') {
            typeArgs.push(this.parseGenericTypeArgument());

            if (this.tokenStream.peek().value === ',') {
                this.tokenStream.next(); // consume ','
            } else {
                break;
            }
        }

        this.expectToken('>');
        return typeArgs;
    }
}
