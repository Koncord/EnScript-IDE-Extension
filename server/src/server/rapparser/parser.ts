import { lex, CfgToken, TokenKind } from './lexer';
import {
    CfgType,
    CfgBaseType,
    CfgDocument,
    CfgSimpleVariable,
    CfgArrayVariable,
    CfgArrayExtend,
    CfgArrayShrink,
    CfgEnum,
    CfgClass,
    CfgPrototype,
    CfgDelete
} from './ast';

export class Parser {
    private tokens: CfgToken[];
    private current: number = 0;
    private filename: string;

    constructor(input: string, filename?: string) {
        this.tokens = lex(input);
        this.filename = filename || '<unknown>';
    }

    private peek(): CfgToken | null {
        return this.current < this.tokens.length ? this.tokens[this.current] : null;
    }

    private advance(): CfgToken | null {
        if (this.current < this.tokens.length) {
            return this.tokens[this.current++];
        }
        return null;
    }

    private consume(kind: TokenKind, value?: string): CfgToken {
        const token = this.peek();
        if (!token || token.kind !== kind || (value && token.value !== value)) {
            const expected = value ? `'${value}'` : TokenKind[kind];
            const got = token ? `${TokenKind[token.kind]} '${token.value}'` : 'EOF';
            const location = token ? `${this.filename}:${token.line}:${token.column}` : this.filename;
            throw new Error(`${location}: Expected ${expected}, got ${got}`);
        }
        return this.advance()!;
    }

    private isAtEnd(): boolean {
        return this.current >= this.tokens.length;
    }

    private parseType(): CfgType {
        const token = this.peek();
        if (!token) throw new Error(`${this.filename}: Unexpected end of input`);

        // Handle negative numbers
        if (token.kind === TokenKind.Punctuation && (token.value === '-' || token.value === '+')) {
            this.advance();
            const numToken = this.peek();
            if (numToken && numToken.kind === TokenKind.Number) {
                this.advance();
                const value = parseFloat(numToken.value);
                return token.value === '-' ? -value : value;
            }
            throw new Error(`${this.filename}:${token.line}:${token.column}: Expected number after '${token.value}'`);
        }

        if (token.kind === TokenKind.Number) {
            this.advance();
            return parseFloat(token.value);
        } else if (token.kind === TokenKind.String) {
            this.advance();
            return token.value;
        } else if (token.kind === TokenKind.Keyword) {
            if (token.value === 'true') {
                this.advance();
                return true;
            } else if (token.value === 'false') {
                this.advance();
                return false;
            } else if (token.value === 'null' || token.value === 'NULL') {
                this.advance();
                return null;
            }
        }
        throw new Error(`${this.filename}:${token.line}:${token.column}: Unexpected token for type: ${TokenKind[token.kind]} '${token.value}'`);
    }

    private parseExpression(): CfgType {
        const token = this.peek();
        if (token && token.kind === TokenKind.Punctuation && token.value === '{') {
            // Nested array
            this.advance(); // consume '{'
            const elements = this.parseArrayElements();
            this.consume(TokenKind.Punctuation, '}');
            return elements;
        }
        return this.parseType();
    }

    private parseArrayElements(): CfgType[] {
        const elements: CfgType[] = [];
        while (!this.isAtEnd()) {
            const token = this.peek();
            if (token && token.value === '}') break;
            elements.push(this.parseExpression());
            const comma = this.peek();
            if (comma && comma.value === ',') {
                this.advance();
            } else {
                break;
            }
        }
        return elements;
    }

    private parseVariable(): CfgSimpleVariable | CfgArrayVariable | CfgArrayExtend | CfgArrayShrink {
        const name = this.consume(TokenKind.Identifier).value;
        const next = this.peek();
        if (next && next.value === '[') {
            this.consume(TokenKind.Punctuation, '[');
            this.consume(TokenKind.Punctuation, ']');
            const op = this.consume(TokenKind.Punctuation);
            if (op.value !== '=' && op.value !== '+=' && op.value !== '-=') {
                throw new Error(`${this.filename}:${op.line}:${op.column}: Invalid operator for array: '${op.value}'`);
            }
            this.consume(TokenKind.Punctuation, '{');
            const elements = this.parseArrayElements();
            this.consume(TokenKind.Punctuation, '}');
            this.consume(TokenKind.Punctuation, ';');
            if (op.value === '=') {
                return {
                    kind: 'array',
                    name,
                    values: elements
                };
            } else if (op.value === '+=') {
                return {
                    kind: 'array-extend',
                    name,
                    values: elements
                };
            } else { // -=
                return {
                    kind: 'array-shrink',
                    name,
                    values: elements
                };
            }
        } else {
            this.consume(TokenKind.Punctuation, '=');
            const value = this.parseExpression();
            this.consume(TokenKind.Punctuation, ';');
            return {
                kind: 'variable',
                name,
                value
            };
        }
    }

    private parseClass(): CfgClass | CfgPrototype {
        this.consume(TokenKind.Keyword, 'class');
        const name = this.consume(TokenKind.Identifier).value;
        let baseClassName: string | undefined;
        const colon = this.peek();
        if (colon && colon.value === ':') {
            this.advance();
            baseClassName = this.consume(TokenKind.Identifier).value;
        }
        const brace = this.peek();
        if (brace && brace.value === '{') {
            this.advance();
            const properties = new Map<string, CfgBaseType>();
            while (!this.isAtEnd()) {
                const token = this.peek();
                if (!token || token.value === '}') break;

                // Check if it's a nested class or a variable/delete/enum
                if (token.kind === TokenKind.Keyword && token.value === 'class') {
                    const nestedClass = this.parseClass();
                    properties.set(nestedClass.name, nestedClass);
                } else if (token.kind === TokenKind.Keyword && token.value === 'delete') {
                    const deleteStmt = this.parseDelete();
                    properties.set(deleteStmt.name, deleteStmt);
                } else if (token.kind === TokenKind.Keyword && token.value === 'enum') {
                    const enumStmt = this.parseEnum();
                    properties.set(enumStmt.name, enumStmt);
                } else {
                    const prop = this.parseVariable();
                    properties.set(prop.name, prop);
                }
            }
            this.consume(TokenKind.Punctuation, '}');
            this.consume(TokenKind.Punctuation, ';');
            return {
                kind: 'class',
                name,
                baseClassName,
                properties
            };
        } else {
            this.consume(TokenKind.Punctuation, ';');
            return {
                kind: 'prototype',
                name,
                baseClassName
            };
        }
    }

    private parseDelete(): CfgDelete {
        this.consume(TokenKind.Keyword, 'delete');
        const name = this.consume(TokenKind.Identifier).value;
        this.consume(TokenKind.Punctuation, ';');
        return {
            kind: 'delete',
            name
        };
    }

    private parseEnum(): CfgEnum {
        this.consume(TokenKind.Keyword, 'enum');
        const name = this.consume(TokenKind.Identifier).value;
        this.consume(TokenKind.Punctuation, '{');
        const members: { name: string; value?: number }[] = [];
        let nextValue = 0;
        while (!this.isAtEnd()) {
            const token = this.peek();
            if (token && token.value === '}') break;
            const memberName = this.consume(TokenKind.Identifier).value;
            let value: number | undefined;
            const eq = this.peek();
            if (eq && eq.value === '=') {
                this.advance();
                const numToken = this.consume(TokenKind.Number);
                value = parseFloat(numToken.value);
                nextValue = value + 1;
            } else {
                value = nextValue++;
            }
            members.push({ name: memberName, value });
            const comma = this.peek();
            if (comma && comma.value === ',') {
                this.advance();
            } else {
                break;
            }
        }
        this.consume(TokenKind.Punctuation, '}');
        this.consume(TokenKind.Punctuation, ';');
        return {
            kind: 'enum',
            name,
            members
        };
    }

    public parse(): CfgDocument {
        const statements: CfgBaseType[] = [];
        while (!this.isAtEnd()) {
            const token = this.peek();
            if (!token) break;
            if (token.kind === TokenKind.Identifier) {
                statements.push(this.parseVariable());
            } else if (token.kind === TokenKind.Keyword && token.value === 'class') {
                statements.push(this.parseClass());
            } else if (token.kind === TokenKind.Keyword && token.value === 'delete') {
                statements.push(this.parseDelete());
            } else if (token.kind === TokenKind.Keyword && token.value === 'enum') {
                statements.push(this.parseEnum());
            } else {
                const token = this.peek();
                if (token) {
                    throw new Error(`${this.filename}:${token.line}:${token.column}: Unexpected token: ${TokenKind[token.kind]} '${token.value}'`);
                } else {
                    throw new Error(`${this.filename}: Unexpected end of input`);
                }
            }
        }
        return {
            kind: 'document',
            statements
        };
    }
}